import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeBalances } from '../balances';
import { mapCategory, parseSplitwiseCsv, rebuildShares } from '../splitwiseImport';
import type { Expense } from '../../types';

const CSV = `Date,Description,Category,Cost,Currency,Alice,Bob,Carol
2026-01-15,Dinner at Toit,Dining out,900.00,INR,600.00,-300.00,-300.00
2026-01-16,"Cab, airport",Transportation,450.00,INR,-150.00,300.00,-150.00
2026-01-17,Hotel,Hotel,3000.00,INR,-1000.00,-1000.00,2000.00
2026-01-18,Bob paid Alice,Payment,200.00,INR,-200.00,200.00,0.00
,Total balance,,0.00,INR,-750.00,-800.00,1550.00
`;

test('parses the Splitwise export and drops the summary row', () => {
  const p = parseSplitwiseCsv(CSV);
  assert.deepEqual(p.people, ['Alice', 'Bob', 'Carol']);
  assert.equal(p.rows.length, 4, 'Total balance row excluded');
  assert.equal(p.currency, 'INR');
  assert.equal(p.rows[0].description, 'Dinner at Toit');
  assert.equal(p.rows[0].amount, 90000);
  // Quoted field containing a comma must survive intact.
  assert.equal(p.rows[1].description, 'Cab, airport');
  assert.equal(p.rows[3].isSettlement, true, 'Payment rows are settlements');
});

test('rebuildShares reproduces every net exactly', () => {
  const p = parseSplitwiseCsv(CSV);
  for (const row of p.rows) {
    const { paidBy, splits } = rebuildShares(row.amount, row.nets, (n) => n);

    const sum = (xs: { amount: number }[]) => xs.reduce((a, b) => a + b.amount, 0);
    assert.equal(sum(paidBy), row.amount, `paid sums to cost: ${row.description}`);
    assert.equal(sum(splits), row.amount, `splits sum to cost: ${row.description}`);
    assert.ok(paidBy.every((x) => x.amount >= 0), 'no negative payments');
    assert.ok(splits.every((x) => x.amount >= 0), 'no negative shares');

    for (const person of Object.keys(row.nets)) {
      const paid = paidBy.find((x) => x.personId === person)?.amount ?? 0;
      const owed = splits.find((x) => x.personId === person)?.amount ?? 0;
      assert.equal(paid - owed, row.nets[person], `net preserved for ${person}`);
    }
  }
});

test('imported balances match the Splitwise totals row', () => {
  const p = parseSplitwiseCsv(CSV);
  const expenses: Expense[] = p.rows.map((row, i) => {
    const { paidBy, splits } = rebuildShares(row.amount, row.nets, (n) => n);
    return {
      id: `e${i}`,
      groupId: 'g',
      description: row.description,
      amount: row.amount,
      currency: row.currency,
      category: mapCategory(row.category),
      paidBy,
      splits,
      splitMethod: 'exact',
      date: row.date,
      createdAt: row.date,
      isSettlement: row.isSettlement,
    };
  });

  const balances = computeBalances(expenses);
  const net = (name: string) => balances.find((b) => b.personId === name)?.amount ?? 0;

  // These are exactly the numbers on Splitwise's own "Total balance" row.
  assert.equal(net('Alice'), -75000);
  assert.equal(net('Bob'), -80000);
  assert.equal(net('Carol'), 155000);
  assert.equal(balances.reduce((s, b) => s + b.amount, 0), 0);
});

test('tolerates rounding drift but rejects genuinely broken rows', () => {
  const drift = `Date,Description,Category,Cost,Currency,A,B,C
2026-01-01,Split three ways,General,10.00,INR,6.67,-3.33,-3.33
2026-01-02,Broken row,General,50.00,INR,40.00,-5.00,-5.00
`;
  const p = parseSplitwiseCsv(drift);
  assert.equal(p.rows.length, 1, 'one-paisa drift kept, 30.00 mismatch dropped');
  assert.equal(
    Object.values(p.rows[0].nets).reduce((a, b) => a + b, 0),
    0,
    'drift corrected to balance'
  );
  assert.match(p.warnings.join(' '), /Broken row/);
});

test('rejects files that are not Splitwise exports', () => {
  assert.throws(() => parseSplitwiseCsv('hello\nworld'), /not look like a Splitwise export/);
  assert.throws(() => parseSplitwiseCsv(''), /no rows/);
});

test('maps Splitwise categories onto ours', () => {
  assert.equal(mapCategory('Dining out'), 'food');
  assert.equal(mapCategory('Groceries'), 'groceries');
  assert.equal(mapCategory('Taxi'), 'transport');
  assert.equal(mapCategory('Electricity'), 'utilities');
  assert.equal(mapCategory('Payment'), 'settlement');
  assert.equal(mapCategory('Something odd'), 'general');
});

test('holds on randomised ledgers', () => {
  for (let seed = 0; seed < 300; seed += 1) {
    const n = 2 + (seed % 5);
    const names = Array.from({ length: n }, (_, i) => `p${i}`);
    const amount = 100 + ((seed * 977) % 90000);

    // Random valid net vector: shares sum to amount, one random payer.
    const shares = names.map(() => 0);
    let left = amount;
    for (let i = 0; i < n - 1; i += 1) {
      const take = Math.floor((left * ((seed + i) % 7 + 1)) / 20);
      shares[i] = take;
      left -= take;
    }
    shares[n - 1] = left;
    const payer = seed % n;
    const nets: Record<string, number> = {};
    names.forEach((name, i) => {
      nets[name] = (i === payer ? amount : 0) - shares[i];
    });

    const { paidBy, splits } = rebuildShares(amount, nets, (x) => x);
    const sum = (xs: { amount: number }[]) => xs.reduce((a, b) => a + b.amount, 0);
    assert.equal(sum(paidBy), amount, `seed ${seed} paid`);
    assert.equal(sum(splits), amount, `seed ${seed} splits`);
    assert.ok(paidBy.every((x) => x.amount >= 0) && splits.every((x) => x.amount >= 0));
    for (const name of names) {
      const paid = paidBy.find((x) => x.personId === name)?.amount ?? 0;
      const owed = splits.find((x) => x.personId === name)?.amount ?? 0;
      assert.equal(paid - owed, nets[name], `seed ${seed} net for ${name}`);
    }
  }
});
