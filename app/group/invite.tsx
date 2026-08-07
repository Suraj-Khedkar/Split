import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, SectionTitle } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/store/useAuth';
import { useStore } from '../../src/store/useStore';
import { Palette, font, radius, spacing, useColors } from '../../src/theme';

export default function InviteScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const groups = useStore((s) => s.groups);
  const refresh = useAuth((s) => s.refresh);

  const group = groups.find((g) => g.id === groupId);
  const [code, setCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!groupId) return;
    setBusy(true);
    setStatus('');
    try {
      const { code: fresh } = await api.createInvite(groupId);
      setCode(fresh);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not create an invite');
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setBusy(true);
    setStatus('');
    try {
      const { group: joined } = await api.join(joinCode.trim().toUpperCase());
      await refresh();
      setStatus(`Joined "${joined.name}".`);
      setJoinCode('');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not join');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Invite & join' }} />

      {group ? (
        <>
          <SectionTitle>Invite someone to {group.name}</SectionTitle>
          <Text style={styles.hint}>
            Share this code. They sign up, then enter it below to join the group.
          </Text>
          {code ? (
            <Pressable
              onPress={() => {
                void Clipboard.setStringAsync(code);
                setStatus('Code copied.');
              }}
              style={styles.codeBox}
            >
              <Text style={[font.h1, { color: c.owed, letterSpacing: 4 }]}>{code}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm }}>
                <Ionicons name="copy-outline" size={15} color={c.textMuted} />
                <Text style={[font.small, { color: c.textMuted, marginLeft: 5 }]}>
                  Tap to copy · expires in 14 days
                </Text>
              </View>
            </Pressable>
          ) : null}
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
            <Button
              title={code ? 'Generate a new code' : 'Create invite code'}
              variant={code ? 'secondary' : 'primary'}
              onPress={() => void generate()}
              loading={busy}
            />
          </View>
        </>
      ) : null}

      <SectionTitle>Join a group</SectionTitle>
      <Text style={styles.hint}>Got a code from someone else? Enter it here.</Text>
      <TextInput
        value={joinCode}
        onChangeText={setJoinCode}
        placeholder="ABCD1234"
        placeholderTextColor={c.textFaint}
        autoCapitalize="characters"
        autoCorrect={false}
        style={styles.input}
      />
      <View style={{ padding: spacing.lg }}>
        <Button
          title="Join group"
          onPress={() => void join()}
          disabled={joinCode.trim().length < 4}
          loading={busy}
        />
      </View>

      {status ? (
        <Text style={[font.small, { color: c.textMuted, paddingHorizontal: spacing.lg }]}>
          {status}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    hint: { ...font.small, color: c.textFaint, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    codeBox: {
      alignItems: 'center',
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
      paddingVertical: spacing.xl,
      backgroundColor: c.owedTint,
      borderRadius: radius.lg,
    },
    input: {
      ...font.h3,
      marginHorizontal: spacing.lg,
      padding: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      color: c.text,
      letterSpacing: 2,
    },
  });
