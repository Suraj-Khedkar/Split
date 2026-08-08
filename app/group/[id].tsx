import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ExpenseFilterBar } from '../../src/components/ExpenseFilterBar';
import {
  Amount,
  Avatar,
  Divider,
  EmptyState,
  Fab,
  Row,
  SectionTitle,
} from '../../src/components/ui';
import { emptyFilter, filterExpenses, isFilterActive, type ExpenseFilter } from '../../src/lib/filters';
import { formatMoney } from '../../src/lib/money';
import { useGroupExpenses, useGroupSummary } from '../../src/store/selectors';
import { personName, useStore } from '../../src/store/useStore';
import { Palette, balanceColor, font, iconForCategory, radius, spacing, useColors } from '../../src/theme';

/** One of the four things you actually do in a group. */
function Action({
  icon,
  label,
  onPress,
  accent,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  accent?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: c.pressed }}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        paddingVertical: spacing.md,
        borderRadius: radius.md,
        backgroundColor: pressed ? c.pressed : 'transparent',
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: accent ? c.owed : c.surface,
        }}
      >
        <Ionicons name={icon as never} size={20} color={accent ? c.onDark : c.text} />
      </View>
      <Text style={[font.small, { color: c.textMuted, marginTop: 6 }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

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

  const [filter, setFilter] = useState<ExpenseFilter>(emptyFilter);
  const [showMembers, setShowMembers] = useState(false);

  const visible = useMemo(
    () => filterExpenses(expenses, filter, people),
    [expenses, filter, people]
  );

  // Counted the same way the list counts, so the header and the list header
  // never show two different numbers for the same thing.
  const { spend, spendCount, settlementCount } = useMemo(() => {
    let spend = 0;
    let spendCount = 0;
    let settlementCount = 0;
    for (const e of expenses) {
      if (e.isSettlement) settlementCount += 1;
      else {
        spend += e.amount;
        spendCount += 1;
      }
    }
    return { spend, spendCount, settlementCount };
  }, [expenses]);

  if (!group) {
    return <EmptyState icon="alert-circle-outline" title="Group not found" />;
  }

  const filtered = isFilterActive(filter);
  const shownTotal = visible.reduce((sum, e) => sum + e.amount, 0);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen
        options={{
          title: group.name,
          headerRight: () => (
            <Pressable
              onPress={() => router.push(`/group/manage?groupId=${group.id}`)}
              hitSlop={10}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Ionicons name="settings-outline" size={22} color={c.text} />
            </Pressable>
          ),
        }}
      />

      {/* Search sits outside the list on purpose: inside FlatList's header it
          would remount on every keystroke and drop focus after one letter. */}
      <ExpenseFilterBar
        filter={filter}
        onChange={setFilter}
        people={group.memberIds}
      />

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 140 }}
        // 669 expenses in one group: rendering them all at once is what made
        // this screen crawl. FlatList keeps only what is near the viewport.
        initialNumToRender={12}
        windowSize={9}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={Divider}
        ListHeaderComponent={
          <View>
            <View style={styles.hero}>
              <Text style={[font.small, { color: c.textMuted }]}>
                {myNet === 0 ? 'All settled up' : myNet > 0 ? 'You are owed' : 'You owe'}
              </Text>
              <Text style={[font.h1, { color: myNet === 0 ? c.settled : balanceColor(myNet, c) }]}>
                {formatMoney(Math.abs(myNet), group.currency)}
              </Text>
              <Text style={[font.small, { color: c.textFaint, marginTop: 2 }]}>
                {formatMoney(spend, group.currency)} spent · {spendCount} expense
                {spendCount === 1 ? '' : 's'}
                {settlementCount ? ` · ${settlementCount} settled` : ''} ·{' '}
                {group.memberIds.length} member{group.memberIds.length === 1 ? '' : 's'}
              </Text>

              <View style={styles.actions}>
                <Action
                  icon="add"
                  label="Add"
                  accent
                  onPress={() => router.push(`/expense/new?groupId=${group.id}`)}
                />
                <Action
                  icon="swap-horizontal"
                  label="Settle up"
                  onPress={() => router.push(`/settle/${group.id}`)}
                />
                <Action
                  icon="bar-chart-outline"
                  label="Report"
                  onPress={() => router.push(`/report/group?groupId=${group.id}`)}
                />
                <Action
                  icon="person-add-outline"
                  label="Invite"
                  onPress={() => router.push(`/group/invite?groupId=${group.id}`)}
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
                      onPress={() => router.push(`/settle/${group.id}`)}
                      chevron
                    />
                    {index < debts.length - 1 ? <Divider /> : null}
                  </View>
                ))}
              </>
            ) : null}

            <Pressable
              onPress={() => setShowMembers((v) => !v)}
              android_ripple={{ color: c.pressed }}
              style={({ pressed }) => [styles.memberToggle, pressed && { backgroundColor: c.pressed }]}
            >
              <Text style={[font.small, { color: c.textFaint, letterSpacing: 0.6 }]}>
                MEMBERS ({group.memberIds.length})
              </Text>
              <Ionicons
                name={showMembers ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={c.textFaint}
              />
            </Pressable>
            {showMembers
              ? group.memberIds.map((memberId, index) => {
                  const person = people.find((p) => p.id === memberId);
                  if (!person) return null;
                  const net = balances.find((b) => b.personId === memberId)?.amount ?? 0;
                  return (
                    <View key={memberId}>
                      <Row
                        left={<Avatar name={person.name} colorIndex={person.colorIndex} size={36} />}
                        title={personName(people, memberId, meId)}
                        right={<Amount value={net} currency={group.currency} size="small" />}
                        onPress={
                          memberId === meId ? undefined : () => router.push(`/friend/${memberId}`)
                        }
                        chevron={memberId !== meId}
                      />
                      {index < group.memberIds.length - 1 ? <Divider /> : null}
                    </View>
                  );
                })
              : null}

            <View style={styles.listHeader}>
              <Text style={[font.small, { color: c.textFaint, letterSpacing: 0.6 }]}>
                {filtered ? `MATCHING (${visible.length})` : `EXPENSES (${visible.length})`}
              </Text>
              {filtered ? (
                <Text style={[font.small, { color: c.owed }]}>
                  {formatMoney(shownTotal, group.currency)}
                </Text>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={filtered ? 'search-outline' : 'receipt-outline'}
            title={filtered ? 'Nothing matches' : 'No expenses yet'}
            body={
              filtered
                ? 'Try a different search, or clear the filters.'
                : 'Add the first one and balances update instantly.'
            }
          />
        }
        renderItem={({ item: expense }) => {
          const payer = expense.paidBy[0];
          const myShare = expense.splits.find((s) => s.personId === meId)?.amount ?? 0;
          const myPaid = expense.paidBy.find((p) => p.personId === meId)?.amount ?? 0;
          const delta = myPaid - myShare;
          return (
            <Pressable
              onPress={() => router.push(`/expense/${expense.id}`)}
              android_ripple={{ color: c.pressed }}
              style={({ pressed }) => ({ backgroundColor: pressed ? c.pressed : c.card })}
            >
              <View style={styles.expenseRow}>
                <View style={styles.expenseIcon}>
                  <Ionicons
                    name={iconForCategory(expense.category) as never}
                    size={20}
                    color={c.textMuted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[font.bodyStrong, { color: c.text }]} numberOfLines={1}>
                    {expense.description}
                  </Text>
                  <Text style={[font.small, { color: c.textMuted, marginTop: 2 }]}>
                    {personName(people, payer?.personId ?? '', meId)} paid{' '}
                    {formatMoney(expense.amount, expense.currency)}
                  </Text>
                  <Text style={[font.tiny, { color: c.textFaint, marginTop: 1 }]}>
                    {expense.date} · {expense.category}
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
          );
        }}
      />

      <Fab onPress={() => router.push(`/expense/new?groupId=${group.id}`)} />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    hero: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.xs,
      marginTop: spacing.lg,
    },
    hint: {
      ...font.small,
      color: c.textFaint,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    memberToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      marginTop: spacing.sm,
    },
    listHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
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
