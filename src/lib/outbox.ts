/**
 * Durable queue of expense changes that have not reached the server yet.
 *
 * Every write lands in local state immediately and in this queue, which drains
 * whenever the server is reachable again. Without it an expense added offline
 * lived only in memory: the set of in-flight ids was never persisted, nothing
 * ever retried a failed push, and the next /sync — which is server-wins —
 * deleted the row from the device for good.
 *
 * Retrying is safe because POST /api/expenses upserts on the client-supplied
 * id (INSERT OR REPLACE), so re-sending a create that already landed is a
 * no-op rather than a duplicate.
 *
 * Deliberately free of any React Native or api.ts import — the store, the
 * sender and the clock are all injected — so the queue logic can be exercised
 * in a plain Node test, the same way storageKeys.ts is.
 */

/** The subset of an expense the server needs. Mirrors ApiExpense. */
export interface QueuedExpense {
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
  paidBy: { personId: string; amount: number }[];
  splits: { personId: string; amount: number }[];
}

export type OutboxOp =
  | { kind: 'create'; expense: QueuedExpense }
  | { kind: 'update'; expense: QueuedExpense }
  | { kind: 'delete'; id: string };

export interface OutboxEntry {
  /** Identifies the queued operation itself, not the expense it acts on. */
  opId: string;
  op: OutboxOp;
  queuedAt: string;
  /** Failed sends so far; only ever incremented by a retryable failure. */
  attempts: number;
  /**
   * Set once an entry has failed enough times to be the suspect itself rather
   * than a symptom of the server being down. Until this time passes the drain
   * steps over it, so one unsendable change cannot hold up every later one.
   * ISO-8601 UTC, which compares correctly as a string.
   */
  restUntil?: string;
  /** Why it was last set aside, for the UI to report. */
  lastError?: string;
}

/**
 * Consecutive retryable failures before an entry is treated as the problem.
 *
 * Below this the reasonable reading is that the server is down, so the drain
 * stops and keeps the order intact. Above it, everything behind this entry has
 * been waiting on one change that may never go, which is worse than sending
 * things out of order across expenses.
 */
const MAX_ATTEMPTS = 5;

/** How long a suspect entry is stepped over before it is tried again. */
const REST_MS = 5 * 60 * 1000;

export function targetId(op: OutboxOp): string {
  return op.kind === 'delete' ? op.id : op.expense.id;
}

/**
 * A request that never reached the server, as opposed to one it refused.
 *
 * Duck-typed rather than an `instanceof ApiError` check so this module stays
 * importable from a plain Node test; ApiError sets exactly this flag.
 */
export function isOfflineError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { offline?: unknown }).offline === true;
}

/**
 * A failure worth repeating: no connection, or a server that answered about
 * its own state rather than about the change.
 *
 * This is the decision that keeps or destroys the user's work, and it has to
 * be the wider of the two tests. A 502 from the proxy while the API restarts
 * is an answer, so it is not "offline" — but treating it as a refusal deleted
 * queued expenses during an ordinary deploy.
 */
export function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { offline?: unknown; retryable?: unknown };
  return e.retryable === true || e.offline === true;
}

/**
 * Add an operation, folding it into one already queued for the same expense
 * where that is equivalent and cheaper.
 *
 * `inFlightOpId` is the entry currently on the wire. It is never rewritten or
 * dropped: the server may already have accepted it, so a follow-up has to go
 * over the wire as its own operation rather than quietly replacing it.
 */
export function enqueue(
  queue: OutboxEntry[],
  entry: OutboxEntry,
  inFlightOpId: string | null = null
): OutboxEntry[] {
  const id = targetId(entry.op);
  const busy = (e: OutboxEntry) => e.opId === inFlightOpId;
  const sameTarget = (e: OutboxEntry) => !busy(e) && targetId(e.op) === id;

  if (entry.op.kind === 'delete') {
    // A create that has not been sent means the server has no such row, so
    // both sides of "add it then remove it" cancel out entirely.
    const unsentCreate = queue.some((e) => sameTarget(e) && e.op.kind === 'create');
    const kept = queue.filter((e) => !sameTarget(e));
    return unsentCreate ? kept : [...kept, entry];
  }

  if (entry.op.kind === 'update') {
    // Bound outside the closure: narrowing on entry.op does not survive into it.
    const update = entry.op;
    let folded = false;
    const next = queue.map((e) => {
      if (!sameTarget(e)) return e;
      if (e.op.kind === 'create') {
        folded = true;
        // Stays a create: the server still has nothing to update.
        return { ...e, op: { kind: 'create' as const, expense: update.expense } };
      }
      if (e.op.kind === 'update') {
        folded = true;
        return { ...e, op: update };
      }
      return e;
    });
    if (folded) return next;
  }

  return [...queue, entry];
}

/** Expenses with an unsent create or edit — rows a server-wins sync must not drop. */
export function queuedExpenseIds(queue: OutboxEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const e of queue) if (e.op.kind !== 'delete') ids.add(targetId(e.op));
  return ids;
}

/** Expenses deleted here but not yet on the server, so a sync must not revive them. */
export function queuedDeleteIds(queue: OutboxEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const e of queue) if (e.op.kind === 'delete') ids.add(targetId(e.op));
  return ids;
}

export interface OutboxSender {
  createExpense(expense: QueuedExpense): Promise<unknown>;
  updateExpense(expense: QueuedExpense): Promise<unknown>;
  deleteExpense(id: string): Promise<unknown>;
}

export interface FlushResult {
  sent: number;
  /** Refused outright by the server, and therefore dropped from the queue. */
  rejected: { entry: OutboxEntry; error: string }[];
  /** The drain stopped early on something worth retrying, so work remains. */
  offline: boolean;
  /** Entries set aside after repeated failures; still queued, still safe. */
  stuck: number;
}

