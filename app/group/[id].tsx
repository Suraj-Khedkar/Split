import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  Amount,
  Avatar,
  Button,
  Divider,
  EmptyState,
  Fab,
  Row,
  SectionTitle,
} from '../../src/components/ui';
import { formatMoney } from '../../src/lib/money';
import { useGroupExpenses, useGroupSummary } from '../../src/store/selectors';
import { personName, useStore } from '../../src/store/useStore';
import { Palette, balanceColor, categoryIcon, font, spacing, useColors } from '../../src/theme';

export default function GroupScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const groups = useStore((s) => s.groups);
  const people = useStore((s) => s.people);
  const meId = useStore((s) => s.meId);

  const group = groups.find((g) => g.id === id);
  const expenses = useGroupExpenses(id ?? '');
  const { balances, debts, myNet } = useGroupSummary(id ?? '');

  if (!group) {
    return <EmptyState icon="alert-circle-outline" title="Group not found" />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen
        options={{
          title: group.name,
          headerRight: () => (
            <Pressable
              onPress={() => router.push(`/group/manage?groupId=${group.id}`)}
              hitSlop={10}
            >
              <Ionicons name="settings-outline" size={22} color={c.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <View style={styles.header}>
          <Text style={[font.h1, { color: c.text }]}>{group.name}</Text>
          <View style={{ marginTop: spacing.xs }}>
            {myNet === 0 ? (
              <Text style={[font.body, { color: c.settled }]}>You are all settled up</Text>
            ) : (
              <Text style={[font.body, { color: c.textMuted }]}>
                {myNet > 0 ? 'You are owed ' : 'You owe '}
                <Text style={{ color: balanceColor(myNet, c), fontWeight: '700' }}>
                  {formatMoney(myNet, group.currency)}
                </Text>
              </Text>
            )}
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
            <Button
              title="Invite"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => router.push(`/group/invite?groupId=${group.id}`)}
            />
            <Button
              title="Settle up"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => router.push(`/settle/${group.id}`)}
            />
            <Button
              title="Add expense"
              style={{ flex: 1 }}
              onPress={() => router.push(`/expense/new?groupId=${group.id}`)}
            />
          </View>
        </View>

        {debts.length > 0 ? (
          <>
            <SectionTitle>Suggested payments</SectionTitle>
            <Text style={styles.hint}>
              The fewest transfers that clear every balance in this group.
            </Text>
            {debts.map((debt, index) => (
              <View key={`${debt.fromId}-${debt.toId}-${index}`}>
                <Row
                  left={<Ionicons name="arrow-forward-circle-outline" size={26} color={c.owe} />}
                  title={`${personName(people, debt.fromId, meId)} → ${personName(people, debt.toId, meId)}`}
                  subtitle={formatMoney(debt.amount, group.currency)}
                />
                {index < debts.length - 1 ? <Divider /> : null}
              </View>
            ))}
          </>
        ) : null}

        <SectionTitle>Members</SectionTitle>
        {group.memberIds.map((memberId, index) => {
          const person = people.find((p) => p.id === memberId);
          if (!person) return null;
          const net = balances.find((b) => b.personId === memberId)?.amount ?? 0;
          return (
            <View key={memberId}>
              <Row
                left={<Avatar name={person.name} colorIndex={person.colorIndex} size={36} />}
                title={personName(people, memberId, meId)}
                right={<Amount value={net} currency={group.currency} size="small" />}
              />
              {index < group.memberIds.length - 1 ? <Divider /> : null}
            </View>
          );
        })}

        <SectionTitle>Expenses</SectionTitle>
        {expenses.length === 0 ? (
          <EmptyState
            icon="receipt-outline"
            title="No expenses yet"
            body="Add the first one and balances update instantly."
          />
        ) : (
          expenses.map((expense, index) => {
            const payer = expense.paidBy[0];
            const myShare = expense.splits.find((s) => s.personId === meId)?.amount ?? 0;
            const myPaid = expense.paidBy.find((p) => p.personId === meId)?.amount ?? 0;
            const delta = myPaid - myShare;
            return (
              <View key={expense.id}>
                <Pressable
                  onPress={() => router.push(`/expense/${expense.id}`)}
                  style={({ pressed }) => ({ backgroundColor: pressed ? c.surface : c.card })}
                >
                  <View style={styles.expenseRow}>
                    <View style={styles.expenseIcon}>
                      <Ionicons
                        name={(categoryIcon[expense.category] ?? 'receipt-outline') as never}
                        size={20}
                        color={c.textMuted}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[font.bodyStrong, { color: c.text }]}>{expense.description}</Text>
                      <Text style={[font.small, { color: c.textMuted, marginTop: 2 }]}>
                        {personName(people, payer?.personId ?? '', meId)} paid{' '}
                        {formatMoney(expense.amount, expense.currency)}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[font.tiny, { color: c.textFaint }]}>
                        {delta > 0 ? 'you lent' : delta < 0 ? 'you borrowed' : ''}
                      </Text>
                      <Text style={[font.bodyStrong, { color: balanceColor(delta, c) }]}>
                        {delta === 0 ? '—' : formatMoney(Math.abs(delta), expense.currency)}
                      </Text>
                    </View>
                  </View>
                </Pressable>
                {index < expenses.length - 1 ? <Divider /> : null}
              </View>
            );
          })
        )}
      </ScrollView>

      <Fab onPress={() => router.push(`/expense/new?groupId=${group.id}`)} />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  hint: {
    ...font.small,
    color: c.textFaint,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  expenseIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
});
