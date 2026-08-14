import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar, Button, Divider, SectionTitle } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/store/useAuth';
import { useStore } from '../../src/store/useStore';
import { Palette, font, radius, spacing, useColors } from '../../src/theme';
import type { GroupType } from '../../src/types';

const TYPES: { key: GroupType; label: string; icon: string }[] = [
  { key: 'trip', label: 'Trip', icon: 'airplane' },
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'couple', label: 'Couple', icon: 'heart' },
  { key: 'other', label: 'Other', icon: 'people' },
];

export default function NewGroupScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const people = useStore((s) => s.people);
  const meId = useStore((s) => s.meId);
  const addGroup = useStore((s) => s.addGroup);
  const refresh = useAuth((s) => s.refresh);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [type, setType] = useState<GroupType>('trip');
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      // Create server-side first: a group only becomes shareable once it has
      // an id the invite endpoint recognises.
      const { group } = await api.createGroup(name.trim(), type, 'INR');
      await refresh();
      // Hand back a shareable link straight away. A new group exists in order
      // to have people in it, and leaving the invite a screen away meant most
      // groups never got shared at all.
      try {
        const { code } = await api.createInvite(group.id);
        router.replace(`/group/invite?groupId=${group.id}&code=${code}&created=1`);
      } catch {
        // The group is real even if minting the code failed; the invite screen
        // retries on its own when it opens.
        router.replace(`/group/invite?groupId=${group.id}&created=1`);
      }
    } catch (err) {
      // Offline: fall back to a local group so the app still works.
      const local = addGroup(name, type, selected);
      setError(err instanceof Error ? err.message : 'Created locally only');
      router.replace(`/group/${local.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }}>
      <SectionTitle>Group name</SectionTitle>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Goa Trip"
        placeholderTextColor={c.textFaint}
        style={styles.input}
        autoFocus
      />

      <SectionTitle>Type</SectionTitle>
      <View style={styles.types}>
        {TYPES.map((item) => {
          const active = type === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setType(item.key)}
              style={[styles.typeChip, active && styles.typeChipActive]}
            >
              <Ionicons
                name={item.icon as never}
                size={18}
                color={active ? c.onDark : c.textMuted}
              />
              <Text style={[font.small, { marginLeft: 6, color: active ? c.onDark : c.text }]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <SectionTitle>Members</SectionTitle>
      <Text style={styles.hint}>You are always included.</Text>
      {people
        .filter((p) => p.id !== meId)
        .map((person, index, arr) => {
          const active = selected.includes(person.id);
          return (
            <View key={person.id}>
              <Pressable onPress={() => toggle(person.id)} style={styles.memberRow}>
                <Avatar name={person.name} colorIndex={person.colorIndex} size={36} />
                <Text style={[font.bodyStrong, { flex: 1, marginLeft: spacing.md }, { color: c.text }]}>
                  {person.name}
                </Text>
                <Ionicons
                  name={active ? 'checkmark-circle' : 'ellipse-outline'}
                  size={24}
                  color={active ? c.owed : c.border}
                />
              </Pressable>
              {index < arr.length - 1 ? <Divider /> : null}
            </View>
          );
        })}

      <View style={{ padding: spacing.lg }}>
        <Button
          title="Create group"
          onPress={() => void create()}
          disabled={!name.trim()}
          loading={busy}
        />
        {error ? (
          <Text style={[font.small, { color: c.owe, marginTop: spacing.sm }]}>{error}</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  input: {
    ...font.body,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: c.surface,
    borderRadius: radius.md,
    color: c.text,
  },
  types: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.border,
  },
  typeChipActive: { backgroundColor: c.owed, borderColor: c.owed },
  hint: { ...font.small, color: c.textFaint, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
});
