import type { Expense } from '../types';

/**
 * Report aggregation.
 *
 * Pure functions over a list of expenses — the caller decides what the list is
 * (one group, one person, everything), so the same code answers "how did this
 * trip go" and "what does Priya cost me".
 *
 * Two rules run through all of it:
 *
 * **Settlements are not spending.** They are money moving between people who
 * already owe each other, so counting them as expenses would double the total
 * and invent a "settlement" category. They are reported on their own.
 *
 * **Paid and share are different questions.** Who put the money in is not who
 * consumed it, and a report that conflates them is the main way these numbers
 * go wrong. Every per-person figure carries both, plus the net between them.
 */

export interface CategorySlice {
  category: string;
  amount: number;
  /** Fraction of the report total, 0..1. */
  share: number;
}

export interface MonthPoint {
  /** YYYY-MM. */
  month: string;
  amount: number;
}

export interface MemberLine {
  personId: string;
  /** What they put in. */
  paid: number;
  /** What they consumed. */
  share: number;
  /** paid − share. Positive means the group owes them. */
  net: number;
}

export interface GroupSlice {
  groupId: string | null;
  amount: number;
  share: number;
}

export interface Report {
  /** Spend only — settlements excluded. */
  total: number;
  count: number;
  /** Mean expense, rounded to whole minor units. 0 when there are none. */
  average: number;
  largest: Expense | null;
  earliest: string;
  latest: string;
  settledTotal: number;
  settledCount: number;
  byCategory: CategorySlice[];
  byMonth: MonthPoint[];
  byMember: MemberLine[];
  byGroup: GroupSlice[];
  /** Present when a subject was named: that person's own line. */
  subject: MemberLine | null;
  /**
   * The same breakdowns, but counting only the subject's share.
   *
   * A personal report cannot reuse the group figures: "where your money went"
   * is your slice of each expense, not the whole bill. Using the group numbers
   * would produce a category list that does not add up to your own total.
   * Empty when no subject was named.
   */
  subjectByCategory: CategorySlice[];
  subjectByGroup: GroupSlice[];
}

const isSpend = (e: Expense) => !e.isSettlement && !((e as { deleted?: boolean }).deleted);

/**
 * What one person owes on a single expense. Zero when they are not in it.
 *
 * Named for the person rather than `shareOf` because buildReport already has a
 * local `shareOf(amount)` for percentages, and the shadowing was silent.
 */
export function shareForPerson(expense: Expense, personId: string): number {
  let total = 0;
  for (const s of expense.splits) if (s.personId === personId) total += s.amount;
  return total;
}

/** YYYY-MM from a YYYY-MM-DD date, falling back to createdAt for older rows. */
function monthOf(expense: Expense): string {
  const raw = expense.date || expense.createdAt || '';
  return raw.slice(0, 7);
}

/**
 * Every month between two YYYY-MM keys, inclusive.
 *
 * Gaps are filled with zero rather than skipped: a trend that silently omits
 * the months you spent nothing reads as continuous activity and overstates how
 * steady the spending was.
 */
function monthRange(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  // Guard against malformed keys rather than looping forever.
  if (!y || !m || !ly || !lm) return first ? [first] : [];
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** ISO week key, e.g. 2026-W07. Monday-based, matching ISO-8601. */
function weekOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date.slice(0, 7);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Spend bucketed by month or by week.
 *
 * Weeks are the zoomed-in view of the same data: a year of months is 12 bars,
 * a year of weeks is 52, which is exactly why the chart it feeds has to scroll.
 * Empty buckets are kept so a quiet stretch reads as quiet rather than absent.
 */
export function bucketSpend(
  expenses: Expense[],
  granularity: 'month' | 'week',
  /** Count only this person's share, for a personal report. */
  subjectId?: string
): MonthPoint[] {
  const spend = expenses.filter(isSpend);
  if (!spend.length) return [];
  const valueOf = (e: Expense) => (subjectId ? shareForPerson(e, subjectId) : e.amount);

  if (granularity === 'month') {
    const months = new Map<string, number>();
    for (const e of spend) months.set(monthOf(e), (months.get(monthOf(e)) ?? 0) + valueOf(e));
    const keys = spend.map(monthOf).filter(Boolean).sort();
    return monthRange(keys[0], keys[keys.length - 1]).map((month) => ({
      month,
      amount: months.get(month) ?? 0,
    }));
  }

  const totals = new Map<string, number>();
  for (const e of spend) {
    const key = weekOf(e.date || e.createdAt.slice(0, 10));
    totals.set(key, (totals.get(key) ?? 0) + valueOf(e));
  }
  // Weeks are already sortable as strings within a year, and the year prefix
  // keeps them ordered across one.
  return [...totals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, amount]) => ({ month, amount }));
}

