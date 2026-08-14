import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { Avatar, Divider, EmptyState } from '../../src/components/ui';
import { personName, useStore } from '../../src/store/useStore';
import { Palette, font, spacing, useColors } from '../../src/theme';
import type { ActivityAction } from '../../src/types';

/**
 * The permanent record of everything that has happened to shared money.
 *
 * Read straight from the server's append-only log rather than derived from the
 * current expense list, which is what lets a deleted expense still appear here:
 * the expense is gone, its trail is not. Nothing on this screen can remove an
 * entry, and the API has no endpoint that would.
 */
const LOOK: Record<ActivityAction, { icon: string; verb: string; tone: 'normal' | 'warn' | 'good' }> = {
  created: { icon: 'add-circle-outline', verb: 'added', tone: 'normal' },
  edited: { icon: 'create-outline', verb: 'edited', tone: 'warn' },
  deleted: { icon: 'trash-outline', verb: 'deleted', tone: 'warn' },
  settled: { icon: 'swap-horizontal-outline', verb: 'settled up', tone: 'good' },
  joined: { icon: 'person-add-outline', verb: 'joined', tone: 'good' },
};

export default function ActivityScreen() {
  const c = useColors();
  const styles = makeStyles(c);
  const activity = useStore((s) => s.activity);
  const people = useStore((s) => s.people);
  const groups = useStore((s) => s.groups);
  const meId = useStore((s) => s.meId);

  const feed = [...activity].sort((a, b) => b.at.localeCompare(a.at));

  const toneColor = (tone: 'normal' | 'warn' | 'good') =>
    tone === 'warn' ? c.owe : tone === 'good' ? c.settled : c.owed;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={feed}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={
          <EmptyState
            icon="pulse-outline"
            title="Nothing here yet"
            body="Changes will be recorded here."
          />
        }
        renderItem={({ item }) => {
          const look = LOOK[item.action] ?? LOOK.created;
          const actor = people.find((p) => p.id === item.actorId);
          const group = groups.find((g) => g.id === item.groupId);
          const when = new Date(item.at);

          return (
            <View style={styles.row}>
              <Avatar name={actor?.name ?? '?'} colorIndex={actor?.colorIndex ?? 0} size={36} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <View style={styles.headline}>
                  <Ionicons
                    name={look.icon as never}
                    size={14}
                    color={toneColor(look.tone)}
                    style={{ marginRight: 5 }}
                  />
                  <Text style={[font.bodyStrong, { color: c.text, flex: 1 }]}>
                    {personName(people, item.actorId, meId)} {look.verb}
                    {item.action === 'joined' ? '' : item.summary ? ` "${item.summary}"` : ''}
                  </Text>
                </View>

                <Text style={[font.small, { color: c.textMuted, marginTop: 2 }]}>
                  {group ? `${group.name} · ` : ''}
                  {when.toLocaleString()}
                </Text>

                {item.changes.map((change) => (
                  <Text
                    key={change.field}
                    style={[font.small, { color: c.textFaint, marginTop: 4 }]}
                  >
                    {change.field}
                    {': '}
                    <Text style={{ textDecorationLine: 'line-through' }}>{change.from}</Text>
                    {'  →  '}
                    <Text style={{ color: c.textMuted }}>{change.to}</Text>
                  </Text>
                ))}
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    headline: { flexDirection: 'row', alignItems: 'center' },
  });
