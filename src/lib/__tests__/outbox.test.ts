import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  createOutbox,
  enqueue,
  isOfflineError,
  isRetryableError,
  queuedDeleteIds,
  queuedExpenseIds,
  type OutboxEntry,
  type OutboxOp,
  type QueuedExpense,
} from '../outbox';

function expense(id: string, amount = 1000): QueuedExpense {
  return {
    id,
    groupId: 'g1',
    description: 'Dinner',
    amount,
    currency: 'INR',
    category: 'food',
    splitMethod: 'equal',
    date: '2026-08-21',
    isSettlement: false,
    paidBy: [{ personId: 'u1', amount }],
    splits: [{ personId: 'u1', amount }],
  };
}

function entry(opId: string, op: OutboxOp): OutboxEntry {
  return { opId, op, queuedAt: '2026-08-21T00:00:00.000Z', attempts: 0 };
}

/** What api.ts throws when the request never left the device. */
function offlineError() {
  return Object.assign(new Error('Cannot reach the server. Check your connection.'), {
    offline: true,
  });
}

// --- queue algebra -------------------------------------------------------

test('an unsent create followed by a delete cancels out entirely', () => {
  let q = enqueue([], entry('op1', { kind: 'create', expense: expense('e1') }));
  q = enqueue(q, entry('op2', { kind: 'delete', id: 'e1' }));
  assert.deepEqual(q, [], 'the server never saw it, so there is nothing to delete');
});

test('a delete still goes when the create is already on the wire', () => {
  let q = enqueue([], entry('op1', { kind: 'create', expense: expense('e1') }));
  // op1 in flight: it may already have landed, so it cannot be dropped.
  q = enqueue(q, entry('op2', { kind: 'delete', id: 'e1' }), 'op1');
  assert.equal(q.length, 2);
  assert.deepEqual(
    q.map((e) => e.op.kind),
    ['create', 'delete']
  );
});

test('editing an unsent expense rewrites the create rather than queuing both', () => {
  let q = enqueue([], entry('op1', { kind: 'create', expense: expense('e1', 1000) }));
  q = enqueue(q, entry('op2', { kind: 'update', expense: expense('e1', 2500) }));
  assert.equal(q.length, 1);
  assert.equal(q[0].op.kind, 'create', 'the server still has no row to update');
  assert.equal(q[0].op.kind === 'create' && q[0].op.expense.amount, 2500);
});

test('repeated edits collapse to the latest', () => {
  let q = enqueue([], entry('op1', { kind: 'update', expense: expense('e1', 100) }));
  q = enqueue(q, entry('op2', { kind: 'update', expense: expense('e1', 200) }));
  q = enqueue(q, entry('op3', { kind: 'update', expense: expense('e1', 300) }));
  assert.equal(q.length, 1);
  assert.equal(q[0].op.kind === 'update' && q[0].op.expense.amount, 300);
});

test('changes to different expenses keep their order', () => {
  let q = enqueue([], entry('op1', { kind: 'create', expense: expense('e1') }));
  q = enqueue(q, entry('op2', { kind: 'create', expense: expense('e2') }));
  q = enqueue(q, entry('op3', { kind: 'delete', id: 'e3' }));
  assert.deepEqual(
    q.map((e) => (e.op.kind === 'delete' ? e.op.id : e.op.expense.id)),
    ['e1', 'e2', 'e3']
  );
});

test('the two id sets separate rows to keep from rows to hide', () => {
  const q = [
    entry('op1', { kind: 'create', expense: expense('e1') }),
    entry('op2', { kind: 'update', expense: expense('e2') }),
    entry('op3', { kind: 'delete', id: 'e3' }),
  ];
  assert.deepEqual([...queuedExpenseIds(q)].sort(), ['e1', 'e2']);
  assert.deepEqual([...queuedDeleteIds(q)], ['e3']);
});

test('an offline error is told apart from a refusal', () => {
  assert.equal(isOfflineError(offlineError()), true);
  assert.equal(isOfflineError(new Error('Amount must be positive')), false);
  assert.equal(isOfflineError(null), false);
});

// --- draining ------------------------------------------------------------

