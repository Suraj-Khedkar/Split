import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, Button, Divider, EmptyState, Row, SectionTitle } from '../../src/components/ui';
import { formatMoney } from '../../src/lib/money';
import { personName, useStore } from '../../src/store/useStore';
import { Palette, balanceColor, categoryIcon, font, spacing, useColors } from '../../src/theme';

export default function ExpenseScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const expenses = useStore((s) => s.expenses);
  const people = useStore((s) => s.people);
  const groups = useStore((s) => s.groups);
  const meId = useStore((s) => s.meId);
  const deleteExpense = useStore((s) => s.deleteExpense);

  const expense = expenses.find((e) => e.id === id);
  if (!expense) return <EmptyState icon="alert-circle-outline" title="Expense not found" />;

  const group = groups.find((g) => g.id === expense.groupId);
  const payer = expense.paidBy[0];
  const myShare = expense.splits.find((s) => s.personId === meId)?.amount ?? 0;
  const myPaid = expense.paidBy.find((p) => p.personId === meId)?.amount ?? 0;
  const delta = myPaid - myShare;

  const confirmDelete = () =>
    Alert.alert('Delete this expense?', 'Balances will update for everyone involved.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteExpense(expense.id);
          router.back();
        },
      },
    ]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: expense.isSettlement ? 'Payment' : 'Expense' }} />

      <View style={styles.header}>
        <View style={styles.icon}>
          <Ionicons
            name={(categoryIcon[expense.category] ?? 'receipt-outline') as never}
            size={28}
            color={c.owed}
          />
        </View>
        <Text style={[font.h2, { marginTop: spacing.md }, { color: c.text }]}>{expense.description}</Text>
        <Text style={[font.h1, { marginTop: spacing.xs }, { color: c.text }]}>
          {formatMoney(expense.amount, expense.currency)}
        </Text>
        <Text style={[font.small, { color: c.textMuted, marginTop: spacing.xs }]}>
          Added by {personName(people, payer?.personId ?? '', meId)}
          {group ? ` in ${group.name}` : ''} · {expense.date}
        </Text>
        {delta !== 0 ? (
          <Text style={[font.body, { color: balanceColor(delta, c), marginTop: spacing.sm, fontWeight: '600' }]}>
            {delta > 0 ? 'You lent ' : 'You borrowed '}
            {formatMoney(Math.abs(delta), expense.currency)}
          </Text>
        ) : null}
      </View>

      <SectionTitle>Paid by</SectionTitle>
      {expense.paidBy.map((share) => {
        const person = people.find((p) => p.id === share.personId);
        return (
          <Row
            key={share.personId}
            left={<Avatar name={person?.name ?? '?'} colorIndex={person?.colorIndex ?? 0} size={34} />}
            title={personName(people, share.personId, meId)}
            right={<Text style={[font.bodyStrong, { color: c.text }]}>{formatMoney(share.amount, expense.currency)}</Text>}
          />
        );
      })}

      <SectionTitle>
        {expense.isSettlement ? 'Paid to' : `Split ${expense.splitMethod}`}
      </SectionTitle>
      {expense.splits.map((share, index) => {
        const person = people.find((p) => p.id === share.personId);
        return (
          <View key={share.personId}>
            <Row
              left={<Avatar name={person?.name ?? '?'} colorIndex={person?.colorIndex ?? 0} size={34} />}
              title={personName(people, share.personId, meId)}
              right={<Text style={[font.body, { color: c.text }]}>{formatMoney(share.amount, expense.currency)}</Text>}
            />
            {index < expense.splits.length - 1 ? <Divider /> : null}
          </View>
        );
      })}

      {expense.notes ? (
        <>
          <SectionTitle>Notes</SectionTitle>
          <Text style={{ ...font.body, color: c.textMuted, paddingHorizontal: spacing.lg }}>
            {expense.notes}
          </Text>
        </>
      ) : null}

      <View style={{ padding: spacing.lg, marginTop: spacing.lg }}>
        <Button title="Delete" variant="danger" onPress={confirmDelete} />
      </View>
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
  icon: {
    width: 60,
    height: 60,
    borderRadius: 14,
    backgroundColor: c.owedTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
