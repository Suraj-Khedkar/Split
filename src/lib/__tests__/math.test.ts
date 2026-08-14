import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatAmount, parseAmount, splitByWeights, splitEvenly } from '../money';
import { buildSplits, validatePayers, validateSplits } from '../split';
import { computeBalances, simplifyDebts, balanceBetween } from '../balances';
import type { Expense } from '../../types';

const expense = (over: Partial<Expense>): Expense => ({
  id: Math.random().toString(36).slice(2),
  groupId: 'g1',
  description: 'test',
  amount: 0,
  currency: 'INR',
  category: 'general',
  paidBy: [],
  splits: [],
  splitMethod: 'equal',
  date: '2026-01-01',
  createdAt: '2026-01-01',
  isSettlement: false,
  ...over,
});

test('parse/format round-trips and rejects junk', () => {
  assert.equal(parseAmount('12.34'), 1234);
  assert.equal(parseAmount('1,234.5'), 123450);
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('abc'), 0);
  assert.equal(formatAmount(1234), '12.34');
  assert.equal(formatAmount(5), '0.05');
  assert.equal(formatAmount(-1234), '-12.34');
});

test('splitEvenly never loses or invents money', () => {
  // The classic: 10.00 three ways.
  assert.deepEqual(splitEvenly(1000, 3), [334, 333, 333]);
  assert.equal(splitEvenly(1000, 3).reduce((a, b) => a + b, 0), 1000);

  for (const total of [1, 7, 99, 100, 1000, 12345, 99999]) {
    for (const n of [1, 2, 3, 4, 5, 7, 11]) {
      const parts = splitEvenly(total, n);
      assert.equal(parts.length, n);
      assert.equal(parts.reduce((a, b) => a + b, 0), total, `${total}/${n}`);
      // Shares differ by at most one minor unit.
      assert.ok(Math.max(...parts) - Math.min(...parts) <= 1);
    }
  }
});

test('weighted splits sum exactly (largest remainder)', () => {
  assert.equal(splitByWeights(1000, [1, 1, 1]).reduce((a, b) => a + b, 0), 1000);
  assert.equal(splitByWeights(10000, [33.3, 33.3, 33.4]).reduce((a, b) => a + b, 0), 10000);
  assert.deepEqual(splitByWeights(1000, [50, 50]), [500, 500]);
  assert.deepEqual(splitByWeights(300, [2, 1]), [200, 100]);
});

test('buildSplits covers all four methods and always totals the bill', () => {
  const people = ['a', 'b', 'c'];

  const equal = buildSplits('equal', 1000, people);
  assert.equal(equal.reduce((s, x) => s + x.amount, 0), 1000);

  const exact = buildSplits('exact', 1000, people, { a: 500, b: 300, c: 200 });
  assert.equal(exact.reduce((s, x) => s + x.amount, 0), 1000);

  const percent = buildSplits('percent', 1000, people, { a: 50, b: 25, c: 25 });
  assert.deepEqual(percent.map((s) => s.amount), [500, 250, 250]);

  // b has a double share.
  const shares = buildSplits('shares', 1000, people, { a: 1, b: 2, c: 1 });
  assert.deepEqual(shares.map((s) => s.amount), [250, 500, 250]);
  assert.equal(shares.reduce((s, x) => s + x.amount, 0), 1000);
});

test('validateSplits reports the gap on exact splits', () => {
  assert.equal(validateSplits(1000, [{ personId: 'a', amount: 1000 }]).valid, true);
  const short = validateSplits(1000, [{ personId: 'a', amount: 900 }]);
  assert.equal(short.valid, false);
  assert.equal(short.difference, 100);
  assert.match(short.message, /short by 1\.00/);
});

test('balances net to zero and track who paid', () => {
  // Alice pays 30, split equally three ways.
  const balances = computeBalances([
    expense({
      amount: 3000,
      paidBy: [{ personId: 'alice', amount: 3000 }],
      splits: [
        { personId: 'alice', amount: 1000 },
        { personId: 'bob', amount: 1000 },
        { personId: 'carol', amount: 1000 },
      ],
    }),
  ]);
  assert.equal(balances.reduce((s, b) => s + b.amount, 0), 0);
  assert.equal(balances.find((b) => b.personId === 'alice')?.amount, 2000);
  assert.equal(balances.find((b) => b.personId === 'bob')?.amount, -1000);
});

