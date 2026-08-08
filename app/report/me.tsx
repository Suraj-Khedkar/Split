import { Stack } from 'expo-router';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';

import { ExpenseReport } from '../../src/components/ExpenseReport';
import { useStore } from '../../src/store/useStore';
import { font, spacing, useColors } from '../../src/theme';

/**
 * Your own spending, across every group you are in.
 *
 * Scoped to expenses you actually have a share of — not everything in your
 * groups. An expense between two flatmates that you were left out of is not
 * money you spent, and counting it would inflate every figure here.
 */
export default function MyReportScreen() {
  const c = useColors();
  const meId = useStore((s) => s.meId);
  const expenses = useStore((s) => s.expenses);
  const groups = useStore((s) => s.groups);

  const mine = useMemo(
    () =>
      expenses
        .filter(
          (e) =>
            e.splits.some((s) => s.personId === meId) ||
            e.paidBy.some((p) => p.personId === meId)
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [expenses, meId]
  );

  // Groups can in principle differ in currency; the report renders one, so use
  // the one most of the expenses are in rather than assuming.
  const currency = useMemo(() => {
    const tally = new Map<string, number>();
    for (const e of mine) tally.set(e.currency, (tally.get(e.currency) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? groups[0]?.currency ?? 'INR';
  }, [mine, groups]);

  return (
    <>
      <Stack.Screen options={{ title: 'Your spending' }} />
      {mine.length === 0 ? (
        <View style={{ flex: 1, backgroundColor: c.bg, padding: spacing.xl }}>
          <Text style={[font.body, { color: c.textMuted }]}>
            Nothing yet. Once you are part of an expense it shows up here.
          </Text>
        </View>
      ) : (
        <ExpenseReport
          expenses={mine}
          currency={currency}
          subjectId={meId}
          mode="personal"
        />
      )}
    </>
  );
}
