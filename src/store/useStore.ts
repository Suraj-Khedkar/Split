import { useSyncExternalStore } from 'react';
import { create } from 'zustand';

import { api, isRetryable } from '../lib/api';
import { newId } from '../lib/id';
import { createOutbox, type FlushResult, type QueuedExpense } from '../lib/outbox';
import { readStored, writeStored } from '../lib/storage';
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

const STORAGE_KEY = 'v1';

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

const OUTBOX_KEY = 'outbox';

/**
 * Changes made here that the server has not accepted yet.
 *
 * Persisted, so an expense added on a train survives closing the app and is
 * still sent when the signal comes back. It also tells applyServerSnapshot
 * which rows to protect: a sync is server-wins, so without this list anything
 * not yet uploaded would be erased the moment the connection returned.
 */
export const outbox = createOutbox({
  read: () => readStored(OUTBOX_KEY),
  write: (value) => writeStored(OUTBOX_KEY, value),
  sender: {
    createExpense: (expense) => api.createExpense(expense),
    updateExpense: (expense) => api.updateExpense(expense),
    deleteExpense: (id) => api.deleteExpense(id),
  },
});

/** The server only takes expenses that belong to a group. */
function queueable(expense: Expense): QueuedExpense | null {
  if (!expense.groupId) return null;
  return {
    id: expense.id,
    groupId: expense.groupId,
    description: expense.description,
    amount: expense.amount,
    currency: expense.currency,
    category: expense.category,
    splitMethod: expense.splitMethod,
    date: expense.date,
    notes: expense.notes,
    isSettlement: expense.isSettlement,
    paidBy: expense.paidBy,
    splits: expense.splits,
  };
}

/**
 * Drain whatever is waiting to reach the server.
 *
 * Safe to call often — the outbox ignores a flush while one is already
 * running, and an empty queue costs nothing. Deliberately does not pull
 * afterwards: the callers that need the server's view already follow this
 * with one, and doing it here as well meant every sync downloaded the whole
 * snapshot twice, which is exactly the wrong tax on a weak connection.
 */
export async function syncOutbox(): Promise<FlushResult> {
  const result = await outbox.flush();
  const { sent, rejected, stuck } = result;

  if (rejected.length > 0) {
    // Refused, so it will never land however long it waits. Say so plainly
    // rather than letting the row sit there looking saved.
    const [first] = rejected;
    lastPushError =
      rejected.length === 1
        ? `A change could not be saved: ${first.error}`
        : `${rejected.length} changes could not be saved. ${first.error}`;
  } else if (stuck > 0) {
    // Still held, so nothing is lost — but it has been failing long enough
    // that silence would be misleading.
    lastPushError =
      stuck === 1
        ? 'A change is still waiting to reach the server. It will keep retrying.'
        : `${stuck} changes are still waiting to reach the server. They will keep retrying.`;
  } else if (sent > 0) {
    lastPushError = '';
  }

  return result;
}

/**
 * Drain, then pull — for a change this device just made.
 *
 * The pull is what picks up the rows only the server can write (the activity
 * trail), which the live socket deliberately does not echo back to the device
 * that caused them.
 */
async function pushThenPull(): Promise<void> {
  const { sent } = await syncOutbox();
  if (sent > 0) await resync();
}

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

function pushExpense(expense: Expense) {
  const payload = queueable(expense);
  if (!payload) {
    lastPushError =
      'That settlement is not attached to a group, so it cannot be shared. Settle up from inside a group.';
    return;
  }
  outbox.add({ kind: 'create', expense: payload });
  void pushThenPull();
}

async function persist(data: Data) {
  try {
    await writeStored(STORAGE_KEY, JSON.stringify(data));
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
      // Before any snapshot can be applied: applyServerSnapshot reads the
      // queue to decide what not to erase, and an empty queue means anything
      // added offline last session looks like a row the server has dropped.
      await outbox.load();
      try {
        const raw = await readStored(STORAGE_KEY);
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
      // Optimistic: the row is already on screen, and the outbox keeps it
      // alive until the server has it, however long that takes.
      pushExpense(expense);
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

        // Not reaching the server is not a refusal. Apply the edit locally
        // and queue it, the same as a new expense — the server just has not
        // had its say on the rounding yet, and will overwrite this row once
        // the queue drains. This covers a 502 from the proxy during a
        // restart as well as a dead connection; only an actual verdict on
        // the edit (a 4xx) falls through to the error below.
        if (isRetryable(err)) {
          const edited: Expense = {
            ...current,
            groupId: input.groupId,
            description: input.description.trim() || 'Expense',
            amount: input.amount,
            currency: input.currency ?? current.currency,
            category: input.category ?? current.category,
            paidBy,
            splits,
            splitMethod: input.splitMethod,
            date: input.date ?? current.date,
            notes: input.notes,
          };
          commit({ expenses: get().expenses.map((e) => (e.id === id ? edited : e)) });

          const payload = queueable(edited);
          if (payload) {
            outbox.add({ kind: 'update', expense: payload });
            return { ok: true, changed: 1 };
          }
        }

        lastPushError = error;
        return { ok: false, error, changed: 0 };
      }
    },

    deleteExpense: (id) => {
      commit({ expenses: get().expenses.filter((e) => e.id !== id) });
      // Queued like any other change, so a delete made offline is not undone
      // by the next sync finding the row still present on the server.
      outbox.add({ kind: 'delete', id });
      void pushThenPull();
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
      pushExpense(expense);
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
      // Changes this device has made but not yet uploaded. A snapshot is
      // server-wins, so these are exactly the rows it must not speak for.
      const queuedIds = outbox.expenseIds();
      const deletedHere = outbox.deleteIds();

      const expenses: Expense[] = snapshot.expenses
        .filter((e) => !e.deleted && !deletedHere.has(e.id))
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

      // Carry over anything still queued so a poll cannot erase a row the user
      // just created, and keep the local copy of a row whose edit is still
      // waiting — the server's version is the one being replaced.
      const serverIds = new Set(expenses.map((e) => e.id));
      const local = get().expenses;
      const stillQueued = local.filter((e) => queuedIds.has(e.id) && !serverIds.has(e.id));
      const reconciled = expenses.map((e) =>
        queuedIds.has(e.id) ? local.find((l) => l.id === e.id) ?? e : e
      );

      commit({
        meId: snapshot.user.id,
        people,
        groups,
        expenses: [...stillQueued, ...reconciled].sort((a, b) =>
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
      // Or the next account to sign in on this device would inherit the
      // previous one's unsent expenses and post them as its own.
      await outbox.clear();
      await persist(blank);
    },
  };
});

// Module-level so useSyncExternalStore sees the same references every render
// and does not tear the subscription down and rebuild it each time.
const subscribeOutbox = (onChange: () => void) => outbox.subscribe(onChange);
const outboxSize = () => outbox.size();

/** How many changes are still waiting to reach the server. */
export function usePendingCount(): number {
  return useSyncExternalStore(subscribeOutbox, outboxSize, outboxSize);
}

/** Stable lookup used all over the UI. */
export function personName(people: Person[], id: string, meId: string): string {
  if (id === meId) return 'You';
  return people.find((p) => p.id === id)?.name ?? 'Someone';
}
