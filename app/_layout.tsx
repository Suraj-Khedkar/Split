import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { loadDeviceId } from '../src/lib/device';
import { readPendingInvite } from '../src/lib/invite';
import { enableNotifications } from '../src/lib/notifications';
import { useAuth } from '../src/store/useAuth';
import { useAutoSync } from '../src/store/useAutoSync';
import { useSettings } from '../src/store/useSettings';
import { useStore } from '../src/store/useStore';
import { font, spacing, useColors, useIsDark } from '../src/theme';

export function ErrorBoundary({
  error,
  retry,
}: {
  error: Error;
  retry: () => Promise<void>;
}) {
  // This screen predates the theme and used raw defaults, which meant black
  // text on the dark canvas whenever it actually appeared.
  const c = useColors();
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        padding: spacing.xl,
        gap: spacing.md,
        backgroundColor: c.bg,
      }}
    >
      <Text style={[font.h2, { color: c.text }]}>Something broke</Text>
      <Text style={[font.body, { color: c.textMuted }]}>
        {error?.message ?? 'Unknown error'}
      </Text>
      <Text
        onPress={() => void retry()}
        style={[font.bodyStrong, { color: c.owed, marginTop: spacing.sm }]}
      >
        Try again
      </Text>
    </View>
  );
}

export default function RootLayout() {
  const hydrate = useStore((s) => s.hydrate);
  const hydrated = useStore((s) => s.hydrated);
  const authStatus = useAuth((s) => s.status);
  const restore = useAuth((s) => s.restore);
  const loadSettings = useSettings((s) => s.load);
  const settingsLoaded = useSettings((s) => s.loaded);
  const segments = useSegments();
  // Pull changes made elsewhere (a friend joining, another device adding an
  // expense) without the user having to reload the page.
  useAutoSync();
  const router = useRouter();
  const c = useColors();
  const isDark = useIsDark();

  // Load the saved ledger before first paint so balances never flash wrong
  // numbers on launch.
  useEffect(() => {
    // Device id must exist before the socket connects or any mutation goes
    // out, otherwise the server cannot tell this device from the others.
    void loadDeviceId().then(async () => {
      // Strictly before restore(), which signs in and lets the first /sync
      // land. hydrate() is what loads the outbox, and a snapshot applied
      // while that queue still looks empty would erase every change made
      // offline last session — the exact rows it exists to protect.
      await hydrate();
      void restore();
    });
    void loadSettings();
  }, [hydrate, restore, loadSettings]);

  // Notifications are meant to be on unless the user turns them off, so this
  // runs as soon as there is a session to hang a subscription on. It cannot
  // run earlier: registering the subscription is an authenticated call.
  useEffect(() => {
    if (authStatus !== 'signedIn') return;
    void enableNotifications();
  }, [authStatus]);

  // Route guard. Without this the app dropped straight into the tabs, so a
  // signed-out visitor saw an empty (previously seeded) ledger and had no way
  // to reach sign-in.
  useEffect(() => {
    if (!hydrated || authStatus === 'loading') return;
    const onAuthScreen = segments[0] === 'auth';
    // oauthredirect is a transient handoff page that closes itself once it has
    // passed the authorization code back to the opener. It is deliberately
    // excluded from BOTH branches below: signed out it must not be bounced to
    // /auth before the handoff, and signed in it must not be bounced to the
    // tabs either — linking a Google account happens while already signed in,
    // and navigating away mid-handoff would drop the code.
    const onOauthRedirect = segments[0] === 'oauthredirect';
    // /join carries an invite code from a shared link. A signed-out visitor
    // must be allowed to render it, because that screen is what stores the
    // code before sending them on to sign up — redirecting from here instead
    // would throw the code away and the link would silently do nothing.
    // /verify carries the token from a confirmation email and has to render
    // for a signed-out visitor — that is the entire point of it.
    const isPublic =
      onAuthScreen || onOauthRedirect || segments[0] === 'join' || segments[0] === 'verify';

    if (authStatus === 'signedOut' && !isPublic) {
      router.replace('/auth');
    } else if (authStatus === 'signedIn' && onAuthScreen) {
      // Someone who arrived from an invite link should land in the group they
      // were invited to, not on the groups tab. Doing it here rather than in
      // the auth screen covers every route into an account at once: sign-in,
      // sign-up and Google.
      void (async () => {
        const pending = await readPendingInvite();
        router.replace(pending ? `/join/${pending}` : '/');
      })();
    }
  }, [authStatus, hydrated, segments, router]);

  if (!hydrated || !settingsLoaded || authStatus === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={c.owed} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: c.header },
            headerTitleStyle: { ...font.h3, color: c.text },
            headerTintColor: c.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: c.bg },
          }}
        >
          <Stack.Screen name="auth/index" options={{ headerShown: false }} />
          <Stack.Screen name="oauthredirect" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="group/[id]" options={{ title: '' }} />
          <Stack.Screen name="group/new" options={{ title: 'Create a group', presentation: 'modal' }} />
          <Stack.Screen name="expense/new" options={{ title: 'Add expense', presentation: 'modal' }} />
          <Stack.Screen name="expense/scan" options={{ title: 'Scan a receipt', presentation: 'modal' }} />
          <Stack.Screen name="expense/assign" options={{ title: 'Who had what?' }} />
          <Stack.Screen name="expense/[id]" options={{ title: 'Details' }} />
          <Stack.Screen name="settle/[groupId]" options={{ title: 'Settle up', presentation: 'modal' }} />
          <Stack.Screen name="friend/[id]" options={{ title: '' }} />
          <Stack.Screen name="friend/new" options={{ title: 'Add a friend', presentation: 'modal' }} />
          <Stack.Screen name="import" options={{ title: 'Import from Splitwise' }} />
          <Stack.Screen name="quick" options={{ title: 'Quick add' }} />
          <Stack.Screen name="shortcut" options={{ title: 'Back Tap to add' }} />
          <Stack.Screen name="report/me" options={{ title: 'Your spending' }} />
          <Stack.Screen name="report/personal" options={{ title: 'Personal spending' }} />
          <Stack.Screen name="report/group" options={{ title: 'Report' }} />
          <Stack.Screen name="report/friend" options={{ title: 'Report' }} />
          <Stack.Screen name="group/invite" options={{ title: 'Invite & join', presentation: 'modal' }} />
          <Stack.Screen name="join/[code]" options={{ title: 'Invite' }} />
          <Stack.Screen name="verify" options={{ title: 'Confirm email' }} />
          <Stack.Screen name="profile" options={{ title: 'Edit profile', presentation: 'modal' }} />
          <Stack.Screen name="group/members" options={{ title: 'Members' }} />
          <Stack.Screen name="group/manage" options={{ title: 'Group settings', presentation: 'modal' }} />
        </Stack>
    </SafeAreaProvider>
  );
}
