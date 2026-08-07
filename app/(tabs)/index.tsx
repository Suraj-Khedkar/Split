import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Amount, BalanceLabel, EmptyState, Fab, GroupIcon } from '../../src/components/ui';
import { computeBalances, netForPerson } from '../../src/lib/balances';
import { useOverallBalance } from '../../src/store/selectors';
import { useStore } from '../../src/store/useStore';
import { Palette, font, spacing, useColors } from '../../src/theme';

export default function GroupsScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const groups = useStore((s) => s.groups);
  const expenses = useStore((s) => s.expenses);
  const meId = useStore((s) => s.meId);
  const overall = useOverallBalance();

  const rows = groups.map((group) => {
    const groupExpenses = expenses.filter((e) => e.groupId === group.id);
    const myNet = netForPerson(computeBalances(groupExpenses), meId);
    return { group, myNet };
  });

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={styles.header}>
        <Text style={[font.body, { color: c.textMuted }]}>Total balance</Text>
        <Amount value={overall} size="h2" />
        <BalanceLabel amount={overall} />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.group.id}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title="No groups yet"
            body="Create a group for a trip, a flat, or anything you split regularly."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/group/${item.group.id}`)}
            style={({ pressed }) => [
              styles.groupRow,
              { backgroundColor: pressed ? c.surface : c.card },
            ]}
          >
            <GroupIcon type={item.group.type} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={[font.bodyStrong, { color: c.text }]}>{item.group.name}</Text>
              <View style={{ marginTop: 2 }}>
                <BalanceLabel amount={item.myNet} currency={item.group.currency} />
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
          </Pressable>
        )}
        ListFooterComponent={
          <>
            <Link href="/group/new" asChild>
              <Pressable style={styles.newGroup}>
                <Ionicons name="add-circle-outline" size={22} color={c.owed} />
                <Text style={[font.bodyStrong, { color: c.owed, marginLeft: spacing.sm }]}>
                  Create a group
                </Text>
              </Pressable>
            </Link>
            <Link href="/group/invite" asChild>
              <Pressable style={styles.joinGroup}>
                <Ionicons name="enter-outline" size={22} color={c.owed} />
                <Text style={[font.bodyStrong, { color: c.owed, marginLeft: spacing.sm }]}>
                  Join a group with a code
                </Text>
              </Pressable>
            </Link>
          </>
        }
      />

      <Fab onPress={() => router.push('/expense/new')} />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  newGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  joinGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
});
