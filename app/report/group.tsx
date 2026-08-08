import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';

import { ExpenseReport } from '../../src/components/ExpenseReport';
import { useGroupExpenses } from '../../src/store/selectors';
import { useStore } from '../../src/store/useStore';
import { font, spacing, useColors } from '../../src/theme';

export default function GroupReportScreen() {
  const c = useColors();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const group = useStore((s) => s.groups.find((g) => g.id === groupId));
  const meId = useStore((s) => s.meId);
  const expenses = useGroupExpenses(groupId ?? '');

  if (!group) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, padding: spacing.xl }}>
        <Stack.Screen options={{ title: 'Report' }} />
        <Text style={[font.body, { color: c.textMuted }]}>That group is gone.</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: `${group.name} report` }} />
      <ExpenseReport
        expenses={expenses}
        currency={group.currency}
        subjectId={meId}
        mode="group"
        memberIds={group.memberIds}
      />
    </>
  );
}
