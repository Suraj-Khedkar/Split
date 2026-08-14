/**
 * Core domain types.
 *
 * Money is stored in minor units (paise/cents) as integers everywhere. Splitting
 * a bill three ways is the canonical floating-point trap - 0.1 + 0.2 !== 0.3 -
 * and a cent that vanishes on every expense turns into visibly wrong balances.
 * Conversion back to a decimal string happens only at the display layer.
 */

/**
 * `adjust` and `reduce` are the two halves of equal-with-an-exception:
 * everyone splits evenly except that named people carry an extra amount on top
 * (`adjust`) or come off it (`reduce`). One person's round of drinks on a
 * shared dinner bill; one person who skipped dessert.
 */
export type SplitMethod =
  | 'equal'
  | 'exact'
  | 'percent'
  | 'shares'
  | 'adjust'
  | 'reduce';

/**
 * 'personal' is the odd one out: a private, single-member group holding spends
 * that are nobody's but yours. It is a group only so that storage, sync and
 * balance math need no special case — the UI never lists it as one.
 */
export type GroupType = 'trip' | 'home' | 'couple' | 'other' | 'personal';

export interface Person {
  id: string;
  name: string;
  /** Local-only in this build: there are no accounts or server. */
  email?: string;
  /** Deterministic avatar tint; index into theme.avatarColors. */
  colorIndex: number;
  /** Named in a group but has no account yet; can be claimed on sign-up. */
  isAlias?: boolean;
}

export interface Group {
  id: string;
  name: string;
  type: GroupType;
  memberIds: string[];
  currency: string;
  createdAt: string;
}

/** One participant's slice of a single expense, in minor units. */
export interface SplitShare {
  personId: string;
  amount: number;
}

export interface Expense {
  id: string;
  /** null = a one-off expense with a friend, outside any group. */
  groupId: string | null;
  description: string;
  /** Total, minor units. */
  amount: number;
  currency: string;
  category: string;
  /** Who actually paid, and how much. Supports multiple payers. */
  paidBy: SplitShare[];
  /** Who owes what. Sum equals amount. */
  splits: SplitShare[];
  splitMethod: SplitMethod;
  date: string;
  notes?: string;
  createdAt: string;
  /**
   * Settlements are expenses too - a direct payment from one person to
   * another. Keeping them in one ledger means balance math has a single
   * code path instead of two that can disagree.
   */
  isSettlement: boolean;
}

/**
 * One field that changed in an edit.
 *
 * `from` and `to` arrive already rendered by the server, resolved against the
 * names and formatting in force when the edit was made — so the history still
 * reads correctly after someone renames themselves or leaves the group.
 */
export interface ExpenseChange {
  field: string;
  from: string;
  to: string;
}

export type ActivityAction = 'created' | 'edited' | 'deleted' | 'settled' | 'joined';

/**
 * One entry in the permanent trail: who did what to a group's money, and when.
 *
 * Append-only by design. Nothing in the app deletes or rewrites these, and a
 * deleted expense keeps its entries — that is the whole point of having them.
 */
export interface ActivityEntry {
  id: string;
  groupId: string;
  /** Absent for group-level events such as someone joining. */
  expenseId?: string;
  actorId: string;
  action: ActivityAction;
  at: string;
  /** Rendered when the event happened, so it survives the expense's deletion. */
  summary: string;
  /** Populated for edits only. */
  changes: ExpenseChange[];
}

/** Net position. Positive means this person is owed money. */
export interface Balance {
  personId: string;
  amount: number;
}

/** A concrete "A pays B" instruction. */
export interface Debt {
  fromId: string;
  toId: string;
  amount: number;
}
