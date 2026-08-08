import assert from 'node:assert/strict';
import test from 'node:test';

import { activeFilterCount, emptyFilter, filterExpenses, isFilterActive } from '../filters';
import type { Expense, Person } from '../../types';

const people: Person[] = [
  { id: 'me', name: 'You', colorIndex: 0 },
  { id: 'p1', name: 'Priya', colorIndex: 1 },
  { id: 'p2', name: 'Rahul', colorIndex: 2 },
];

let seq = 0;
function expense(patch: Partial<Expense> = {}): Expense {
  seq += 1;
  const amount = patch.amount ?? 1000;
  return {
    id: `e${seq}`,
    groupId: 'g1',
    description: 'Dinner',
    amount,
    currency: 'INR',
    category: 'food',
    paidBy: [{ personId: 'me', amount }],
    splits: [{ personId: 'me', amount }],
    splitMethod: 'equal',
    date: '2026-03-10',
    createdAt: '2026-03-10T00:00:00.000Z',
    isSettlement: false,
    ...patch,
  } as Expense;
}

test('settlements are hidden unless explicitly included', () => {
  const rows = [expense(), expense({ isSettlement: true, category: 'settlement' })];
  assert.equal(filterExpenses(rows, emptyFilter, people).length, 1);
  assert.equal(
    filterExpenses(rows, { ...emptyFilter, includeSettlements: true }, people).length,
    2
  );
});

test('query matches description, category and people involved', () => {
  const rows = [
    expense({ description: 'Beach shack', category: 'food' }),
    expense({ description: 'Petrol', category: 'transport' }),
    expense({
      description: 'Cinema',
      category: 'entertainment',
      splits: [{ personId: 'p1', amount: 1000 }],
    }),
  ];
  const q = (query: string) => filterExpenses(rows, { ...emptyFilter, query }, people).map((e) => e.description);
  assert.deepEqual(q('beach'), ['Beach shack'], 'description, case-insensitive');
  assert.deepEqual(q('transport'), ['Petrol'], 'category');
  assert.deepEqual(q('priya'), ['Cinema'], 'a person by name');
  assert.deepEqual(q('nothing here'), []);
});

test('category filter accepts several at once', () => {
  const rows = [
    expense({ category: 'food' }),
    expense({ category: 'transport' }),
    expense({ category: 'home' }),
  ];
  const got = filterExpenses(rows, { ...emptyFilter, categories: ['food', 'home'] }, people);
  assert.deepEqual(got.map((e) => e.category).sort(), ['food', 'home']);
});

test('a category the user invented filters like any other', () => {
  const rows = [expense({ category: 'gym membership' }), expense({ category: 'food' })];
  const got = filterExpenses(rows, { ...emptyFilter, categories: ['gym membership'] }, people);
  assert.equal(got.length, 1);
  assert.equal(got[0].category, 'gym membership');
});

test('person filter matches payers and people who owe a share', () => {
  const rows = [
    expense({ id: 'paid', paidBy: [{ personId: 'p1', amount: 1000 }] }),
    expense({ id: 'owes', splits: [{ personId: 'p1', amount: 1000 }] }),
    expense({ id: 'neither', paidBy: [{ personId: 'p2', amount: 1000 }], splits: [{ personId: 'p2', amount: 1000 }] }),
  ];
  const got = filterExpenses(rows, { ...emptyFilter, personId: 'p1' }, people).map((e) => e.id);
  assert.deepEqual(got.sort(), ['owes', 'paid']);
});

test('date bounds are inclusive on both ends', () => {
  const rows = [
    expense({ date: '2026-01-01' }),
    expense({ date: '2026-02-15' }),
    expense({ date: '2026-03-31' }),
  ];
  const got = filterExpenses(rows, { ...emptyFilter, from: '2026-01-01', to: '2026-03-31' }, people);
  assert.equal(got.length, 3, 'both endpoints are included');
  assert.equal(
    filterExpenses(rows, { ...emptyFilter, from: '2026-02-01', to: '2026-02-28' }, people).length,
    1
  );
});

test('conditions combine rather than replace each other', () => {
  const rows = [
    expense({ description: 'Taxi home', category: 'transport', date: '2026-01-10' }),
    expense({ description: 'Taxi home', category: 'transport', date: '2026-06-10' }),
    expense({ description: 'Taxi home', category: 'food', date: '2026-01-10' }),
  ];
  const got = filterExpenses(
    rows,
    { ...emptyFilter, query: 'taxi', categories: ['transport'], from: '2026-01-01', to: '2026-01-31' },
    people
  );
  assert.equal(got.length, 1);
});

test('an empty filter is inert and reports itself inactive', () => {
  const rows = [expense(), expense()];
  assert.equal(filterExpenses(rows, emptyFilter, people).length, 2);
  assert.equal(isFilterActive(emptyFilter), false);
  assert.equal(activeFilterCount(emptyFilter), 0);
  assert.equal(isFilterActive({ ...emptyFilter, query: '  ' }), false, 'whitespace is not a filter');
  assert.equal(activeFilterCount({ ...emptyFilter, query: 'a', categories: ['food'], personId: 'p1' }), 3);
});

test('group filter narrows to the chosen groups', () => {
  const rows = [
    expense({ groupId: 'g1', description: 'One' }),
    expense({ groupId: 'g2', description: 'Two' }),
    expense({ groupId: 'g3', description: 'Three' }),
  ];
  const got = filterExpenses(rows, { ...emptyFilter, groupIds: ['g1', 'g3'] }, people);
  assert.deepEqual(got.map((e) => e.description).sort(), ['One', 'Three']);
});

test('a null group id matches expenses outside any group', () => {
  const rows = [
    expense({ groupId: null, description: 'One-off' }),
    expense({ groupId: 'g1', description: 'In a group' }),
  ];
  const got = filterExpenses(rows, { ...emptyFilter, groupIds: [null] }, people);
  assert.deepEqual(got.map((e) => e.description), ['One-off']);
});

test('group filter combines with the others rather than replacing them', () => {
  const rows = [
    expense({ groupId: 'g1', category: 'food' }),
    expense({ groupId: 'g1', category: 'transport' }),
    expense({ groupId: 'g2', category: 'food' }),
  ];
  const got = filterExpenses(
    rows,
    { ...emptyFilter, groupIds: ['g1'], categories: ['food'] },
    people
  );
  assert.equal(got.length, 1);
  assert.equal(got[0].groupId, 'g1');
  assert.equal(got[0].category, 'food');
});

test('group selection counts toward the active filter badge', () => {
  assert.equal(activeFilterCount({ ...emptyFilter, groupIds: ['g1'] }), 1);
  assert.equal(isFilterActive({ ...emptyFilter, groupIds: ['g1'] }), true);
});
