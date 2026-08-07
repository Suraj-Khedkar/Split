import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, Button, Divider, EmptyState, Row } from '../../src/components/ui';
import { balanceBetween } from '../../src/lib/balances';
import { formatMoney } from '../../src/lib/money';
import { usePersonExpenses } from '../../src/store/selectors';
import { personName, useStore } from '../../src/store/useStore';
import { Palette, balanceColor, font, spacing, useColors } from '../../src/theme';

export default function FriendScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const people = useStore((s) => s.people);
  const groups = useStore((s) => s.groups);
  const expenses = useStore((s) => s.expenses);
  const meId = useStore((s) => s.meId);

  const person = people.find((p) => p.id === id);
  const shared = usePersonExpenses(id ?? '').filter((e) =>
    e.paidBy.some((p) => p.personId === meId) || e.splits.some((s) => s.personId === meId)
  );
  const net = balanceBetween(expenses, meId, id ?? '');

  if (!person) return <EmptyState icon="alert-circle-outline" title="Friend not found" />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: person.name }} />
      <View style={styles.header}>
        <Avatar name={person.name} colorIndex={person.colorIndex} size={64} />
        <Text style={[font.h2, { marginTop: spacing.md }, { color: c.text }]}>{person.name}</Text>
        <Text style={[font.body, { color: c.textMuted, marginTop: 2 }]}>
          {net === 0 ? (
            'You are all settled up'
          ) : (
            <>
              {net > 0 ? `${person.name} owes you ` : `You owe ${person.name} `}
              <Text style={{ color: balanceColor(net, c), fontWeight: '700' }}>
                {formatMoney(Math.abs(net))}
              </Text>
            </>
          )}
        </Text>
        {net !== 0 ? (
          <Button
            title="Settle up"
            variant="secondary"
            style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
            onPress={() => router.push(`/settle/none?friendId=${person.id}`)}
          />
        ) : null}
      </View>

      {shared.length === 0 ? (
        <EmptyState icon="receipt-outline" title="Nothing shared yet" />
      ) : (
        shared.map((expense, index) => {
          const group = groups.find((g) => g.id === expense.groupId);
          const myShare = expense.splits.find((s) => s.personId === meId)?.amount ?? 0;
          const myPaid = expense.paidBy.find((p) => p.personId === meId)?.amount ?? 0;
          const delta = myPaid - myShare;
          return (
            <View key={expense.id}>
              <Row
                title={expense.description}
                subtitle={`${group?.name ?? 'No group'} · ${personName(
                  people,
                  expense.paidBy[0]?.personId ?? '',
                  meId
                )} paid ${formatMoney(expense.amount, expense.currency)}`}
                right={
                  <Text style={[font.bodyStrong, { color: balanceColor(delta, c) }]}>
                    {delta === 0 ? '—' : formatMoney(Math.abs(delta), expense.currency)}
                  </Text>
                }
                onPress={() => router.push(`/expense/${expense.id}`)}
              />
              {index < shared.length - 1 ? <Divider /> : null}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  header: {
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
});
