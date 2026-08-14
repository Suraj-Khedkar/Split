import { Stack } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';

import { ExpenseReport } from '../../src/components/ExpenseReport';
import { usePersonalExpenses, usePersonalGroup } from '../../src/store/selectors';
import { useStore } from '../../src/store/useStore';
import { font, spacing, useColors } from '../../src/theme';

/**
 * Where your own money went — the personal ledger only.
 *
 * Distinct from /report/me, which covers everything you have a share of
 * including your slice of group bills. This one answers the narrower question
 * the Personal tab poses: of the money nobody is splitting with you, what did
 * you spend it on.
 */
export default function PersonalReportScreen() {
  const c = useColors();
  const meId = useStore((s) => s.meId);
  const group = usePersonalGroup();
  const expenses = usePersonalExpenses();

  return (
    <>
      <Stack.Screen options={{ title: 'Personal spending' }} />
      {expenses.length === 0 ? (
        <View style={{ flex: 1, backgroundColor: c.bg, padding: spacing.xl }}>
          <Text style={[font.body, { color: c.textMuted }]}>
            Nothing yet. Add a personal expense and this fills in with where the
            money went.
          </Text>
        </View>
      ) : (
        <ExpenseReport
          expenses={expenses}
          currency={group?.currency ?? 'INR'}
          subjectId={meId}
          mode="personal"
        />
      )}
    </>
  );
}