export function buildReport(expenses: Expense[], subjectId?: string): Report {
  const spend = expenses.filter(isSpend);
  const settlements = expenses.filter(
    (e) => e.isSettlement && !((e as { deleted?: boolean }).deleted)
  );

  const total = spend.reduce((sum, e) => sum + e.amount, 0);

  const categories = new Map<string, number>();
  const months = new Map<string, number>();
  const groups = new Map<string | null, number>();
  const paid = new Map<string, number>();
  const shares = new Map<string, number>();

  let largest: Expense | null = null;
  for (const e of spend) {
    categories.set(e.category, (categories.get(e.category) ?? 0) + e.amount);
    months.set(monthOf(e), (months.get(monthOf(e)) ?? 0) + e.amount);
    groups.set(e.groupId, (groups.get(e.groupId) ?? 0) + e.amount);
    for (const p of e.paidBy) paid.set(p.personId, (paid.get(p.personId) ?? 0) + p.amount);
    for (const s of e.splits) shares.set(s.personId, (shares.get(s.personId) ?? 0) + s.amount);
    if (!largest || e.amount > largest.amount) largest = e;
  }

  const dates = spend.map(monthOf).filter(Boolean).sort();
  const byMonth: MonthPoint[] = dates.length
    ? monthRange(dates[0], dates[dates.length - 1]).map((month) => ({
        month,
        amount: months.get(month) ?? 0,
      }))
    : [];

  // share is against the total so the slices sum to 1; guard the empty case
  // rather than emitting NaN into the UI.
  const shareOf = (amount: number) => (total > 0 ? amount / total : 0);

  const byCategory: CategorySlice[] = [...categories.entries()]
    .map(([category, amount]) => ({ category, amount, share: shareOf(amount) }))
    .sort((a, b) => b.amount - a.amount);

  const byGroup: GroupSlice[] = [...groups.entries()]
    .map(([groupId, amount]) => ({ groupId, amount, share: shareOf(amount) }))
    .sort((a, b) => b.amount - a.amount);

  const everyone = new Set([...paid.keys(), ...shares.keys()]);
  const byMember: MemberLine[] = [...everyone]
    .map((personId) => {
      const p = paid.get(personId) ?? 0;
      const s = shares.get(personId) ?? 0;
      return { personId, paid: p, share: s, net: p - s };
    })
    .sort((a, b) => b.share - a.share);

  const allDates = spend.map((e) => e.date || e.createdAt.slice(0, 10)).filter(Boolean).sort();

  // Subject-scoped breakdowns, shared against the subject's own total so the
  // percentages describe their spending rather than the group's.
  const subjectCategories = new Map<string, number>();
  const subjectGroups = new Map<string | null, number>();
  let subjectTotal = 0;
  if (subjectId) {
    for (const e of spend) {
      const mine = shareForPerson(e, subjectId);
      if (mine === 0) continue;
      subjectTotal += mine;
      subjectCategories.set(e.category, (subjectCategories.get(e.category) ?? 0) + mine);
      subjectGroups.set(e.groupId, (subjectGroups.get(e.groupId) ?? 0) + mine);
    }
  }
  const subjectShareOf = (amount: number) => (subjectTotal > 0 ? amount / subjectTotal : 0);

  return {
    total,
    count: spend.length,
    average: spend.length ? Math.round(total / spend.length) : 0,
    largest,
    earliest: allDates[0] ?? '',
    latest: allDates[allDates.length - 1] ?? '',
    settledTotal: settlements.reduce((sum, e) => sum + e.amount, 0),
    settledCount: settlements.length,
    byCategory,
    byMonth,
    byMember,
    byGroup,
    subject: subjectId ? (byMember.find((m) => m.personId === subjectId) ?? null) : null,
    subjectByCategory: [...subjectCategories.entries()]
      .map(([category, amount]) => ({ category, amount, share: subjectShareOf(amount) }))
      .sort((a, b) => b.amount - a.amount),
    subjectByGroup: [...subjectGroups.entries()]
      .map(([groupId, amount]) => ({ groupId, amount, share: subjectShareOf(amount) }))
      .sort((a, b) => b.amount - a.amount),
  };
}
