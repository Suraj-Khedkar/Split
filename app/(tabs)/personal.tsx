import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ExpenseFilterBar } from '../../src/components/ExpenseFilterBar';
import { Divider, EmptyState, Fab } from '../../src/components/ui';
import { spendTotal } from '../../src/lib/entries';
import { emptyFilter, filterExpenses, isFilterActive, type ExpenseFilter } from '../../src/lib/filters';
import { formatMoney } from '../../src/lib/money';
import { usePersonalExpenses, usePersonalGroup } from '../../src/store/selectors';
import { useStore } from '../../src/store/useStore';
import { Palette, font, iconForCategory, spacing, useColors } from '../../src/theme';

/** YYYY-MM for today, to headline the current month rather than all time. */
const thisMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Your own spending — the things you bought that nobody owes you for.
 *
 * Kept apart from groups because the question is different: a group asks who
 * owes whom, this asks where your money went. There are no balances here by
 * construction (you paid, you consumed), so the screen leads with a total
 * instead of a net position.
 */
export default function PersonalScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();

  const group = usePersonalGroup();
  const expenses = usePersonalExpenses();
  const people = useStore((s) => s.people);
  const currency = group?.currency ?? 'INR';

  const [filter, setFilter] = useState<ExpenseFilter>(emptyFilter);
  const visible = useMemo(
    () => filterExpenses(expenses, filter, people),
    [expenses, filter, people]
  );

  const month = thisMonth();
  const monthTotal = useMemo(
    () => spendTotal(expenses.filter((e) => (e.date || e.createdAt.slice(0, 10)).startsWith(month))),
    [expenses, month]
  );
  const allTimeTotal = useMemo(() => spendTotal(expenses), [expenses]);
  const shownTotal = spendTotal(visible);
  const filtered = isFilterActive(filter);

  // The tab renders before the first sync has created the group server-side.
  if (!group) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <EmptyState
          icon="wallet-outline"
          title="Setting up your personal ledger"
          body="This appears once the app has synced with your server. Pull to sync from the Account tab if it does not."
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ExpenseFilterBar filter={filter} onChange={setFilter} compact />

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 140 }}
        initialNumToRender={12}
        windowSize={9}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={Divider}
        ListHeaderComponent={
          <View>
            <View style={styles.hero}>
              <Text style={[font.small, { color: c.textMuted }]}>Spent this month</Text>
              <Text style={[font.h1, { color: c.text }]}>
                {formatMoney(monthTotal, currency)}
              </Text>
              <Text style={[font.small, { color: c.textFaint, marginTop: 2 }]}>
                {formatMoney(allTimeTotal, currency)} all time · {expenses.length} expense
                {expenses.length === 1 ? '' : 's'}
              </Text>

              <Pressable
                onPress={() => router.push('/report/personal')}
                android_ripple={{ color: c.pressed }}
                style={({ pressed }) => [styles.reportBtn, pressed && { backgroundColor: c.pressed }]}
              >
                <Ionicons name="bar-chart-outline" size={16} color={c.owed} />
                <Text style={[font.small, { color: c.owed, marginLeft: 6 }]}>
                  See where it went
                </Text>
              </Pressable>
            </View>

            <View style={styles.listHeader}>
              <Text style={[font.small, { color: c.textFaint }]}>
                {filtered ? `Matching · ${visible.length}` : `All · ${visible.length}`}
              </Text>
              {filtered ? (
                <Text style={[font.small, { color: c.owed }]}>
                  {formatMoney(shownTotal, currency)}
                </Text>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={filtered ? 'search-outline' : 'wallet-outline'}
            title={filtered ? 'Nothing matches' : 'No personal expenses yet'}
            body={
              filtered
                ? 'Try a different search, or clear the filters.'
                : 'Track a coffee, a bus fare, a book — anything that is yours alone and not split with anyone.'
            }
          />
        }
        renderItem={({ item: expense }) => (
          <Pressable
            onPress={() => router.push(`/expense/${expense.id}`)}
            android_ripple={{ color: c.pressed }}
            style={({ pressed }) => ({ backgroundColor: pressed ? c.pressed : c.card })}
          >
            <View style={styles.row}>
              <View style={styles.icon}>
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
                <Text style={[font.tiny, { color: c.textFaint, marginTop: 2 }]}>
                  {expense.date} · {expense.category}
                </Text>
              </View>
              <Text style={[font.bodyStrong, { color: c.text }]}>
                {formatMoney(expense.amount, expense.currency)}
              </Text>
            </View>
          </Pressable>
        )}
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
      paddingBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    reportBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      marginTop: spacing.md,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: c.border,
    },
    listHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    icon: {
      width: 38,
      height: 38,
      borderRadius: 8,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.md,
    },
  });