/** An outbox over an in-memory store, with a sender the test drives. */
function harness() {
  let stored: string | null = null;
  const sent: string[] = [];
  let failWith: (() => unknown) | null = null;
  let counter = 0;
  // Movable so a test can step past the rest period the outbox gives an entry
  // that keeps failing; it never moves on its own.
  let clock = Date.parse('2026-08-21T00:00:00.000Z');

  const box = createOutbox({
    read: async () => stored,
    write: async (v) => void (stored = v),
    now: () => new Date(clock).toISOString(),
    newOpId: () => `op${++counter}`,
    sender: {
      createExpense: async (e) => {
        if (failWith) throw failWith();
        sent.push(`create:${e.id}`);
      },
      updateExpense: async (e) => {
        if (failWith) throw failWith();
        sent.push(`update:${e.id}`);
      },
      deleteExpense: async (id) => {
        if (failWith) throw failWith();
        sent.push(`delete:${id}`);
      },
    },
  });

  return {
    box,
    sent,
    goOffline: (make: () => unknown = offlineError) => void (failWith = make),
    goOnline: () => void (failWith = null),
    advance: (ms: number) => void (clock += ms),
    raw: () => stored,
    reload: () => stored,
  };
}

let h: ReturnType<typeof harness>;
beforeEach(() => void (h = harness()));

test('a queued change is sent once the server is reachable', async () => {
  h.goOffline();
  h.box.add({ kind: 'create', expense: expense('e1') });

  let result = await h.box.flush();
  assert.equal(result.offline, true);
  assert.equal(result.sent, 0);
  assert.equal(h.box.size(), 1, 'kept for later, not discarded');

  h.goOnline();
  result = await h.box.flush();
  assert.equal(result.sent, 1);
  assert.equal(h.box.size(), 0);
  assert.deepEqual(h.sent, ['create:e1']);
});

test('an expense added offline survives a restart', async () => {
  h.goOffline();
  h.box.add({ kind: 'create', expense: expense('e1') });
  await h.box.flush();

  // A new process: same persisted bytes, fresh in-memory queue. This is the
  // case that used to lose the expense outright.
  const persisted = h.raw();
  const next = harness();
  const revived = createOutbox({
    read: async () => persisted,
    write: async () => {},
    sender: next.box as never,
  });
  await revived.load();

  assert.equal(revived.size(), 1);
  assert.deepEqual([...revived.expenseIds()], ['e1']);
});

test('the drain stops at the first unreachable send, preserving order', async () => {
  h.box.add({ kind: 'create', expense: expense('e1') });
  h.box.add({ kind: 'create', expense: expense('e2') });
  h.goOffline();

  const result = await h.box.flush();
  assert.equal(result.offline, true);
  assert.equal(h.box.size(), 2, 'nothing behind the failure is skipped');
  assert.equal(h.box.snapshot()[0].attempts, 1, 'only the head is charged an attempt');
  assert.equal(h.box.snapshot()[1].attempts, 0);
});

test('a change the server refuses is dropped so it cannot jam the queue', async () => {
  h.box.add({ kind: 'create', expense: expense('e1') });
  h.box.add({ kind: 'create', expense: expense('e2') });
  // A refusal, not a network failure: no offline flag.
  h.goOffline(() => new Error('Splits do not add up to the amount'));

  const result = await h.box.flush();
  assert.equal(result.offline, false);
  assert.equal(result.rejected.length, 2);
  assert.equal(result.rejected[0].error, 'Splits do not add up to the amount');
  assert.equal(h.box.size(), 0, 'both dropped rather than retried forever');
});

test('a refusal does not stop the changes behind it from being sent', async () => {
  let calls = 0;
  let stored: string | null = null;
  const sent: string[] = [];
  const box = createOutbox({
    read: async () => stored,
    write: async (v) => void (stored = v),
    newOpId: () => `op${++calls}`,
    sender: {
      createExpense: async (e) => {
        if (e.id === 'bad') throw new Error('Amount must be positive');
        sent.push(e.id);
      },
      updateExpense: async () => {},
      deleteExpense: async () => {},
    },
  });

  box.add({ kind: 'create', expense: expense('bad') });
  box.add({ kind: 'create', expense: expense('good') });

  const result = await box.flush();
  assert.equal(result.rejected.length, 1);
  assert.equal(result.sent, 1);
  assert.deepEqual(sent, ['good'], 'the healthy change still got through');
});

test('overlapping flushes do not send the same change twice', async () => {
  h.box.add({ kind: 'create', expense: expense('e1') });
  const [a, b] = await Promise.all([h.box.flush(), h.box.flush()]);
  assert.equal(a.sent + b.sent, 1);
  assert.deepEqual(h.sent, ['create:e1']);
});

test('a malformed stored queue is discarded rather than jamming every flush', async () => {
  const box = createOutbox({
    read: async () => '{"not":"an array"}',
    write: async () => {},
    sender: h.box as never,
  });
  await box.load();
  assert.equal(box.size(), 0);
});

