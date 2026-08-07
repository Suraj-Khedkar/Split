import { useMemo } from 'react';

import {
  balanceBetween,
  computeBalances,
  netForPerson,
  simplifyDebts,
} from '../lib/balances';
import type { Balance, Debt, Expense } from '../types';
import { useStore } from './useStore';

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
