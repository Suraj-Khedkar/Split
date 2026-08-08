import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';

import { ExpenseReport } from '../../src/components/ExpenseReport';
import { usePersonExpenses } from '../../src/store/selectors';
import { useStore } from '../../src/store/useStore';
import { font, spacing, useColors } from '../../src/theme';

export default function FriendReportScreen() {
  const c = useColors();
  const { friendId } = useLocalSearchParams<{ friendId: string }>();
  const person = useStore((s) => s.people.find((p) => p.id === friendId));
  const meId = useStore((s) => s.meId);
  // Everything the two of you both touch, wherever it happened - the point of a
  // person report is that it crosses groups.
  const shared = usePersonExpenses(friendId ?? '').filter(
    (e) =>
      e.paidBy.some((p) => p.personId === meId) || e.splits.some((s) => s.personId === meId)
  );

  if (!person) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, padding: spacing.xl }}>
        <Stack.Screen options={{ title: 'Report' }} />
        <Text style={[font.body, { color: c.textMuted }]}>That person is gone.</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: `${person.name} report` }} />
      <ExpenseReport expenses={shared} currency="INR" subjectId={person.id} mode="person" />
    </>
  );
}
