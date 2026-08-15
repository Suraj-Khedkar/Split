import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { Avatar, Button, ConfirmDialog, Divider, Row, SectionTitle } from '../../src/components/ui';
import { useGoogleSignIn } from '../../src/lib/googleAuth';
import {
  disableNotifications,
  enableNotifications,
  notificationState,
  notificationsSupported,
  type NotificationState,
} from '../../src/lib/notifications';
import { usePersonalExpenses, useOverallBalance, useSharedGroups } from '../../src/store/selectors';
import { useAuth } from '../../src/store/useAuth';
import { useSettings, type ThemeMode } from '../../src/store/useSettings';
import { getLastPushError } from '../../src/store/useStore';
import { useStore } from '../../src/store/useStore';
import { font, spacing, useColors } from '../../src/theme';

export default function AccountScreen() {
  const c = useColors();
  const people = useStore((s) => s.people);
  // Shared only: the personal ledger has a count of its own below, and folding
  // it into "Groups" makes that number disagree with the Groups tab.
  const groups = useSharedGroups();
  const personalExpenses = usePersonalExpenses();
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

  const [notifications, setNotifications] = useState<NotificationState>('unsupported');
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyError, setNotifyError] = useState('');

  const hasGoogle = useAuth((s) => s.hasGoogle);
  const hasPassword = useAuth((s) => s.hasPassword);
  const linkGoogle = useAuth((s) => s.linkGoogle);
  const unlinkGoogle = useAuth((s) => s.unlinkGoogle);
  const [linkMessage, setLinkMessage] = useState('');

  // Same PKCE flow as the sign-in screen, pointed at the link endpoint: this
  // one attaches the Google account to the session already signed in rather
  // than signing in as whoever the Google account belongs to.
  const google = useGoogleSignIn(
    useCallback(
      (result) => {
        void (async () => {
          const outcome = await linkGoogle(result);
          setLinkMessage(
            outcome.ok ? 'Google account linked.' : outcome.error ?? 'Could not link that account'
          );
        })();
      },
      [linkGoogle]
    )
  );

  const doUnlinkGoogle = async () => {
    const outcome = await unlinkGoogle();
    setLinkMessage(outcome.ok ? 'Google account unlinked.' : outcome.error ?? 'Could not unlink');
  };

  const googleSubtitle = hasGoogle
    ? hasPassword
      ? 'Google or password'
      : 'The only way into this account'
    : google.available
      ? 'Sign in with Google too'
      : 'Not configured';

  // Read the real browser state on mount: the permission and the subscription
  // both outlive the app, so trusting a remembered flag would show a switch
  // that disagrees with what the browser is actually doing.
  useEffect(() => {
    void notificationState().then(setNotifications);
  }, []);

  const toggleNotifications = async (next: boolean) => {
    setNotifyBusy(true);
    setNotifyError('');
    try {
      setNotifications(next ? await enableNotifications() : await disableNotifications());
    } catch (err) {
      setNotifyError(err instanceof Error ? err.message : 'Could not change that');
      setNotifications(await notificationState());
    } finally {
      setNotifyBusy(false);
    }
  };

  const notifySubtitle =
    notifications === 'unsupported'
      ? 'Not available on this device'
      : notifications === 'denied'
      ? 'Blocked in your system settings'
      : notifications === 'on'
      ? 'On'
      : 'When someone adds an expense';

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
    ? 'Offline — showing the last copy'
    : syncedAt
    ? `Last synced ${syncedAt}`
    : 'Pull the latest';

  const doClear = async () => {
    setConfirming(null);
    await clearAll();
    await doSync();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
        {/* The avatar is where people reach for this, ahead of any row below. */}
        <Pressable
          onPress={() => router.push('/profile')}
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
        >
          <Avatar name={me?.name ?? 'You'} colorIndex={me?.colorIndex ?? 0} size={72} />
        </Pressable>
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

      <SectionTitle>Account</SectionTitle>
      <Row
        left={<Ionicons name="person-circle-outline" size={22} color={c.textMuted} />}
        title="Edit profile"
        subtitle="Name and avatar"
        onPress={() => router.push('/profile')}
        chevron
      />
      <Divider />
      <Row
        left={
          <Ionicons name="logo-google" size={20} color={hasGoogle ? c.owed : c.textMuted} />
        }
        title={hasGoogle ? 'Google linked' : 'Link Google account'}
        subtitle={googleSubtitle}
        // Unlinking is only offered when a password exists to fall back on;
        // the server refuses it otherwise, and offering it would be a trap.
        onPress={
          hasGoogle
            ? hasPassword
              ? () => void doUnlinkGoogle()
              : undefined
            : google.available
              ? () => void google.promptAsync()
              : undefined
        }
        right={
          hasGoogle && hasPassword ? (
            <Text style={[font.small, { color: c.danger }]}>Unlink</Text>
          ) : hasGoogle ? (
            <Ionicons name="checkmark-circle" size={20} color={c.owed} />
          ) : null
        }
      />
      {linkMessage || google.error ? (
        <Text style={[font.small, { color: c.textMuted, paddingHorizontal: spacing.lg, paddingTop: spacing.sm }]}>
          {linkMessage || google.error}
        </Text>
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

      {/* Only where Web Push exists. The native build has no service worker
          and no PushManager, so this control could never do anything there —
          showing a permanently disabled switch just invited the question of
          why it does not work. Android alerts need FCM, which is a different
          mechanism entirely and is not wired up yet. */}
      {notificationsSupported() ? (
        <>
      <SectionTitle>Notifications</SectionTitle>
      <Row
        left={
          <Ionicons
            name={notifications === 'on' ? 'notifications' : 'notifications-outline'}
            size={22}
            color={notifications === 'on' ? c.owed : c.textMuted}
          />
        }
        title="New expense alerts"
        subtitle={notifySubtitle}
        right={
          notifyBusy ? (
            <ActivityIndicator color={c.owed} />
          ) : (
            <Switch
              value={notifications === 'on'}
              disabled={notifications === 'unsupported' || notifications === 'denied'}
              onValueChange={(next) => void toggleNotifications(next)}
              trackColor={{ true: c.owed, false: c.border }}
            />
          )
        }
      />
      {notifyError ? (
        <Text style={[font.small, { color: c.danger, paddingHorizontal: spacing.lg }]}>
          {notifyError}
        </Text>
      ) : null}
        </>
      ) : null}

      <SectionTitle>Your data</SectionTitle>
      <Row left={<Ionicons name="people-outline" size={22} color={c.textMuted} />} title="Groups" right={<Text style={[font.body, { color: c.text }]}>{groups.length}</Text>} />
      <Divider />
      <Row left={<Ionicons name="person-outline" size={22} color={c.textMuted} />} title="Friends" right={<Text style={[font.body, { color: c.text }]}>{Math.max(0, people.length - 1)}</Text>} />
      <Divider />
      <Row left={<Ionicons name="receipt-outline" size={22} color={c.textMuted} />} title="Expenses" right={<Text style={[font.body, { color: c.text }]}>{expenses.length}</Text>} />
      <Divider />
      <Row left={<Ionicons name="wallet-outline" size={22} color={c.textMuted} />} title="Personal" right={<Text style={[font.body, { color: c.text }]}>{personalExpenses.length}</Text>} />

      <SectionTitle>Reports</SectionTitle>
      <Row
        left={<Ionicons name="bar-chart-outline" size={22} color={c.owed} />}
        title="Your spending"
        subtitle="Everything you have spent, groups and personal together"
        onPress={() => router.push('/report/me')}
        chevron
      />
      <Divider />
      <Row
        left={<Ionicons name="wallet-outline" size={22} color={c.owed} />}
        title="Personal spending"
        subtitle="Only the expenses that are yours alone"
        onPress={() => router.push('/report/personal')}
        chevron
      />

      <Divider />
      <Row
        left={<Ionicons name="phone-portrait-outline" size={22} color={c.owed} />}
        title="Back Tap to add"
        subtitle="Double-tap your iPhone to log an expense"
        onPress={() => router.push('/shortcut')}
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
