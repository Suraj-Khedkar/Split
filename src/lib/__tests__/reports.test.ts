import assert from 'node:assert/strict';
import test from 'node:test';

import { bucketSpend, buildReport } from '../reports';
import type { Expense } from '../../types';

let seq = 0;
function expense(patch: Partial<Expense> = {}): Expense {
  seq += 1;
  const amount = patch.amount ?? 1000;
  return {
    id: `e${seq}`,
    groupId: 'g1',
    description: 'thing',
    amount,
    currency: 'INR',
    category: 'general',
    paidBy: [{ personId: 'a', amount }],
    splits: [{ personId: 'a', amount }],
    splitMethod: 'equal',
    date: '2026-01-15',
    createdAt: '2026-01-15T00:00:00.000Z',
    isSettlement: false,
    ...patch,
  } as Expense;
}

test('empty input produces zeroes, not NaN', () => {
  const r = buildReport([]);
  assert.equal(r.total, 0);
  assert.equal(r.count, 0);
  assert.equal(r.average, 0);
  assert.equal(r.largest, null);
  assert.deepEqual(r.byCategory, []);
  assert.deepEqual(r.byMonth, []);
});

test('settlements are excluded from spend and reported separately', () => {
  const r = buildReport([
    expense({ amount: 3000 }),
    expense({ amount: 5000, isSettlement: true, category: 'settlement' }),
  ]);
  assert.equal(r.total, 3000, 'settlement must not inflate the total');
  assert.equal(r.count, 1);
  assert.equal(r.settledTotal, 5000);
  assert.equal(r.settledCount, 1);
  assert.ok(
    !r.byCategory.some((c) => c.category === 'settlement'),
    'settlement must not appear as a spend category'
  );
});

test('category slices sum to the total and their shares sum to 1', () => {
  const r = buildReport([
    expense({ amount: 2500, category: 'food' }),
    expense({ amount: 1500, category: 'food' }),
    expense({ amount: 6000, category: 'travel' }),
  ]);
  assert.equal(r.total, 10000);
  assert.equal(
    r.byCategory.reduce((s, c) => s + c.amount, 0),
    10000
  );
  const shareSum = r.byCategory.reduce((s, c) => s + c.share, 0);
  assert.ok(Math.abs(shareSum - 1) < 1e-9, `shares summed to ${shareSum}`);
  assert.equal(r.byCategory[0].category, 'travel', 'sorted by amount descending');
});

test('paid and share are tracked separately and net is their difference', () => {
  // a pays 9000, split three ways.
  const r = buildReport([
    expense({
      amount: 9000,
      paidBy: [{ personId: 'a', amount: 9000 }],
      splits: [
        { personId: 'a', amount: 3000 },
        { personId: 'b', amount: 3000 },
        { personId: 'c', amount: 3000 },
      ],
    }),
  ]);
  const byId = Object.fromEntries(r.byMember.map((m) => [m.personId, m]));
  assert.equal(byId.a.paid, 9000);
  assert.equal(byId.a.share, 3000);
  assert.equal(byId.a.net, 6000, 'a is owed what they covered for the others');
  assert.equal(byId.b.paid, 0);
  assert.equal(byId.b.net, -3000);
  const netSum = r.byMember.reduce((s, m) => s + m.net, 0);
  assert.equal(netSum, 0, 'nets must always cancel out');
});

test('multiple payers are attributed to each of them', () => {
  const r = buildReport([
    expense({
      amount: 10000,
      paidBy: [
        { personId: 'a', amount: 6000 },
        { personId: 'b', amount: 4000 },
      ],
      splits: [
        { personId: 'a', amount: 5000 },
        { personId: 'b', amount: 5000 },
      ],
    }),
  ]);
  const byId = Object.fromEntries(r.byMember.map((m) => [m.personId, m]));
  assert.equal(byId.a.paid, 6000);
  assert.equal(byId.b.paid, 4000);
  assert.equal(byId.a.net, 1000);
  assert.equal(byId.b.net, -1000);
});

test('months with no spending are filled with zero, not skipped', () => {
  const r = buildReport([
    expense({ amount: 1000, date: '2026-01-05' }),
    expense({ amount: 2000, date: '2026-04-20' }),
  ]);
  assert.deepEqual(
    r.byMonth.map((m) => m.month),
    ['2026-01', '2026-02', '2026-03', '2026-04'],
    'the quiet months must still appear'
  );
  assert.deepEqual(
    r.byMonth.map((m) => m.amount),
    [1000, 0, 0, 2000]
  );
});

test('a month range spanning a year boundary rolls over correctly', () => {
  const r = buildReport([
    expense({ amount: 1000, date: '2025-11-02' }),
    expense({ amount: 1000, date: '2026-02-02' }),
  ]);
  assert.deepEqual(
    r.byMonth.map((m) => m.month),
    ['2025-11', '2025-12', '2026-01', '2026-02']
  );
});

test('subject picks out one person, and largest/average are right', () => {
  const r = buildReport(
    [
      expense({
        amount: 4000,
        splits: [
          { personId: 'a', amount: 2000 },
          { personId: 'b', amount: 2000 },
        ],
      }),
      expense({
        amount: 8000,
        splits: [
          { personId: 'a', amount: 4000 },
          { personId: 'b', amount: 4000 },
        ],
      }),
    ],
    'b'
  );
  assert.equal(r.subject?.personId, 'b');
  assert.equal(r.subject?.share, 6000);
  assert.equal(r.average, 6000);
  assert.equal(r.largest?.amount, 8000);
});

