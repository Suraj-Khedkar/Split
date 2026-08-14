import type { Expense, Person } from '../types';

/**
 * How one ledger row should read on screen.
 *
 * Settlements share a table with expenses because balance math wants a single
 * code path (see the note on `Expense.isSettlement`). The display layer wants
 * the opposite: a payback is not a spend, and rendering it as one is how the
 * same ₹500 ends up counted twice — once when the dinner was added, again when
 * it was paid back.
 *
 * This is the one place that decides the difference, so the group list, the
 * activity feed, the friend screen and the report cannot drift into four
 * slightly different answers.
 *
 * Deliberately free of theme and store imports: it stays pure, testable, and
 * safe to call from anywhere. Callers pick the icon, since only they know
 * which icon set they are rendering into.
 */
export interface LedgerEntry {
  /** A transfer between two people who already owed each other. */
  isPayback: boolean;
  /** Headline: the description for a spend, "You paid Priya" for a payback. */
  title: string;
  /** paid − share for the device owner. Positive means money left their side. */
  delta: number;
  /**
   * How to phrase `delta`, already point-of-view correct. Empty when zero.
   *
   * A payback never says "you lent": lending is what created the debt, and
   * clearing it is the opposite motion.
   */
  deltaLabel: string;
  /** False for paybacks — the only rule that keeps spend totals honest. */
  countsAsSpend: boolean;
}

/** Same rule as `personName`, inlined to keep this module store-free. */
function nameOf(people: Person[], id: string, meId: string): string {
  if (id === meId) return 'You';
  return people.find((p) => p.id === id)?.name ?? 'Someone';
}

function sumFor(shares: { personId: string; amount: number }[], id: string): number {
  let total = 0;
  for (const s of shares) if (s.personId === id) total += s.amount;
  return total;
}

export function describeEntry(
  expense: Expense,
  people: Person[],
  meId: string
): LedgerEntry {
  const delta = sumFor(expense.paidBy, meId) - sumFor(expense.splits, meId);

  if (!expense.isSettlement) {
    return {
      isPayback: false,
      title: expense.description,
      delta,
      deltaLabel: delta > 0 ? 'you lent' : delta < 0 ? 'you borrowed' : '',
      countsAsSpend: true,
    };
  }

  // A settlement is modelled as the payer covering the payee's share in full,
  // so the single payer and the single split are the two ends of the transfer.
  const fromId = expense.paidBy[0]?.personId ?? '';
  const toId = expense.splits[0]?.personId ?? '';

  const title =
    fromId === meId
      ? `You paid ${nameOf(people, toId, meId)}`
      : toId === meId
      ? `${nameOf(people, fromId, meId)} paid you`
      : `${nameOf(people, fromId, meId)} paid ${nameOf(people, toId, meId)}`;

  return {
    isPayback: true,
    title,
    delta,
    // Positive delta here means you handed money over to clear what you owed.
    deltaLabel: delta > 0 ? 'you paid' : delta < 0 ? 'you were paid' : '',
    countsAsSpend: false,
  };
}

/** Spend only. The one-liner every total on screen should be built from. */
export function spendTotal(expenses: Expense[]): number {
  let total = 0;
  for (const e of expenses) if (!e.isSettlement) total += e.amount;
  return total;
}
