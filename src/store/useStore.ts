import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { api } from '../lib/api';
import { newId } from '../lib/id';
import { buildSplits, singlePayer } from '../lib/split';
import type {
  ActivityEntry,
  Expense,
  Group,
  GroupType,
  Person,
  SplitMethod,
  SplitShare,
} from '../types';

const STORAGE_KEY = 'splitwise-clone/v1';

interface Data {
  /** The device owner. Every "you owe / you are owed" view is relative to this. */
  meId: string;
  people: Person[];
  groups: Group[];
  expenses: Expense[];
  /** Server-owned and append-only; kept here so the trail reads offline too. */
  activity: ActivityEntry[];
  /** Mutual connections, which may include people you share no group with. */
  friendIds: string[];
}

export interface ServerSnapshot {
  user: { id: string; name: string; email: string; colorIndex: number };
  people: { id: string; name: string; email: string; colorIndex: number; isAlias?: boolean }[];
  groups: {
    id: string;
    name: string;
    type: string;
    currency: string;
    memberIds: string[];
    createdAt: string;
  }[];
  expenses: {
    id: string;
    groupId: string;
    description: string;
    amount: number;
    currency: string;
    category: string;
    splitMethod: string;
    date: string;
    notes?: string;
    isSettlement: boolean;
    deleted: boolean;
    createdAt: string;
    paidBy: { personId: string; amount: number }[];
    splits: { personId: string; amount: number }[];
  }[];
  /** Optional so a snapshot from an older server still applies cleanly. */
  activity?: ActivityEntry[];
  friendIds?: string[];
}

interface Store extends Data {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setIdentity: (userId: string) => void;
  applyServerSnapshot: (snapshot: ServerSnapshot) => void;
  clearAll: () => Promise<void>;

  addPerson: (name: string, email?: string) => Person;
  addGroup: (name: string, type: GroupType, memberIds: string[], currency?: string) => Group;
  updateGroup: (id: string, patch: Partial<Group>) => void;
  deleteGroup: (id: string) => void;

  addExpense: (input: NewExpense) => Expense;
  /** Resolves once the server has accepted (or refused) the edit. */
  editExpense: (
    id: string,
    input: NewExpense
  ) => Promise<{ ok: boolean; error?: string; changed: number }>;
  deleteExpense: (id: string) => void;
  settleUp: (fromId: string, toId: string, amount: number, groupId: string | null, currency?: string) => Expense;
}

export interface NewExpense {
  groupId: string | null;
  description: string;
  amount: number;
  currency?: string;
  category?: string;
  /** Single payer, the common case. Ignored when paidBy is supplied. */
  paidById?: string;
  /** Several payers splitting the bill between them. Must sum to amount. */
  paidBy?: SplitShare[];
  participantIds: string[];
  splitMethod: SplitMethod;
  /** Per-person values for exact / percent / shares. */
  splitInputs?: Record<string, number>;
  date?: string;
  notes?: string;
}

function empty(): Data {
  return { meId: '', people: [], groups: [], expenses: [], activity: [], friendIds: [] };
}

/** Last push failure, surfaced in the UI instead of being swallowed. */
let lastPushError = '';
export const getLastPushError = () => lastPushError;

/**
 * Expenses posted but not yet confirmed by a sync.
 *
 * Polling replaces local state with the server's, so without this an expense
 * added seconds before a tick would blink out of existence until the push
 * completed. Ids stay here until the server reports them back.
 */
const pending = new Set<string>();

/**
 * Pull the server's view straight after a mutation this device made.
 *
 * The live-update socket deliberately skips the device that made a change —
 * it already applied it optimistically, so echoing it back would be waste.
 * But some rows are authored by the *server*: the activity trail is written
 * there, and this device has no way to invent it. Without this, an expense you
 * deleted yourself only showed up in Activity after a restart, because the
 * fallback poll only runs while the socket is down.
 *
 * Failure is silent on purpose: the change itself already succeeded, and the
 * next socket nudge or poll will catch up.
 */
async function resync() {
  try {
    const snapshot = await api.sync();
    useStore.getState().applyServerSnapshot(snapshot);
  } catch {
    // Offline. The local view is still correct for everything this device did.
  }
}

async function pushExpense(expense: Expense) {
  if (!expense.groupId) {
    lastPushError =
      'That settlement is not attached to a group, so it cannot be shared. Settle up from inside a group.';
    return;
  }
  pending.add(expense.id);
  try {
    await api.createExpense({ ...expense, groupId: expense.groupId });
    lastPushError = '';
  } catch (err) {
    lastPushError = err instanceof Error ? err.message : 'Could not save to the server';
    // Keep it pending: a later sync will not wipe it, and the error is shown.
    return;
  }
  pending.delete(expense.id);
  await resync();
}