test('expenses spread across groups are split out by group', () => {
  const r = buildReport([
    expense({ amount: 3000, groupId: 'g1' }),
    expense({ amount: 7000, groupId: 'g2' }),
  ]);
  assert.equal(r.byGroup.length, 2);
  assert.equal(r.byGroup[0].groupId, 'g2', 'sorted by amount descending');
  assert.equal(r.byGroup[0].share, 0.7);
});

test('week bucketing groups by ISO week and stays ordered', () => {
  const rows = [
    expense({ amount: 1000, date: '2026-01-05' }), // Mon, week 02
    expense({ amount: 2000, date: '2026-01-08' }), // Thu, same week
    expense({ amount: 4000, date: '2026-01-12' }), // Mon, week 03
  ];
  const weeks = bucketSpend(rows, 'week');
  assert.equal(weeks.length, 2, 'two distinct ISO weeks');
  assert.equal(weeks[0].amount, 3000, 'the two same-week expenses combine');
  assert.equal(weeks[1].amount, 4000);
  assert.ok(weeks[0].month < weeks[1].month, 'kept in chronological order');
  assert.ok(/^\d{4}-W\d{2}$/.test(weeks[0].month), `unexpected key ${weeks[0].month}`);
});

test('week bucketing crossing a year boundary orders correctly', () => {
  const weeks = bucketSpend(
    [expense({ amount: 1000, date: '2025-12-29' }), expense({ amount: 2000, date: '2026-01-20' })],
    'week'
  );
  assert.equal(weeks.length, 2);
  assert.ok(weeks[0].month < weeks[1].month, `${weeks[0].month} should sort before ${weeks[1].month}`);
});

test('week bucketing excludes settlements, like every other total', () => {
  const weeks = bucketSpend(
    [
      expense({ amount: 1000, date: '2026-02-02' }),
      expense({ amount: 9000, date: '2026-02-03', isSettlement: true }),
    ],
    'week'
  );
  assert.equal(weeks.reduce((s, w) => s + w.amount, 0), 1000);
});

test('a personal breakdown counts only the subject\'s share', () => {
  const r = buildReport(
    [
      expense({
        amount: 9000,
        category: 'food',
        splits: [
          { personId: 'a', amount: 3000 },
          { personId: 'b', amount: 6000 },
        ],
      }),
      expense({
        amount: 4000,
        category: 'travel',
        splits: [
          { personId: 'a', amount: 1000 },
          { personId: 'b', amount: 3000 },
        ],
      }),
    ],
    'a'
  );
  // The group spent 13,000; person a's slice is 4,000.
  assert.equal(r.total, 13000, 'group total is unchanged');
  assert.equal(r.subject?.share, 4000);
  const byCat = Object.fromEntries(r.subjectByCategory.map((s) => [s.category, s.amount]));
  assert.equal(byCat.food, 3000, 'their slice of the food bill, not the whole bill');
  assert.equal(byCat.travel, 1000);
  assert.equal(
    r.subjectByCategory.reduce((sum, s) => sum + s.amount, 0),
    4000,
    'personal categories must add up to the personal total'
  );
  const shareSum = r.subjectByCategory.reduce((sum, s) => sum + s.share, 0);
  assert.ok(Math.abs(shareSum - 1) < 1e-9, 'personal shares are against the personal total');
});

test('personal breakdown splits across groups', () => {
  const r = buildReport(
    [
      expense({ groupId: 'g1', amount: 2000, splits: [{ personId: 'a', amount: 1000 }, { personId: 'b', amount: 1000 }] }),
      expense({ groupId: 'g2', amount: 6000, splits: [{ personId: 'a', amount: 3000 }, { personId: 'b', amount: 3000 }] }),
    ],
    'a'
  );
  const byGroup = Object.fromEntries(r.subjectByGroup.map((g) => [g.groupId, g.amount]));
  assert.equal(byGroup.g1, 1000);
  assert.equal(byGroup.g2, 3000);
  assert.equal(r.subjectByGroup[0].groupId, 'g2', 'largest first');
});

test('expenses the subject is not part of are excluded from their breakdown', () => {
  const r = buildReport(
    [
      expense({ amount: 5000, category: 'food', splits: [{ personId: 'b', amount: 5000 }] }),
      expense({ amount: 2000, category: 'travel', splits: [{ personId: 'a', amount: 2000 }] }),
    ],
    'a'
  );
  assert.equal(r.subjectByCategory.length, 1);
  assert.equal(r.subjectByCategory[0].category, 'travel');
  assert.equal(r.subject?.share, 2000);
});

test('bucketSpend with a subject tracks their share over time', () => {
  const rows = [
    expense({ date: '2026-01-10', amount: 4000, splits: [{ personId: 'a', amount: 1000 }, { personId: 'b', amount: 3000 }] }),
    expense({ date: '2026-02-10', amount: 2000, splits: [{ personId: 'a', amount: 2000 }] }),
  ];
  assert.deepEqual(bucketSpend(rows, 'month').map((m) => m.amount), [4000, 2000], 'group view');
  assert.deepEqual(bucketSpend(rows, 'month', 'a').map((m) => m.amount), [1000, 2000], 'personal view');
});
