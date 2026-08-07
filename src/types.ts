/**
 * Core domain types.
 *
 * Money is stored in minor units (paise/cents) as integers everywhere. Splitting
 * a bill three ways is the canonical floating-point trap - 0.1 + 0.2 !== 0.3 -
 * and a cent that vanishes on every expense turns into visibly wrong balances.
 * Conversion back to a decimal string happens only at the display layer.
 */

export type SplitMethod = 'equal' | 'exact' | 'percent' | 'shares';

export type GroupType = 'trip' | 'home' | 'couple' | 'other';

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