async function persist(data: Data) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // A failed write must not take the UI down; the in-memory state is still
    // correct and the next mutation retries.
  }
}

export const useStore = create<Store>((set, get) => {
  const snapshot = (): Data => {
    const { meId, people, groups, expenses, activity, friendIds } = get();
    return { meId, people, groups, expenses, activity, friendIds };
  };
  const commit = (patch: Partial<Data>) => {
    set(patch as never);
    void persist({ ...snapshot(), ...patch });
  };

  return {
    ...empty(),
    hydrated: false,

    hydrate: async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as Data;
          if (saved?.people?.length) {
            // Anything written before the trail existed has no activity list
            // at all. Without this default the first launch after upgrading
            // would crash every screen that reads it.
            set({
              ...saved,
              activity: saved.activity ?? [],
              friendIds: saved.friendIds ?? [],
              hydrated: true,
            });
            return;
          }
        }
      } catch {
        // Corrupt or unreadable storage falls through to an empty ledger; the
        // next sync refills it from the server, which is the real source of
        // truth now.
      }
      set({ hydrated: true });
    },

    addPerson: (name, email) => {
      const person: Person = {
        id: newId('p'),
        name: name.trim() || 'Someone',
        email: email?.trim() || undefined,
        colorIndex: get().people.length % 8,
      };
      commit({ people: [...get().people, person] });
      return person;
    },

    addGroup: (name, type, memberIds, currency = 'INR') => {
      const meId = get().meId;
      const group: Group = {
        id: newId('g'),
        name: name.trim() || 'New group',
        type,
        memberIds: [...new Set([meId, ...memberIds])],
        currency,
        createdAt: new Date().toISOString(),
      };
      commit({ groups: [...get().groups, group] });
      return group;
    },

    updateGroup: (id, patch) =>
      commit({
        groups: get().groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
      }),

    deleteGroup: (id) =>
      commit({
        groups: get().groups.filter((g) => g.id !== id),
        // Orphaned expenses would keep skewing balances forever.
        expenses: get().expenses.filter((e) => e.groupId !== id),
      }),

    addExpense: (input) => {
      const splits = buildSplits(
        input.splitMethod,
        input.amount,
        input.participantIds,
        input.splitInputs ?? {}
      );
      const expense: Expense = {
        id: newId('e'),
        groupId: input.groupId,
        description: input.description.trim() || 'Expense',
        amount: input.amount,
        currency: input.currency ?? 'INR',
        category: input.category ?? 'general',
        paidBy:
          input.paidBy && input.paidBy.length > 0
            ? input.paidBy.filter((p) => p.amount !== 0)
            : singlePayer(input.paidById ?? '', input.amount),
        splits,
        splitMethod: input.splitMethod,
        date: input.date ?? new Date().toISOString().slice(0, 10),
        notes: input.notes,
        createdAt: new Date().toISOString(),
        isSettlement: false,
      };
      commit({ expenses: [expense, ...get().expenses] });
      // Optimistic: the row is already on screen. A failed push is recorded
      // and surfaced rather than silently vanishing at the next sync.
      void pushExpense(expense);
      return expense;
    },

    /**
     * Edit an existing expense through the server, which records what changed.
     *
     * Deliberately not optimistic, unlike addExpense: the server reconciles the
     * split and is the only side that can reject an unbalanced edit, so showing
     * the new numbers before it agrees would mean rendering a state that may
     * never exist. An edit is also rare enough that the wait is not felt.
     */
    editExpense: async (id, input) => {
      const current = get().expenses.find((e) => e.id === id);
      if (!current) return { ok: false, error: 'That expense is no longer here.', changed: 0 };
      if (!input.groupId) {
        return {
          ok: false,
          error: 'That expense is not attached to a group, so it cannot be edited.',
          changed: 0,
        };
      }

      const paidBy =
        input.paidBy && input.paidBy.length > 0
          ? input.paidBy.filter((p) => p.amount !== 0)
          : singlePayer(input.paidById ?? get().meId, input.amount);
      const splits = buildSplits(
        input.splitMethod,
        input.amount,
        input.participantIds,
        input.splitInputs ?? {}
      );

      try {
        const { expense, changes } = await api.updateExpense({
          id,
          groupId: input.groupId,
          description: input.description.trim() || 'Expense',
          amount: input.amount,
          currency: input.currency ?? current.currency,
          category: input.category ?? current.category,
          splitMethod: input.splitMethod,
          date: input.date ?? current.date,
          notes: input.notes,
          paidBy,
          splits,
        });
        // Take the server's version rather than the local guess — it is the
        // side that rounded the split, so this cannot drift by a paisa.
        commit({
          expenses: get().expenses.map((e) =>
            e.id === id
              ? {
                  ...e,
                  description: expense.description,
                  amount: expense.amount,
                  currency: expense.currency,
                  category: expense.category,
                  paidBy: expense.paidBy,
                  splits: expense.splits,
                  splitMethod: (expense.splitMethod as SplitMethod) ?? e.splitMethod,
                  date: expense.date,
                  notes: expense.notes,
                }
              : e
          ),
        });
        lastPushError = '';
        await resync();
        return { ok: true, changed: changes.length };
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Could not save the edit';
        lastPushError = error;
        return { ok: false, error, changed: 0 };
      }
    },

    deleteExpense: (id) => {
      pending.delete(id);
      commit({ expenses: get().expenses.filter((e) => e.id !== id) });
      void (async () => {
        try {
          await api.deleteExpense(id);
        } catch (err) {
          lastPushError = err instanceof Error ? err.message : 'Could not delete on the server';
          return;
        }
        // The server wrote a "deleted" entry to the trail that only it knows
        // about, and the socket will not tell this device about its own change.
        await resync();
      })();
    },

    settleUp: (fromId, toId, amount, groupId, currency = 'INR') => {
      // Modelled as an expense the payer covered entirely on the payee's
      // behalf, so it flows through the same balance math as everything else.
      const expense: Expense = {
        id: newId('s'),
        groupId,
        description: 'Settle up',
        amount,
        currency,
        category: 'settlement',
        paidBy: singlePayer(fromId, amount),
        splits: [{ personId: toId, amount }],
        splitMethod: 'exact',
        date: new Date().toISOString().slice(0, 10),
        createdAt: new Date().toISOString(),
        isSettlement: true,
      };
      commit({ expenses: [expense, ...get().expenses] });
      // Without this the settlement lived only in local state and the next
      // sync — which is server-authoritative — silently erased it.
      void pushExpense(expense);
      return expense;
    },

    /** Called after login so "You" resolves to the signed-in account. */
    setIdentity: (userId: string) => commit({ meId: userId }),

    /**
     * Replace local state with what the server holds.
     *
     * Server-wins rather than a merge: with one writer per device and every
     * mutation posted immediately, a merge would add conflict handling for a
     * case that cannot currently arise, and silently resurrect deleted rows.
     */
    applyServerSnapshot: (snapshot: ServerSnapshot) => {
      const people: Person[] = snapshot.people.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        colorIndex: p.colorIndex ?? 0,
        isAlias: p.isAlias,
      }));
      const groups: Group[] = snapshot.groups.map((g) => ({
        id: g.id,
        name: g.name,
        type: (g.type as GroupType) ?? 'other',
        memberIds: g.memberIds,
        currency: g.currency,
        createdAt: g.createdAt,
      }));
      const expenses: Expense[] = snapshot.expenses
        .filter((e) => !e.deleted)
        .map((e) => ({
          id: e.id,
          groupId: e.groupId,
          description: e.description,
          amount: e.amount,
          currency: e.currency,
          category: e.category,
          paidBy: e.paidBy,
          splits: e.splits,
          splitMethod: (e.splitMethod as SplitMethod) ?? 'equal',
          date: e.date,
          notes: e.notes,
          createdAt: e.createdAt,
          isSettlement: e.isSettlement,
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      // Carry over anything still in flight so a poll cannot erase a row the
      // user just created.
      const serverIds = new Set(expenses.map((e) => e.id));
      const inFlight = get().expenses.filter(
        (e) => pending.has(e.id) && !serverIds.has(e.id)
      );
      for (const e of expenses) pending.delete(e.id);

      commit({
        meId: snapshot.user.id,
        people,
        groups,
        expenses: [...inFlight, ...expenses].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt)
        ),
        // The server owns this outright, so it replaces rather than merges.
        // Keeping the previous list when the field is absent stops a snapshot
        // from an older server build from wiping history off the device.
        activity: (snapshot.activity ?? get().activity ?? [])
          .slice()
          .sort((a, b) => b.at.localeCompare(a.at)),
        friendIds: snapshot.friendIds ?? get().friendIds ?? [],
      });
    },

    clearAll: async () => {
      const blank = empty();
      set({ ...blank, hydrated: true });
      await persist(blank);
    },
  };
});

/** Stable lookup used all over the UI. */
export function personName(people: Person[], id: string, meId: string): string {
  if (id === meId) return 'You';
  return people.find((p) => p.id === id)?.name ?? 'Someone';
}
