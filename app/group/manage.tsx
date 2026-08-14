import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar, Button, Divider, EmptyState, Row, SectionTitle } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/store/useAuth';
import { useStore } from '../../src/store/useStore';
import { Palette, font, radius, spacing, useColors } from '../../src/theme';

/** Alert has no web implementation in RNW, so confirm falls back to window.confirm. */
function confirmAction(title: string, message: string, onYes: () => void, yesLabel = 'Confirm') {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onYes();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: yesLabel, style: 'destructive', onPress: onYes },
  ]);
}

export default function ManageGroupScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();

  const groups = useStore((s) => s.groups);
  const people = useStore((s) => s.people);
  const meId = useStore((s) => s.meId);
  const refresh = useAuth((s) => s.refresh);

  const group = groups.find((g) => g.id === groupId);
  const [name, setName] = useState(group?.name ?? '');
  const [newMember, setNewMember] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  if (!group) return <EmptyState icon="alert-circle-outline" title="Group not found" />;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy('');
    }
  };

  const rename = () =>
    run('rename', async () => {
      await api.updateGroup(group.id, name.trim());
      await refresh();
      router.back();
    });

  const addMember = () =>
    run('member', async () => {
      await api.addMember(group.id, newMember.trim());
      setNewMember('');
      await refresh();
    });

  const leave = () =>
    confirmAction(
      'Leave this group?',
      'You will stop seeing its expenses. You can be invited back with a code.',
      () =>
        void run('leave', async () => {
          await api.leaveGroup(group.id);
          await refresh();
          router.replace('/');
        }),
      'Leave'
    );

  const remove = () =>
    confirmAction(
      'Delete this group?',
      `"${group.name}" and all of its expenses will be deleted for everyone in it. This cannot be undone.`,
      () =>
        void run('delete', async () => {
          await api.deleteGroup(group.id);
          await refresh();
          router.replace('/');
        }),
      'Delete'
    );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Group settings' }} />

      <SectionTitle>Name</SectionTitle>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Group name"
        placeholderTextColor={c.textFaint}
        style={styles.input}
      />
      <View style={{ padding: spacing.lg, paddingTop: spacing.md }}>
        <Button
          title="Save name"
          onPress={() => void rename()}
          disabled={!name.trim() || name.trim() === group.name}
          loading={busy === 'rename'}
        />
      </View>

      <SectionTitle>Members</SectionTitle>
      {group.memberIds.map((id, i) => {
        const person = people.find((p) => p.id === id);
        const alias = !!person?.isAlias;
        return (
          <View key={id}>
            <Row
              left={
                <Avatar
                  name={person?.name ?? '?'}
                  colorIndex={person?.colorIndex ?? 0}
                  size={36}
                />
              }
              title={id === meId ? 'You' : person?.name ?? 'Someone'}
              subtitle={alias ? 'No account yet' : undefined}
              right={
                alias ? (
                  <Button
                    title="That's me"
                    variant="secondary"
                    style={{ paddingVertical: 8, paddingHorizontal: 12 }}
                    onPress={() =>
                      confirmAction(
                        `Link ${person?.name} to your account?`,
                        `Every expense recorded against "${person?.name}" in this group becomes yours. This cannot be undone.`,
                        () =>
                          void run('claim', async () => {
                            await api.claimAlias(group.id, id);
                            await refresh();
                          }),
                        'Link'
                      )
                    }
                  />
                ) : undefined
              }
            />
            {i < group.memberIds.length - 1 ? <Divider /> : null}
          </View>
        );
      })}
      <SectionTitle>Add someone by name</SectionTitle>
      <Text style={styles.hint}>
        For people with no account. To invite a real person, use Invite.
      </Text>
      <TextInput
        value={newMember}
        onChangeText={setNewMember}
        placeholder="Name"
        placeholderTextColor={c.textFaint}
        style={styles.input}
      />
      <View style={{ padding: spacing.lg, paddingTop: spacing.md }}>
        <Button
          title="Add person"
          variant="secondary"
          onPress={() => void addMember()}
          disabled={!newMember.trim()}
          loading={busy === 'member'}
        />
      </View>

      {error ? (
        <View style={styles.error}>
          <Ionicons name="alert-circle-outline" size={18} color={c.danger} />
          <Text style={[font.small, { color: c.danger, flex: 1, marginLeft: spacing.sm }]}>{error}</Text>
        </View>
      ) : null}

      <SectionTitle>Danger zone</SectionTitle>
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Button
          title="Leave group"
          variant="secondary"
          onPress={leave}
          loading={busy === 'leave'}
        />
        <Button title="Delete group" variant="danger" onPress={remove} loading={busy === 'delete'} />
        <Text style={[font.small, { color: c.textFaint }]}>
          Leaving needs you settled up. Only the creator can delete.
        </Text>
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    input: {
      ...font.body,
      marginHorizontal: spacing.lg,
      padding: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      color: c.text,
    },
    hint: {
      ...font.small,
      color: c.textFaint,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    error: {
      flexDirection: 'row',
      alignItems: 'center',
      margin: spacing.lg,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: c.oweTint,
    },
  });
