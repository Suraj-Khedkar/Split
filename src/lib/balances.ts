import type { Balance, Debt, Expense, SplitShare } from '../types';

/**
 * Net balance per person across a set of expenses.
 *
 * Positive = owed money (paid more than their share).
 * Negative = owes money.
 * The two always sum to zero, which is the invariant the tests assert.
 */
export function computeBalances(expenses: Expense[]): Balance[] {
  const net = new Map<string, number>();
  const bump = (id: string, delta: number) =>
    net.set(id, (net.get(id) ?? 0) + delta);

  for (const expense of expenses) {
    for (const payer of expense.paidBy) bump(payer.personId, payer.amount);
    for (const split of expense.splits) bump(split.personId, -split.amount);
  }

  return [...net.entries()]
    .map(([personId, amount]) => ({ personId, amount }))
    .filter((b) => b.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
}

/** Net amount between exactly two people. Positive = `personId` is owed. */
export function balanceBetween(
  expenses: Expense[],
  personId: string,
  otherId: string
): number {
  let total = 0;
  for (const expense of expenses) {
    const paid = sumFor(expense.paidBy, personId);
    const owes = sumFor(expense.splits, personId);
    const otherPaid = sumFor(expense.paidBy, otherId);
    const otherOwes = sumFor(expense.splits, otherId);

    // Only the portion of this expense that involves both of them matters.
    const involves = (paid || owes) && (otherPaid || otherOwes);
    if (!involves) continue;

    total += paid ? Math.min(otherOwes, paid) : 0;
    total -= otherPaid ? Math.min(owes, otherPaid) : 0;
  }
  return total;
}

function sumFor(shares: SplitShare[], personId: string): number {
  let total = 0;
  for (const share of shares) {
    if (share.personId === personId) total += share.amount;
  }
  return total;
}

/**
 * Turn net balances into the fewest payments that clear them - Splitwise's
 * "simplify debts".
 *
 * Greedy largest-creditor / largest-debtor matching: each step fully settles at
 * least one person, so it terminates in at most n-1 transfers versus the
 * O(n^2) you get from settling every pair individually. This is not guaranteed
 * minimal (that problem is NP-hard) but it hits n-1 in the common cases and is
 * what users actually expect to see.
 */
export function simplifyDebts(balances: Balance[]): Debt[] {
  const creditors = balances
    .filter((b) => b.amount > 0)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.amount - a.amount);
  const debtors = balances
    .filter((b) => b.amount < 0)
    .map((b) => ({ personId: b.personId, amount: -b.amount }))
    .sort((a, b) => b.amount - a.amount);

  const debts: Debt[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci];
    const debtor = debtors[di];
    const amount = Math.min(creditor.amount, debtor.amount);

    if (amount > 0) {
      debts.push({ fromId: debtor.personId, toId: creditor.personId, amount });
      creditor.amount -= amount;
      debtor.amount -= amount;
    }

    if (creditor.amount === 0) ci += 1;
    if (debtor.amount === 0) di += 1;
  }

  return debts;
}

/** Everything one person owes or is owed, as concrete instructions. */
/** Single headline number: what this person is up or down overall. */
export function netForPerson(balances: Balance[], personId: string): number {
  return balances.find((b) => b.personId === personId)?.amount ?? 0;
}