export interface OutboxDeps {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
  sender: OutboxSender;
  now?: () => string;
  newOpId?: () => string;
}

export interface Outbox {
  load: () => Promise<void>;
  snapshot: () => OutboxEntry[];
  size: () => number;
  expenseIds: () => Set<string>;
  deleteIds: () => Set<string>;
  add: (op: OutboxOp) => void;
  flush: () => Promise<FlushResult>;
  clear: () => Promise<void>;
  subscribe: (listener: () => void) => () => void;
}

export function createOutbox(deps: OutboxDeps): Outbox {
  const now = deps.now ?? (() => new Date().toISOString());
  const newOpId =
    deps.newOpId ?? (() => `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);

  let queue: OutboxEntry[] = [];
  let inFlight: string | null = null;
  let flushing = false;
  const listeners = new Set<() => void>();

  const notify = () => listeners.forEach((fn) => fn());

  const persist = async () => {
    try {
      await deps.write(JSON.stringify(queue));
    } catch {
      // The in-memory queue is still correct and the next change rewrites it.
      // Losing the write is survivable; taking the UI down over it is not.
    }
  };

  const send = (op: OutboxOp) => {
    if (op.kind === 'create') return deps.sender.createExpense(op.expense);
    if (op.kind === 'update') return deps.sender.updateExpense(op.expense);
    return deps.sender.deleteExpense(op.id);
  };

  return {
    load: async () => {
      try {
        const raw = await deps.read();
        const parsed = raw ? JSON.parse(raw) : [];
        // Anything malformed is discarded rather than trusted: a bad entry
        // would jam the head of the queue on every flush forever.
        queue = Array.isArray(parsed)
          ? parsed.filter(
              (e): e is OutboxEntry =>
                !!e && typeof e.opId === 'string' && !!e.op && typeof e.op.kind === 'string'
            )
          : [];
      } catch {
        queue = [];
      }
      notify();
    },

    snapshot: () => queue,
    size: () => queue.length,
    expenseIds: () => queuedExpenseIds(queue),
    deleteIds: () => queuedDeleteIds(queue),

    add: (op) => {
      queue = enqueue(queue, { opId: newOpId(), op, queuedAt: now(), attempts: 0 }, inFlight);
      notify();
      void persist();
    },

    flush: async () => {
      // One drain at a time, or two callers would send the same head twice.
      if (flushing) return { sent: 0, rejected: [], offline: false, stuck: 0 };
      flushing = true;

      const rejected: { entry: OutboxEntry; error: string }[] = [];
      let sent = 0;
      let offline = false;

      /**
       * The next entry that may go now.
       *
       * Ordering only has to hold per expense, not across the whole queue, so
       * an entry that is resting or already tried this pass blocks only the
       * later changes to that same expense — sending an update before its own
       * create would just fail, but letting an unrelated expense past costs
       * nothing.
       */
      const pick = (clock: string, tried: Set<string>): OutboxEntry | undefined => {
        const blocked = new Set<string>();
        for (const e of queue) {
          const id = targetId(e.op);
          if (tried.has(e.opId) || (e.restUntil && e.restUntil > clock)) {
            blocked.add(id);
            continue;
          }
          if (blocked.has(id)) continue;
          return e;
        }
        return undefined;
      };

      const update = (opId: string, patch: Partial<OutboxEntry>) => {
        queue = queue.map((e) => (e.opId === opId ? { ...e, ...patch } : e));
      };

      try {
        // Re-reads the queue each pass: a change made mid-drain appends to the
        // same queue, and ordering per expense has to hold.
        const tried = new Set<string>();

        for (;;) {
          const clock = now();
          const entry = pick(clock, tried);
          if (!entry) break;
          tried.add(entry.opId);

          inFlight = entry.opId;
          let failure: unknown = null;
          let failed = false;
          try {
            await send(entry.op);
          } catch (err) {
            failed = true;
            failure = err;
          } finally {
            inFlight = null;
          }

          if (failed && isRetryableError(failure)) {
            const attempts = entry.attempts + 1;
            const lastError =
              failure instanceof Error ? failure.message : 'Could not reach the server';
            offline = true;

            if (attempts < MAX_ATTEMPTS) {
              // The likeliest reading is that the server is down, not that
              // this change is bad — so stop, rather than walk the whole
              // queue failing every entry the same way and burning the
              // battery of a phone that already has no signal.
              update(entry.opId, { attempts, lastError });
              await persist();
              notify();
              break;
            }

            // It has failed on its own often enough that holding every later
            // change behind it is the bigger problem. Set it aside — still
            // queued, still protecting its row locally — and carry on.
            update(entry.opId, {
              attempts,
              lastError,
              restUntil: new Date(Date.parse(clock) + REST_MS).toISOString(),
            });
            await persist();
            notify();
            continue;
          }

          if (failed) {
            // The server understood and said no. Retrying cannot change that,
            // and leaving it queued would block every change behind it.
            rejected.push({
              entry,
              error: failure instanceof Error ? failure.message : 'The server rejected that change',
            });
          } else {
            sent++;
          }

          // Removed by opId rather than shifting: a concurrent add may have
          // folded into or reordered the tail while this was in flight.
          queue = queue.filter((e) => e.opId !== entry.opId);
          await persist();
          notify();
        }
      } finally {
        flushing = false;
      }

      return { sent, rejected, offline, stuck: queue.filter((e) => !!e.restUntil).length };
    },

    clear: async () => {
      queue = [];
      notify();
      await persist();
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