test('a settlement cancels the debt it repays', () => {
  const bill = expense({
    amount: 2000,
    paidBy: [{ personId: 'alice', amount: 2000 }],
    splits: [
      { personId: 'alice', amount: 1000 },
      { personId: 'bob', amount: 1000 },
    ],
  });
  const payback = expense({
    amount: 1000,
    isSettlement: true,
    paidBy: [{ personId: 'bob', amount: 1000 }],
    splits: [{ personId: 'alice', amount: 1000 }],
  });
  assert.equal(computeBalances([bill, payback]).length, 0, 'all square');
});

test('simplifyDebts clears everyone in at most n-1 transfers', () => {
  // a is owed 30; b and c owe 15 each.
  const debts = simplifyDebts([
    { personId: 'a', amount: 3000 },
    { personId: 'b', amount: -1500 },
    { personId: 'c', amount: -1500 },
  ]);
  assert.equal(debts.length, 2);
  assert.equal(debts.reduce((s, d) => s + d.amount, 0), 3000);
  assert.ok(debts.every((d) => d.toId === 'a'));

  // Circular debt should collapse, not ping-pong.
  const circular = simplifyDebts([
    { personId: 'x', amount: 1000 },
    { personId: 'y', amount: -1000 },
  ]);
  assert.deepEqual(circular, [{ fromId: 'y', toId: 'x', amount: 1000 }]);
});

test('simplify holds on random ledgers', () => {
  for (let seed = 0; seed < 200; seed += 1) {
    const people = ['a', 'b', 'c', 'd', 'e'].slice(0, 2 + (seed % 4));
    const expenses: Expense[] = [];
    for (let i = 0; i < 5; i += 1) {
      const total = 100 + ((seed * 37 + i * 91) % 9900);
      const payer = people[(seed + i) % people.length];
      const shares = splitEvenly(total, people.length);
      expenses.push(
        expense({
          amount: total,
          paidBy: [{ personId: payer, amount: total }],
          splits: people.map((p, idx) => ({ personId: p, amount: shares[idx] })),
        })
      );
    }
    const balances = computeBalances(expenses);
    assert.equal(balances.reduce((s, b) => s + b.amount, 0), 0, 'nets to zero');

    const debts = simplifyDebts(balances);
    assert.ok(debts.length <= people.length - 1, 'at most n-1 transfers');

    // Applying the transfers must leave everyone flat.
    const after = new Map(balances.map((b) => [b.personId, b.amount]));
    for (const d of debts) {
      after.set(d.fromId, (after.get(d.fromId) ?? 0) + d.amount);
      after.set(d.toId, (after.get(d.toId) ?? 0) - d.amount);
    }
    for (const [, value] of after) assert.equal(value, 0, 'settled flat');
  }
});

test('balanceBetween isolates a single pair', () => {
  const shared = expense({
    amount: 3000,
    paidBy: [{ personId: 'alice', amount: 3000 }],
    splits: [
      { personId: 'alice', amount: 1000 },
      { personId: 'bob', amount: 1000 },
      { personId: 'carol', amount: 1000 },
    ],
  });
  assert.equal(balanceBetween([shared], 'alice', 'bob'), 1000);
  assert.equal(balanceBetween([shared], 'bob', 'alice'), -1000);
  assert.equal(balanceBetween([shared], 'bob', 'carol'), 0);
});

test('multiple payers: balances still net to zero', () => {
  // Dinner 60. Alice puts in 40, Bob 20. Split equally three ways.
  const e = expense({
    amount: 6000,
    paidBy: [
      { personId: 'alice', amount: 4000 },
      { personId: 'bob', amount: 2000 },
    ],
    splits: [
      { personId: 'alice', amount: 2000 },
      { personId: 'bob', amount: 2000 },
      { personId: 'carol', amount: 2000 },
    ],
  });
  const balances = computeBalances([e]);
  assert.equal(balances.reduce((s, b) => s + b.amount, 0), 0);
  assert.equal(balances.find((b) => b.personId === 'alice')?.amount, 2000);
  // computeBalances omits settled people, so Bob should be absent entirely.
  assert.equal(balances.find((b) => b.personId === 'bob'), undefined, 'bob paid exactly his share');
  assert.equal(balances.find((b) => b.personId === 'carol')?.amount, -2000);

  // Only carol needs to pay, and only alice is owed.
  const debts = simplifyDebts(balances);
  assert.deepEqual(debts, [{ fromId: 'carol', toId: 'alice', amount: 2000 }]);
});

