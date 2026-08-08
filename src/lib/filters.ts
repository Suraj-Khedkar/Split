import type { Expense, Person } from '../types';

/**
 * One filter shape, used by the group list and the report.
 *
 * Sharing it is the point: tapping a bar in the report sets the same filter the
 * search box writes, so "show me only Food" means exactly one thing and the
 * charts and the list can never disagree about what is on screen.
 */
export interface ExpenseFilter {
  /** Matches description, category, and the names of people involved. */
  query: string;
  /** Empty means every category. */
  categories: string[];
  /** Empty means every group. `null` inside it matches one-off expenses. */
  groupIds: (string | null)[];
  /** Only expenses this person paid for or owes a share of. */
  personId: string | null;
  /** Inclusive YYYY-MM-DD bounds; '' means unbounded. */
  from: string;
  to: string;
  /** Settlements are transfers, not spending, so they are off by default. */
  includeSettlements: boolean;
}

export const emptyFilter: ExpenseFilter = {
  query: '',
  categories: [],
  groupIds: [],
  personId: null,
  from: '',
  to: '',
  includeSettlements: false,
};

export function isFilterActive(f: ExpenseFilter): boolean {
  return Boolean(
    f.query.trim() ||
      f.categories.length ||
      f.groupIds.length ||
      f.personId ||
      f.from ||
      f.to ||
      f.includeSettlements
  );
}

/** How many distinct conditions are on, for a badge on the filter button. */
export function activeFilterCount(f: ExpenseFilter): number {
  return (
    (f.query.trim() ? 1 : 0) +
    (f.categories.length ? 1 : 0) +
    (f.groupIds.length ? 1 : 0) +
    (f.personId ? 1 : 0) +
    (f.from || f.to ? 1 : 0) +
    (f.includeSettlements ? 1 : 0)
  );
}

const dateOf = (e: Expense) => e.date || e.createdAt.slice(0, 10);

/**
 * Apply a filter.
 *
 * Text matching is case-insensitive and spans description, category and the
 * names of everyone involved, because "who was that dinner with" is as common a
 * question as "what was it called".
 */
export function filterExpenses(
  expenses: Expense[],
  filter: ExpenseFilter,
  people: Person[] = []
): Expense[] {
  const q = filter.query.trim().toLowerCase();
  const nameById = new Map(people.map((p) => [p.id, p.name.toLowerCase()]));
  const wanted = new Set(filter.categories);
  const wantedGroups = new Set(filter.groupIds);

  return expenses.filter((e) => {
    if (!filter.includeSettlements && e.isSettlement) return false;
    if (wanted.size && !wanted.has(e.category)) return false;
    if (wantedGroups.size && !wantedGroups.has(e.groupId)) return false;

    if (filter.personId) {
      const involved =
        e.paidBy.some((p) => p.personId === filter.personId) ||
        e.splits.some((s) => s.personId === filter.personId);
      if (!involved) return false;
    }

    const date = dateOf(e);
    if (filter.from && date < filter.from) return false;
    if (filter.to && date > filter.to) return false;

    if (q) {
      const names = [...e.paidBy, ...e.splits]
        .map((s) => nameById.get(s.personId) ?? '')
        .join(' ');
      const hay = `${e.description} ${e.category} ${names}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