test('subscribers are told when the backlog changes', async () => {
  let ticks = 0;
  const off = h.box.subscribe(() => ticks++);
  h.box.add({ kind: 'create', expense: expense('e1') });
  assert.ok(ticks > 0);
  off();
  const before = ticks;
  h.box.add({ kind: 'create', expense: expense('e2') });
  assert.equal(ticks, before, 'unsubscribed');
});

// --- transient server failures -------------------------------------------

/**
 * What api.ts throws when the reply came from the proxy rather than the API:
 * an answer, so not `offline`, but not a verdict on the change either.
 */
function gatewayError() {
  return Object.assign(new Error('API server is not running'), {
    retryable: true,
    status: 502,
  });
}

test('a reachable server is not the only retryable failure', () => {
  assert.equal(isRetryableError(offlineError()), true, 'no connection');
  assert.equal(isRetryableError(gatewayError()), true, 'proxy answered for a dead API');
  assert.equal(isRetryableError(new Error('Amount must be positive')), false);
  assert.equal(isRetryableError(null), false);
});

test('a 502 while the API restarts keeps the change instead of dropping it', async () => {
  // The regression this guards: the proxy answers 502 when the API process is
  // restarting, which is an ordinary deploy. Reading that as a refusal
  // discarded the queued expense, and the next server-wins sync then erased
  // it from the device — the user's expense gone, with no error they could act
  // on.
  h.goOffline(gatewayError);
  h.box.add({ kind: 'create', expense: expense('e1') });

  const result = await h.box.flush();
  assert.equal(result.sent, 0);
  assert.deepEqual(result.rejected, [], 'not a refusal');
  assert.equal(result.offline, true);
  assert.equal(h.box.size(), 1, 'still queued');
  assert.ok(h.box.expenseIds().has('e1'), 'and still protected from a sync');

  h.goOnline();
  assert.equal((await h.box.flush()).sent, 1);
  assert.deepEqual(h.sent, ['create:e1']);
});

test('a change that keeps failing steps aside so later ones still go', async () => {
  h.goOffline(gatewayError);
  h.box.add({ kind: 'create', expense: expense('stuck') });

  // Each flush stops at the head while the failure still looks like the server
  // being down, so nothing behind it is attempted.
  for (let i = 0; i < 4; i++) {
    const r = await h.box.flush();
    assert.equal(r.sent, 0);
    assert.equal(r.stuck, 0, 'still assumed to be the server, not this entry');
  }

  h.box.add({ kind: 'create', expense: expense('later') });
  // Only 'stuck' fails now; a healthy entry behind it must not be held back.
  const result = await h.box.flush();
  assert.equal(result.stuck, 1, 'the repeat offender was set aside');
  assert.equal(h.box.size(), 2, 'set aside, never discarded');
  assert.ok(h.box.expenseIds().has('stuck'), 'its row is still protected');
});

test('a set-aside change is tried again once its rest has passed', async () => {
  h.goOffline(gatewayError);
  h.box.add({ kind: 'create', expense: expense('e1') });
  for (let i = 0; i < 5; i++) await h.box.flush();
  assert.equal((await h.box.flush()).stuck, 1, 'resting, so not attempted');

  h.goOnline();
  assert.deepEqual(h.sent, [], 'still resting');

  h.advance(6 * 60 * 1000);
  assert.equal((await h.box.flush()).sent, 1);
  assert.deepEqual(h.sent, ['create:e1'], 'picked up again of its own accord');
  assert.equal(h.box.size(), 0);
});

test('stepping over a stuck entry does not reorder that expense own changes', async () => {
  // 'e1' has a create resting and an edit behind it. Sending the edit first
  // would hit a row the server has never seen, so the edit has to wait too —
  // but an unrelated expense must still get through.
  h.goOffline(gatewayError);
  h.box.add({ kind: 'create', expense: expense('e1') });
  for (let i = 0; i < 5; i++) await h.box.flush();

  // Queued while the create is resting, so enqueue folds it into that create.
  h.box.add({ kind: 'update', expense: expense('e1', 999) });
  h.box.add({ kind: 'create', expense: expense('e2') });

  h.goOnline();
  const result = await h.box.flush();
  assert.deepEqual(h.sent, ['create:e2'], 'the unrelated expense went first');
  assert.equal(result.stuck, 1);

  h.advance(6 * 60 * 1000);
  await h.box.flush();
  assert.deepEqual(
    h.sent,
    ['create:e2', 'create:e1'],
    'e1 still went as a create, carrying the edited amount'
  );
  assert.equal(h.box.size(), 0);
});
