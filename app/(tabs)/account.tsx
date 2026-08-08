import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { Avatar, Button, ConfirmDialog, Divider, Row, SectionTitle } from '../../src/components/ui';
import { useOverallBalance } from '../../src/store/selectors';
import { useAuth } from '../../src/store/useAuth';
import { useSettings, type ThemeMode } from '../../src/store/useSettings';
import { getLastPushError } from '../../src/store/useStore';
import { useStore } from '../../src/store/useStore';
import { font, spacing, useColors } from '../../src/theme';

export default function AccountScreen() {
  const c = useColors();
  const people = useStore((s) => s.people);
  const groups = useStore((s) => s.groups);
  const expenses = useStore((s) => s.expenses);
  const meId = useStore((s) => s.meId);
  const clearAll = useStore((s) => s.clearAll);
  const router = useRouter();
  const authUser = useAuth((s) => s.user);
  const offline = useAuth((s) => s.offline);
  const signOut = useAuth((s) => s.signOut);
  const refresh = useAuth((s) => s.refresh);
  const themeMode = useSettings((s) => s.themeMode);
  const setThemeMode = useSettings((s) => s.setThemeMode);
  const pushError = getLastPushError();
  const overall = useOverallBalance();
  const me = people.find((p) => p.id === meId);

  /** Which confirmation is open. One value, because only one can be. */
  const [confirming, setConfirming] = useState<'signOut' | 'clear' | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState('');

  const doSync = async () => {
    setSyncing(true);
    await refresh();
    setSyncing(false);
    // refresh() reports failure by setting `offline` rather than throwing, so
    // the outcome has to be read back off the store.
    setSyncedAt(useAuth.getState().offline ? '' : new Date().toLocaleTimeString());
  };

  const syncSubtitle = syncing
    ? 'Syncing…'
    : offline
    ? 'Could not reach the server — showing the last copy on this device'
    : syncedAt
    ? `Last synced at ${syncedAt}`
    : 'Pull the latest from your server';

  const doClear = async () => {
    setConfirming(null);
    await clearAll();
    await doSync();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
        <Avatar name={me?.name ?? 'You'} colorIndex={me?.colorIndex ?? 0} size={72} />
        <Text style={[font.h2, { marginTop: spacing.md }, { color: c.text }]}>{me?.name ?? 'You'}</Text>
        {authUser?.email ? (
          <Text style={[font.small, { color: c.textFaint }]}>{authUser.email}</Text>
        ) : null}
        <Text style={[font.small, { color: c.textMuted, marginTop: spacing.xs }]}>
          {overall === 0
            ? 'All settled up'
            : overall > 0
            ? 'Overall, you are owed money'
            : 'Overall, you owe money'}
        </Text>
      </View>

      {pushError ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            margin: spacing.lg,
            padding: spacing.md,
            borderRadius: 10,
            backgroundColor: c.oweTint,
          }}
        >
          <Ionicons name="cloud-offline-outline" size={18} color={c.owe} />
          <Text style={[font.small, { color: c.owe, marginLeft: spacing.sm, flex: 1 }]}>
            {pushError}
          </Text>
        </View>
      ) : null}

      <SectionTitle>Appearance</SectionTitle>
      <View style={{ flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg }}>
        {(['dark', 'light', 'system'] as ThemeMode[]).map((mode) => {
          const active = themeMode === mode;
          return (
            <Pressable
              key={mode}
              onPress={() => setThemeMode(mode)}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 999,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: active ? c.owed : c.border,
                backgroundColor: active ? c.owed : 'transparent',
              }}
            >
              <Text style={[font.small, { color: active ? c.onDark : c.text }]}>
                {mode === 'dark' ? 'Dark' : mode === 'light' ? 'Light' : 'System'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <SectionTitle>Your data</SectionTitle>
      <Row left={<Ionicons name="people-outline" size={22} color={c.textMuted} />} title="Groups" right={<Text style={[font.body, { color: c.text }]}>{groups.length}</Text>} />
      <Divider />
      <Row left={<Ionicons name="person-outline" size={22} color={c.textMuted} />} title="Friends" right={<Text style={[font.body, { color: c.text }]}>{Math.max(0, people.length - 1)}</Text>} />
      <Divider />
      <Row left={<Ionicons name="receipt-outline" size={22} color={c.textMuted} />} title="Expenses" right={<Text style={[font.body, { color: c.text }]}>{expenses.length}</Text>} />

      <SectionTitle>Reports</SectionTitle>
      <Row
        left={<Ionicons name="bar-chart-outline" size={22} color={c.owed} />}
        title="Your spending"
        subtitle="Everything you have spent, across every group"
        onPress={() => router.push('/report/me')}
        chevron
      />

      <SectionTitle>Move your data in</SectionTitle>
      <Row
        left={<Ionicons name="cloud-download-outline" size={22} color={c.owed} />}
        title="Import from Splitwise"
        subtitle="Bring across a group's full history — balances transfer exactly"
        onPress={() => router.push('/import')}
        chevron
      />

      <SectionTitle>About</SectionTitle>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <Text style={[font.small, { color: c.textMuted, lineHeight: 20 }]}>
          Your groups and expenses live on your own server and sync to every
          device you are signed in on, usually within a second. Nothing is
          stored with a third party.
        </Text>
        <Text style={[font.small, { color: c.textMuted, lineHeight: 20, marginTop: spacing.md }]}>
          Amounts are held as whole paise rather than decimals, so a bill split
          three ways always adds back up to what it started as.
        </Text>
      </View>

      <SectionTitle>Account</SectionTitle>
      <Row
        left={<Ionicons name="sync-outline" size={22} color={c.textMuted} />}
        title="Sync now"
        subtitle={syncSubtitle}
        right={syncing ? <ActivityIndicator color={c.owed} /> : undefined}
        onPress={() => void doSync()}
      />
      <Divider />
      <Row
        left={<Ionicons name="log-out-outline" size={22} color={c.danger} />}
        title="Sign out"
        onPress={() => setConfirming('signOut')}
      />

      <View style={{ padding: spacing.lg, marginTop: spacing.lg }}>
        <Button
          title="Reset local data"
          variant="danger"
          onPress={() => setConfirming('clear')}
        />
      </View>

      <ConfirmDialog
        visible={confirming === 'signOut'}
        title="Sign out?"
        message="Your data stays on the server. You can sign back in on any device."
        confirmLabel="Sign out"
        destructive
        onConfirm={() => {
          setConfirming(null);
          void signOut();
        }}
        onCancel={() => setConfirming(null)}
      />

      <ConfirmDialog
        visible={confirming === 'clear'}
        title="Reset local data?"
        message="Clears this device's copy and downloads everything again from the server. Any change that has not been pushed yet is lost."
        confirmLabel="Reset"
        destructive
        onConfirm={() => void doClear()}
        onCancel={() => setConfirming(null)}
      />
    </ScrollView>
  );
}
