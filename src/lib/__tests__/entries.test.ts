import assert from 'node:assert/strict';
import test from 'node:test';

import { describeEntry, spendTotal } from '../entries';
import type { Expense, Person } from '../../types';

const ME = 'p_me';
const PRIYA = 'p_priya';
const ANIL = 'p_anil';

const people: Person[] = [
  { id: ME, name: 'Suraj', colorIndex: 0 },
  { id: PRIYA, name: 'Priya', colorIndex: 1 },
  { id: ANIL, name: 'Anil', colorIndex: 2 },
];

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    groupId: 'g1',
    description: 'Dinner',
    amount: 90000,
    currency: 'INR',
    category: 'food',
    paidBy: [{ personId: ME, amount: 90000 }],
    splits: [
      { personId: ME, amount: 30000 },
      { personId: PRIYA, amount: 30000 },
      { personId: ANIL, amount: 30000 },
    ],
    splitMethod: 'equal',
    date: '2026-08-01',
    createdAt: '2026-08-01T12:00:00.000Z',
    isSettlement: false,
    ...over,
  };
}

/** A settlement as `settleUp` builds it: payer covers the payee in full. */
function payback(fromId: string, toId: string, amount = 30000): Expense {
  return expense({
    id: 's1',
    description: 'Settle up',
    category: 'settlement',
    amount,
    paidBy: [{ personId: fromId, amount }],
    splits: [{ personId: toId, amount }],
    splitMethod: 'exact',
    isSettlement: true,
  });
}

test('a spend keeps its description and lent/borrowed framing', () => {
  const entry = describeEntry(expense(), people, ME);
  assert.equal(entry.isPayback, false);
  assert.equal(entry.title, 'Dinner');
  assert.equal(entry.delta, 60000);
  assert.equal(entry.deltaLabel, 'you lent');
  assert.equal(entry.countsAsSpend, true);
});

test('borrowing reads from the other side', () => {
  const entry = describeEntry(
    expense({ paidBy: [{ personId: PRIYA, amount: 90000 }] }),
    people,
    ME
  );
  assert.equal(entry.delta, -30000);
  assert.equal(entry.deltaLabel, 'you borrowed');
});

test('a payback you made reads as paying, never as lending', () => {
  const entry = describeEntry(payback(ME, PRIYA), people, ME);
  assert.equal(entry.isPayback, true);
  assert.equal(entry.title, 'You paid Priya');
  assert.equal(entry.countsAsSpend, false);
  // The delta is positive exactly as it would be for a spend you covered,
  // which is precisely why the label cannot be derived from its sign alone.
  assert.equal(entry.delta, 30000);
  assert.equal(entry.deltaLabel, 'you paid');
});

test('a payback you received reads as being paid', () => {
  const entry = describeEntry(payback(PRIYA, ME), people, ME);
  assert.equal(entry.title, 'Priya paid you');
  assert.equal(entry.delta, -30000);
  assert.equal(entry.deltaLabel, 'you were paid');
});

test('a payback between two other people names both', () => {
  const entry = describeEntry(payback(ANIL, PRIYA), people, ME);
  assert.equal(entry.title, 'Anil paid Priya');
  assert.equal(entry.delta, 0);
  assert.equal(entry.deltaLabel, '');
});

test('spendTotal ignores paybacks', () => {
  const rows = [expense(), payback(ME, PRIYA), payback(PRIYA, ME)];
  assert.equal(spendTotal(rows), 90000);
  // The naive sum is what used to reach the screen.
  assert.equal(
    rows.reduce((sum, e) => sum + e.amount, 0),
    150000
  );
});
