import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';

import { Amount, Avatar, Button, Divider, EmptyState, Row } from '../../src/components/ui';
import { useGroupSummary } from '../../src/store/selectors';
import { personName, useStore } from '../../src/store/useStore';
import { spacing, useColors } from '../../src/theme';

/**
 * Who is in the group, and where each of them stands.
 *
 * Split out of the group screen, which was showing the balance, four actions,
 * the suggested payments, the member list and every expense on one page. The
 * member list is the part you look at least often and it cost the most height.
 */
export default function GroupMembersScreen() {
  const c = useColors();
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();

  const groups = useStore((s) => s.groups);
  const people = useStore((s) => s.people);
  const meId = useStore((s) => s.meId);
  const { balances } = useGroupSummary(groupId ?? '');

  const group = groups.find((g) => g.id === groupId);
  if (!group) return <EmptyState icon="alert-circle-outline" title="Group not found" />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: 'Members' }} />

      <View style={{ marginTop: spacing.lg }}>
        {group.memberIds.map((memberId, index) => {
          const person = people.find((p) => p.id === memberId);
          if (!person) return null;
          const net = balances.find((b) => b.personId === memberId)?.amount ?? 0;
          return (
            <View key={memberId}>
              <Row
                left={<Avatar name={person.name} colorIndex={person.colorIndex} size={38} />}
                title={personName(people, memberId, meId)}
                right={<Amount value={net} currency={group.currency} size="small" />}
                // Your own row has no friend page to open.
                onPress={memberId === meId ? undefined : () => router.push(`/friend/${memberId}`)}
                chevron={memberId !== meId}
              />
              {index < group.memberIds.length - 1 ? <Divider /> : null}
            </View>
          );
        })}
      </View>

      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Button
          title="Invite someone"
          onPress={() => router.push(`/group/invite?groupId=${group.id}`)}
        />
        <Button
          title="Group settings"
          variant="secondary"
          onPress={() => router.push(`/group/manage?groupId=${group.id}`)}
        />
      </View>
    </ScrollView>
  );
}