test('validatePayers catches sums that do not match the bill', () => {
  const ok = validatePayers(6000, [
    { personId: 'a', amount: 4000 },
    { personId: 'b', amount: 2000 },
  ]);
  assert.equal(ok.valid, true);

  const short = validatePayers(6000, [{ personId: 'a', amount: 4000 }]);
  assert.equal(short.valid, false);
  assert.match(short.message, /short by 20\.00/);

  const over = validatePayers(6000, [
    { personId: 'a', amount: 5000 },
    { personId: 'b', amount: 2000 },
  ]);
  assert.equal(over.valid, false);
  assert.match(over.message, /over by 10\.00/);

  assert.equal(validatePayers(6000, []).valid, false, 'nobody paying is invalid');
});

test('adjust: equal split with a surcharge on one person', () => {
  // 600 with 50 on b: the 50 comes off the top, the remaining 550 splits
  // 183.34 / 183.33 / 183.33 — splitEvenly gives the leftover paisa to the
  // first person — and b's 50 lands on top of their share.
  const splits = buildSplits('adjust', 60000, ['a', 'b', 'c'], { b: 5000 });
  assert.deepEqual(splits, [
    { personId: 'a', amount: 18334 },
    { personId: 'b', amount: 23333 },
    { personId: 'c', amount: 18333 },
  ]);
  // What the feature promises: b carries exactly 50 more than an equal peer.
  assert.equal(splits[1].amount - splits[2].amount, 5000);
  assert.equal(splits.reduce((n, s) => n + s.amount, 0), 60000);
});

test('adjust: no surcharge behaves exactly like an equal split', () => {
  assert.deepEqual(
    buildSplits('adjust', 10000, ['a', 'b', 'c']),
    buildSplits('equal', 10000, ['a', 'b', 'c'])
  );
});

test('adjust: surcharges always sum back to the total', () => {
  for (const total of [10000, 60000, 99999, 1]) {
    for (const extra of [0, 1, 500, 5000]) {
      const splits = buildSplits('adjust', total, ['a', 'b', 'c', 'd'], { a: extra, c: extra });
      assert.equal(
        splits.reduce((n, s) => n + s.amount, 0),
        total,
        `total ${total} extra ${extra}`
      );
    }
  }
});

test('reduce: equal split with a discount for one person', () => {
  // 600 with 50 off b: the 50 goes back on top, 650 splits 216.67/216.67/216.66,
  // then b's 50 comes off their share. The other two absorb it.
  const splits = buildSplits('reduce', 60000, ['a', 'b', 'c'], { b: 5000 });
  assert.deepEqual(splits, [
    { personId: 'a', amount: 21667 },
    { personId: 'b', amount: 16667 },
    { personId: 'c', amount: 21666 },
  ]);
  // What the feature promises: b pays 50 less than an equal peer.
  assert.equal(splits[0].amount - splits[1].amount, 5000);
  assert.equal(splits.reduce((n, s) => n + s.amount, 0), 60000);
});

test('reduce: no discount behaves exactly like an equal split', () => {
  assert.deepEqual(
    buildSplits('reduce', 10000, ['a', 'b', 'c']),
    buildSplits('equal', 10000, ['a', 'b', 'c'])
  );
});

test('reduce and adjust are mirror images', () => {
  // Taking 50 off one person is the same shape as adding 50 to the other two.
  const reduced = buildSplits('reduce', 60000, ['a', 'b', 'c'], { b: 5000 });
  for (const total of [10000, 60000, 99999]) {
    for (const cut of [0, 1, 2500]) {
      const splits = buildSplits('reduce', total, ['a', 'b', 'c', 'd'], { b: cut, d: cut });
      assert.equal(
        splits.reduce((n, s) => n + s.amount, 0),
        total,
        `total ${total} cut ${cut}`
      );
    }
  }
  assert.equal(reduced.reduce((n, s) => n + s.amount, 0), 60000);
});
