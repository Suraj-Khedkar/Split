import { splitEvenly } from './money';
import type { SplitMethod, SplitShare } from '../types';

/**
 * Importer for Splitwise's own CSV export
 * (group → settings → "Export as spreadsheet").
 *
 * The export looks like:
 *
 *   Date,Description,Category,Cost,Currency,Alice,Bob,Carol
 *   2026-01-15,Dinner,Dining out,900.00,INR,600.00,-300.00,-300.00
 *   ,Total balance,,0.00,INR,250.00,-100.00,-150.00
 *
 * The per-person columns are **net impact**, not what each person paid: it is
 * (what they put in) − (their share). That loses the paid/share breakdown, so
 * an import has to reconstruct one. See rebuildShares below.
 */

export interface ParsedRow {
  date: string;
  description: string;
  category: string;
  amount: number;
  currency: string;
  /** personName -> net impact in minor units. Sums to zero. */
  nets: Record<string, number>;
  isSettlement: boolean;
}

export interface ImportPreview {
  people: string[];
  rows: ParsedRow[];
  currency: string;
  warnings: string[];
}

/** Split a CSV line honouring quoted fields (descriptions contain commas). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/** Splitwise writes plain decimals; blank means "not involved". */
function toMinor(raw: string): number {
  if (!raw || !raw.trim()) return 0;
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export function parseSplitwiseCsv(csv: string): ImportPreview {
  const warnings: string[] = [];
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('That file has no rows. Export a group from Splitwise as a spreadsheet.');
  }

  const header = splitCsvLine(lines[0]);
  const lower = header.map((h) => h.toLowerCase());
  const costIdx = lower.findIndex((h) => h === 'cost');
  const currencyIdx = lower.findIndex((h) => h.startsWith('currency'));
  if (costIdx === -1) {
    throw new Error('This does not look like a Splitwise export (no "Cost" column).');
  }

  // Everything after Currency is a person column.
  const firstPerson = Math.max(costIdx, currencyIdx) + 1;
  const people = header.slice(firstPerson).filter(Boolean);
  if (people.length === 0) throw new Error('No people columns found in the export.');

  const rows: ParsedRow[] = [];
  let currency = 'INR';

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const description = (cells[1] ?? '').trim();

    // The export ends with a running-balance row; it is a summary, not an
    // expense, and importing it would double every balance.
    if (/^total balance$/i.test(description)) continue;
    if (!description) continue;

    const amount = toMinor(cells[costIdx] ?? '');
    if (currencyIdx >= 0 && cells[currencyIdx]) currency = cells[currencyIdx].trim() || currency;

    const nets: Record<string, number> = {};
    people.forEach((person, i) => {
      nets[person] = toMinor(cells[firstPerson + i] ?? '');
    });

    const netSum = Object.values(nets).reduce((a, b) => a + b, 0);
    if (netSum !== 0) {
      // Splitwise rounds each column independently, so a stray paisa is
      // normal. Anything larger means the row is not trustworthy.
      if (Math.abs(netSum) <= people.length) {
        const first = people.find((p) => nets[p] !== 0) ?? people[0];
        nets[first] -= netSum;
      } else {
        warnings.push(`"${description}" does not balance (off by ${(netSum / 100).toFixed(2)}) — skipped`);
        continue;
      }
    }

    const category = (cells[2] ?? '').trim();
    rows.push({
      date: (cells[0] ?? '').trim(),
      description,
      category,
      amount,
      currency,
      nets,
      isSettlement: /^payment$/i.test(category),
    });
  }

  if (rows.length === 0) throw new Error('No usable expense rows were found in that file.');
  return { people, rows, currency, warnings };
}

/**
 * Rebuild `paidBy` and `splits` from net impacts.
 *
 * Splitwise only exports the net, so infinitely many paid/share pairs would
 * reproduce it. This picks the one that is always valid:
 *
 *   debt_i  = max(0, -net_i)            what person i under-paid
 *   rest    = cost - sum(debt)          spread equally as r_i
 *   split_i = debt_i + r_i
 *   paid_i  = net_i + split_i
 *
 * Both columns then sum to exactly `cost`, every value is non-negative, and
 * paid − split reproduces the original net for everyone. Balances after import
 * therefore match Splitwise exactly, which is the only property that has to
 * survive; the per-expense breakdown is a reconstruction and is labelled as
 * such in the UI.
 */
export function rebuildShares(
  amount: number,
  nets: Record<string, number>,
  idFor: (name: string) => string
): { paidBy: SplitShare[]; splits: SplitShare[]; method: SplitMethod } {
  const names = Object.keys(nets);
  const debts = names.map((n) => Math.max(0, -nets[n]));
  const totalDebt = debts.reduce((a, b) => a + b, 0);

  // sum(positive nets) === sum(debts) and can never exceed the bill, so this
  // remainder is >= 0 for any well-formed row.
  const remainder = Math.max(0, amount - totalDebt);
  const spread = splitEvenly(remainder, names.length);

  const splits: SplitShare[] = [];
  const paidBy: SplitShare[] = [];
  names.forEach((name, i) => {
    const split = debts[i] + spread[i];
    const paid = nets[name] + split;
    const id = idFor(name);
    if (split !== 0) splits.push({ personId: id, amount: split });
    if (paid !== 0) paidBy.push({ personId: id, amount: paid });
  });

  return { paidBy, splits, method: 'exact' };
}

/** Splitwise category names mapped onto ours; anything unknown → general. */
export function mapCategory(splitwiseCategory: string): string {
  const c = splitwiseCategory.toLowerCase();
  if (/dining|restaurant|food|liquor|groceries/.test(c)) {
    return /groceries/.test(c) ? 'groceries' : 'food';
  }
  if (/transport|taxi|bus|train|plane|car|gas|fuel|parking/.test(c)) return 'transport';
  if (/rent|mortgage|home|furniture|household|maintenance/.test(c)) return 'home';
  if (/electric|gas|water|trash|utilit|heat|tv|internet|phone/.test(c)) return 'utilities';
  if (/entertain|movie|music|game|sport/.test(c)) return 'entertainment';
  if (/travel|hotel|flight/.test(c)) return 'travel';
  if (/clothing|shopping|gift|electronics/.test(c)) return 'shopping';
  if (/payment/.test(c)) return 'settlement';
  return 'general';
}
