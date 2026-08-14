import { useMemo } from 'react';

import {
  balanceBetween,
  computeBalances,
  netForPerson,
  simplifyDebts,
} from '../lib/balances';
import { CATEGORIES } from '../theme';
import type { Balance, Debt, Expense, Group } from '../types';
import { useSettings } from './useSettings';
import { useStore } from './useStore';

/**
 * Every category that should appear in a picker.
 *
 * Three sources unioned: the built-in list, the ones this device invented, and
 * any already attached to an expense. That last one is what carries a category
 * between devices without a server change — it arrives with the expense.
 */
export function useCategories(): string[] {
  const expenses = useStore((s) => s.expenses);
  const custom = useSettings((s) => s.customCategories);
  return useMemo(() => {
    const all = new Set<string>(CATEGORIES);
    for (const name of custom) all.add(name);
    for (const e of expenses) {
      if (e.category && !e.isSettlement) all.add(e.category);
    }
    // Settlements get a category of their own internally; it is never a choice.
    all.delete('settlement');
    return [...all];
  }, [expenses, custom]);
}

/**
 * Groups you actually share with someone — everything the Groups tab shows.
 *
 * The personal ledger is deliberately excluded: it has one member, no
 * balances, and listing it beside real groups invites settling up with
 * yourself.
 */
export function useSharedGroups(): Group[] {
  const groups = useStore((s) => s.groups);
  return useMemo(() => groups.filter((g) => g.type !== 'personal'), [groups]);
}

/** The private single-member group holding solo spending, once synced. */
export function usePersonalGroup(): Group | null {
  const groups = useStore((s) => s.groups);
  return useMemo(() => groups.find((g) => g.type === 'personal') ?? null, [groups]);
}

/** Solo spends, newest first. Empty until the first sync creates the group. */
export function usePersonalExpenses(): Expense[] {
  const expenses = useStore((s) => s.expenses);
  const personal = usePersonalGroup();
  return useMemo(() => {
    if (!personal) return [];
    return expenses
      .filter((e) => e.groupId === personal.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [expenses, personal]);
}

/** Expenses belonging to one group, newest first. */
export function useGroupExpenses(groupId: string): Expense[] {
  const expenses = useStore((s) => s.expenses);
  return useMemo(
    () =>
      expenses
        .filter((e) => e.groupId === groupId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [expenses, groupId]
  );
}

export interface GroupSummary {
  balances: Balance[];
  debts: Debt[];
  /** What the device owner is up or down in this group. */
  myNet: number;
}

export function useGroupSummary(groupId: string): GroupSummary {
  const expenses = useGroupExpenses(groupId);
  const meId = useStore((s) => s.meId);
  return useMemo(() => {
    const balances = computeBalances(expenses);
    return {
      balances,
      debts: simplifyDebts(balances),
      myNet: netForPerson(balances, meId),
    };
  }, [expenses, meId]);
}

/** A settled group goes quiet for this long before it stops being listed. */
export const DORMANT_AFTER_DAYS = 30;

export interface GroupRow {
  group: Group;
  /** What the device owner is up or down here. */
  myNet: number;
  /** True when nobody in the group owes anybody — not just the device owner. */
  settled: boolean;
  /** Newest expense, or the group's creation date when it has none. */
  lastActivityAt: string;
}

export interface GroupBuckets {
  /** Money still outstanding. Always visible. */
  active: GroupRow[];
  /** Squared up, but recently used — listed under the active ones. */
  settled: GroupRow[];
  /** Squared up and quiet for a month. Hidden until asked for, never deleted. */
  dormant: GroupRow[];
}

/**
 * Split the shared groups into what still needs attention and what does not.
 *
 * "Settled" means every member's balance is zero, not just the device owner's:
 * a group where you are square but two other people are not is still live, and
 * burying it would hide money that is genuinely owed.
 */
export function useGroupBuckets(): GroupBuckets {
  const groups = useSharedGroups();
  const expenses = useStore((s) => s.expenses);
  const meId = useStore((s) => s.meId);

  return useMemo(() => {
    const cutoff = Date.now() - DORMANT_AFTER_DAYS * 864e5;

    const rows: GroupRow[] = groups.map((group) => {
      const mine = expenses.filter((e) => e.groupId === group.id);
      const balances = computeBalances(mine);
      const newest = mine.reduce(
        (latest, e) => (e.createdAt > latest ? e.createdAt : latest),
        group.createdAt ?? ''
      );
      return {
        group,
        myNet: netForPerson(balances, meId),
        // Rounding to the paisa: split remainders can leave a stray unit that
        // would otherwise keep a finished group looking active forever.
        settled: balances.every((b) => Math.round(b.amount) === 0),
        lastActivityAt: newest,
      };
    });

    const byRecency = (a: GroupRow, b: GroupRow) =>
      b.lastActivityAt.localeCompare(a.lastActivityAt);

    return {
      active: rows.filter((r) => !r.settled).sort(byRecency),
      settled: rows
        .filter((r) => r.settled && new Date(r.lastActivityAt).getTime() >= cutoff)
        .sort(byRecency),
      dormant: rows
        .filter((r) => r.settled && new Date(r.lastActivityAt).getTime() < cutoff)
        .sort(byRecency),
    };
  }, [groups, expenses, meId]);
}

/** Headline figure across every group and one-off expense. */
export function useOverallBalance(): number {
  const expenses = useStore((s) => s.expenses);
  const meId = useStore((s) => s.meId);
  return useMemo(
    () => netForPerson(computeBalances(expenses), meId),
    [expenses, meId]
  );
}

export interface FriendBalance {
  personId: string;
  /** Positive = they owe you. */
  amount: number;
}

/**
 * Net position with every other person, aggregated across all groups.
 * This is the Friends tab: Splitwise shows one number per person regardless of
 * which groups the debts came from.
 */
export function useFriendBalances(): FriendBalance[] {
  const expenses = useStore((s) => s.expenses);
  const people = useStore((s) => s.people);
  const meId = useStore((s) => s.meId);

  return useMemo(
    () =>
      people
        .filter((p) => p.id !== meId)
        .map((p) => ({
          personId: p.id,
          amount: balanceBetween(expenses, meId, p.id),
        })),
    [expenses, people, meId]
  );
}

/** Every expense touching a given person, newest first. */
export function usePersonExpenses(personId: string): Expense[] {
  const expenses = useStore((s) => s.expenses);
  return useMemo(
    () =>
      expenses
        .filter(
          (e) =>
            e.paidBy.some((p) => p.personId === personId) ||
            e.splits.some((s) => s.personId === personId)
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [expenses, personId]
  );
}
