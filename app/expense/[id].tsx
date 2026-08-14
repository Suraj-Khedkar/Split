import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  Avatar,
  Button,
  ConfirmDialog,
  Divider,
  EmptyState,
  Row,
  SectionTitle,
} from '../../src/components/ui';
import { describeEntry } from '../../src/lib/entries';
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
  const activity = useStore((s) => s.activity);
  // Must be declared before the early return below, or the hook order changes
  // between renders.
  const [confirming, setConfirming] = useState(false);

  const expense = expenses.find((e) => e.id === id);
  if (!expense) return <EmptyState icon="alert-circle-outline" title="Expense not found" />;

  // Plain filter rather than useMemo: this sits after the early return above,
  // where a hook would break the rules of hooks, and the list is tiny.
  const history = activity
    .filter((e) => e.expenseId === expense.id && e.action === 'edited')
    .sort((a, b) => b.at.localeCompare(a.at));

  const group = groups.find((g) => g.id === expense.groupId);
  const payer = expense.paidBy[0];
  const entry = describeEntry(expense, people, meId);

  // react-native-web has no Alert implementation, so the Alert.alert this used
  // to call was a silent no-op in the browser and the installed PWA — tapping
  // Delete simply did nothing. ConfirmDialog is the app's own component and
  // behaves the same on every platform.
  const doDelete = () => {
    setConfirming(false);
    deleteExpense(expense.id);
    router.back();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: entry.isPayback ? 'Payback' : 'Expense' }} />

      <View style={styles.header}>
        <View style={[styles.icon, entry.isPayback && { backgroundColor: c.surface }]}>
          <Ionicons
            name={
              (entry.isPayback
                ? 'swap-horizontal-outline'
                : categoryIcon[expense.category] ?? 'receipt-outline') as never
            }
            size={28}
            color={entry.isPayback ? c.settled : c.owed}
          />
        </View>
        <Text style={[font.h2, { marginTop: spacing.md }, { color: c.text }]}>{entry.title}</Text>
        <Text style={[font.h1, { marginTop: spacing.xs }, { color: c.text }]}>
          {formatMoney(expense.amount, expense.currency)}
        </Text>
        <Text style={[font.small, { color: c.textMuted, marginTop: spacing.xs }]}>
          {entry.isPayback ? 'Recorded by ' : 'Added by '}
          {personName(people, payer?.personId ?? '', meId)}
          {group ? ` in ${group.name}` : ''} · {expense.date}
        </Text>
        {entry.isPayback ? null : entry.delta !== 0 ? (
          <Text style={[font.body, { color: balanceColor(entry.delta, c), marginTop: spacing.sm, fontWeight: '600' }]}>
            {entry.delta > 0 ? 'You lent ' : 'You borrowed '}
            {formatMoney(Math.abs(entry.delta), expense.currency)}
          </Text>
        ) : null}
      </View>

      <SectionTitle>{entry.isPayback ? 'From' : 'Paid by'}</SectionTitle>
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
        {entry.isPayback ? 'To' : `Split ${expense.splitMethod}`}
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

      {history.length > 0 ? (
        <>
          <SectionTitle>Edit history</SectionTitle>
          {history.map((edit, index) => (
            <View key={edit.id}>
              <View style={styles.edit}>
                <Text style={[font.bodyStrong, { color: c.text }]}>
                  {personName(people, edit.actorId, meId)} edited this
                </Text>
                <Text style={[font.small, { color: c.textFaint, marginTop: 2 }]}>
                  {new Date(edit.at).toLocaleString()}
                </Text>
                {edit.changes.map((change) => (
                  <Text
                    key={change.field}
                    style={[font.small, { color: c.textMuted, marginTop: 6 }]}
                  >
                    {change.field}
                    {': '}
                    <Text style={{ textDecorationLine: 'line-through' }}>{change.from}</Text>
                    {'  →  '}
                    <Text style={{ color: c.text, fontWeight: '600' }}>{change.to}</Text>
                  </Text>
                ))}
              </View>
              {index < history.length - 1 ? <Divider /> : null}
            </View>
          ))}
        </>
      ) : null}

      <View style={{ padding: spacing.lg, marginTop: spacing.lg, gap: spacing.sm }}>
        {/* A payback is a transfer, not a bill: the expense form has no way to
            represent one, so correcting it means deleting and re-recording. */}
        {entry.isPayback ? null : (
          <Button
            title="Edit"
            variant="secondary"
            onPress={() => router.push(`/expense/new?id=${expense.id}`)}
          />
        )}
        <Button title="Delete" variant="danger" onPress={() => setConfirming(true)} />
      </View>

      <ConfirmDialog
        visible={confirming}
        title={entry.isPayback ? 'Delete this payback?' : 'Delete this expense?'}
        message="Balances will update for everyone involved."
        confirmLabel="Delete"
        destructive
        onConfirm={doDelete}
        onCancel={() => setConfirming(false)}
      />
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
  edit: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
});
