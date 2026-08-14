import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Amount, BalanceLabel, EmptyState, Fab, GroupIcon } from '../../src/components/ui';
import {
  useGroupBuckets,
  useOverallBalance,
  type GroupRow,
} from '../../src/store/selectors';
import { Palette, font, spacing, useColors } from '../../src/theme';

/**
 * One flat list rather than a SectionList: the rows are not uniform — headers
 * and the "show hidden" control sit between them — and a discriminated union
 * keeps that explicit instead of smuggling it through section metadata.
 */
type Item =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'group'; key: string; row: GroupRow }
  | { kind: 'toggle'; key: string; count: number; open: boolean };

export default function GroupsScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const { active, settled, dormant } = useGroupBuckets();
  const overall = useOverallBalance();
  const [showDormant, setShowDormant] = useState(false);

  const items: Item[] = [];
  if (active.length > 0) {
    // No header when there is nothing to distinguish it from.
    if (settled.length > 0 || dormant.length > 0) {
      items.push({ kind: 'header', key: 'h-active', label: 'Active' });
    }
    for (const row of active) items.push({ kind: 'group', key: row.group.id, row });
  }
  if (settled.length > 0) {
    items.push({
      kind: 'header',
      key: 'h-settled',
      label: 'Settled up',
    });
    for (const row of settled) items.push({ kind: 'group', key: row.group.id, row });
  }
  if (dormant.length > 0) {
    items.push({ kind: 'toggle', key: 'toggle', count: dormant.length, open: showDormant });
    if (showDormant) {
      for (const row of dormant) items.push({ kind: 'group', key: row.group.id, row });
    }
  }

  const renderGroup = (row: GroupRow, muted: boolean) => (
    <Pressable
      onPress={() => router.push(`/group/${row.group.id}`)}
      style={({ pressed }) => [
        styles.groupRow,
        { backgroundColor: pressed ? c.surface : c.card },
        muted && { opacity: 0.72 },
      ]}
    >
      <GroupIcon type={row.group.type} />
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Text style={[font.bodyStrong, { color: c.text }]}>{row.group.name}</Text>
        <View style={{ marginTop: 2 }}>
          {row.settled ? (
            <Text style={[font.small, { color: c.settled }]}>Settled up</Text>
          ) : (
            <BalanceLabel amount={row.myNet} currency={row.group.currency} />
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { color: c.textMuted }]}>Total balance</Text>
            <Amount value={overall} size="h2" />
            <BalanceLabel amount={overall} />
          </View>
          <Pressable
            onPress={() => router.push('/report/me')}
            accessibilityLabel="Your spending report"
            android_ripple={{ color: c.pressed, borderless: true }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: pressed ? c.pressed : 'transparent',
            })}
          >
            <Ionicons name="bar-chart-outline" size={15} color={c.owed} />
            <Text style={[font.small, { color: c.owed, marginLeft: 6 }]}>Your spending</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title="No groups yet"
            body="Create a group for a trip, a flat, or anything you split regularly."
          />
        }
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            return (
              <View style={styles.sectionHeader}>
                <Text style={[font.small, { color: c.textMuted, fontWeight: '700' }]}>
                  {item.label.toUpperCase()}
                </Text>
              </View>
            );
          }

          if (item.kind === 'toggle') {
            return (
              <Pressable
                onPress={() => setShowDormant((v) => !v)}
                style={({ pressed }) => [
                  styles.toggle,
                  { backgroundColor: pressed ? c.surface : 'transparent' },
                ]}
              >
                <Ionicons
                  name={item.open ? 'chevron-up' : 'archive-outline'}
                  size={18}
                  color={c.textMuted}
                />
                <Text style={[font.small, { color: c.textMuted, marginLeft: spacing.sm, flex: 1 }]}>
                  {item.open
                    ? 'Hide older'
                    : `${item.count} older settled group${item.count === 1 ? '' : 's'}`}
                </Text>
              </Pressable>
            );
          }

          return renderGroup(item.row, !item.row.settled ? false : true);
        }}
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
  sectionHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
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
