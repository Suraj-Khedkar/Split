import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ExpenseFilterBar } from '../../src/components/ExpenseFilterBar';
import { EmptyState, Fab } from '../../src/components/ui';
import { describeEntry, spendTotal } from '../../src/lib/entries';
import { emptyFilter, filterExpenses, isFilterActive, type ExpenseFilter } from '../../src/lib/filters';
import { formatMoney } from '../../src/lib/money';
import { useGroupExpenses, useGroupSummary } from '../../src/store/selectors';
import { personName, useStore } from '../../src/store/useStore';
import { Palette, balanceColor, font, iconForCategory, radius, spacing, useColors } from '../../src/theme';
import type { Expense } from '../../src/types';

/**
 * "Today", "Yesterday", or "14 Aug" — dates live in list headers now.
 *
 * Every row used to carry its own date, which made three lines of text out of
 * what is really one fact shared by a run of rows.
 */
function dayLabel(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date();
  const days = Math.round((startOf(today) - startOf(parsed)) / 864e5);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return parsed.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(parsed.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

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
          // c.card, not c.surface: the block these sit on is c.surface now,
          // and a chip the same colour as its background is not a chip.
          backgroundColor: accent ? c.owed : c.card,
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

type ListRow =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'expense'; key: string; expense: Expense };

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
  const { debts, myNet } = useGroupSummary(id ?? '');

  const [filter, setFilter] = useState<ExpenseFilter>(emptyFilter);

  const visible = useMemo(
    () => filterExpenses(expenses, filter, people),
    [expenses, filter, people]
  );

  // Rows interleaved with the date they fall under. Sorted by the expense date
  // rather than when it was entered, or a bill added today for last week would
  // open a second heading for a day that already has one further down.
  const rows = useMemo(() => {
    const byDate = [...visible].sort(
      (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
    );
    const out: ListRow[] = [];
    let seen = '';
    for (const expense of byDate) {
      if (expense.date !== seen) {
        seen = expense.date;
        out.push({ kind: 'date', key: `d:${expense.date}`, label: dayLabel(expense.date) });
      }
      out.push({ kind: 'expense', key: expense.id, expense });
    }
    return out;
  }, [visible]);

  // Counted the same way the list counts, so the header and the list header
  // never show two different numbers for the same thing.
  const { spend, spendCount } = useMemo(() => {
    let spend = 0;
    let spendCount = 0;
    for (const e of expenses) {
      if (!e.isSettlement) {
        spend += e.amount;
        spendCount += 1;
      }
    }
    return { spend, spendCount };
  }, [expenses]);

  if (!group) {
    return <EmptyState icon="alert-circle-outline" title="Group not found" />;
  }

  const filtered = isFilterActive(filter);
  // Spend only. With "include settlements" on, summing every visible row made
  // this figure count paybacks as fresh spending and disagree with the hero.
  const shownTotal = spendTotal(visible);
  const shownPaybacks = visible.filter((e) => e.isSettlement).length;
  const shownSpendCount = visible.length - shownPaybacks;

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
        onHeader
      />

      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        contentContainerStyle={{ paddingBottom: 140 }}
        // 669 expenses in one group: rendering them all at once is what made
        // this screen crawl. FlatList keeps only what is near the viewport.
        initialNumToRender={12}
        windowSize={9}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
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
                {formatMoney(spend, group.currency)} spent · {group.memberIds.length}{' '}
                {group.memberIds.length === 1 ? 'member' : 'members'}
                {debts.length ? ` · ${debts.length} to settle` : ''}
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
                  label="Settle"
                  onPress={() => router.push(`/settle/${group.id}`)}
                />
                <Action
                  icon="people-outline"
                  label="Members"
                  onPress={() => router.push(`/group/members?groupId=${group.id}`)}
                />
                <Action
                  icon="bar-chart-outline"
                  label="Report"
                  onPress={() => router.push(`/report/group?groupId=${group.id}`)}
                />
              </View>
            </View>


            <View style={styles.listHeader}>
              <Text style={[font.small, { color: c.textFaint }]}>
                {filtered ? `Matching · ${shownSpendCount}` : `Expenses · ${shownSpendCount}`}
                {shownPaybacks ? ` · ${shownPaybacks} payback${shownPaybacks === 1 ? '' : 's'}` : ''}
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
                ? 'Try a different search.'
                : 'Add the first one to get started.'
            }
          />
        }
        renderItem={({ item }) => {
          if (item.kind === 'date') {
            return (
              <View style={styles.dateHeader}>
                <Text style={[font.small, { color: c.textFaint }]}>{item.label}</Text>
              </View>
            );
          }

          const expense = item.expense;
          const payer = expense.paidBy[0];
          const entry = describeEntry(expense, people, meId);
          return (
            <Pressable
              onPress={() => router.push(`/expense/${expense.id}`)}
              android_ripple={{ color: c.pressed }}
              style={({ pressed }) => ({ backgroundColor: pressed ? c.pressed : c.card })}
            >
              {/* Two lines, not four. What it was and who paid is enough to
                  recognise a row; the split, the category and the exact date
                  are one tap away on the detail screen. */}
              <View style={styles.expenseRow}>
                <View style={styles.expenseIcon}>
                  <Ionicons
                    name={
                      (entry.isPayback
                        ? 'swap-horizontal-outline'
                        : iconForCategory(expense.category)) as never
                    }
                    size={20}
                    color={entry.isPayback ? c.settled : c.textMuted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[font.bodyStrong, { color: c.text }]} numberOfLines={1}>
                    {entry.title}
                  </Text>
                  <Text style={[font.small, { color: c.textMuted, marginTop: 2 }]} numberOfLines={1}>
                    {entry.isPayback
                      ? 'Payback'
                      : `${personName(people, payer?.personId ?? '', meId)} paid ${formatMoney(
                          expense.amount,
                          expense.currency
                        )}`}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', marginLeft: spacing.sm }}>
                  {entry.isPayback ? (
                    <Text style={[font.small, { color: c.settled }]}>settled</Text>
                  ) : entry.delta === 0 ? (
                    <Text style={[font.small, { color: c.textFaint }]}>—</Text>
                  ) : (
                    // Colour carries the direction here, as it does everywhere
                    // else in the app; the detail screen spells it out in words.
                    <Text style={[font.bodyStrong, { color: balanceColor(entry.delta, c) }]}>
                      {entry.delta > 0 ? '+' : '−'}
                      {formatMoney(Math.abs(entry.delta), expense.currency)}
                    </Text>
                  )}
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
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
      backgroundColor: c.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.xs,
      marginTop: spacing.md,
    },
    dateHeader: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xs,
      backgroundColor: c.bg,
    },
    listHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
      backgroundColor: c.bg,
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
