import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { loadDeviceId } from '../src/lib/device';
import { useAuth } from '../src/store/useAuth';
import { useAutoSync } from '../src/store/useAutoSync';
import { useSettings } from '../src/store/useSettings';
import { useStore } from '../src/store/useStore';
import { font, useColors, useIsDark } from '../src/theme';

export function ErrorBoundary({
  error,
  retry,
}: {
  error: Error;
  retry: () => Promise<void>;
}) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>Something broke</Text>
      <Text style={{ opacity: 0.7 }}>{error?.message ?? 'Unknown error'}</Text>
      <Text
        onPress={() => void retry()}
        style={{ color: '#1CC29F', fontWeight: '700', marginTop: 8 }}
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
    void loadDeviceId().then(() => {
      void hydrate();
      void restore();
    });
    void loadSettings();
  }, [hydrate, restore, loadSettings]);

  // Route guard. Without this the app dropped straight into the tabs, so a
  // signed-out visitor saw an empty (previously seeded) ledger and had no way
  // to reach sign-in.
  useEffect(() => {
    if (!hydrated || authStatus === 'loading') return;
    // oauthredirect is part of signing in: the guard must not bounce it to
    // /auth before it has handed the authorization code back to the opener.
    const inAuth = segments[0] === 'auth' || segments[0] === 'oauthredirect';
    if (authStatus === 'signedOut' && !inAuth) router.replace('/auth');
    else if (authStatus === 'signedIn' && inAuth) router.replace('/');
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
          <Stack.Screen name="expense/[id]" options={{ title: 'Details' }} />
          <Stack.Screen name="settle/[groupId]" options={{ title: 'Settle up', presentation: 'modal' }} />
          <Stack.Screen name="friend/[id]" options={{ title: '' }} />
          <Stack.Screen name="friend/new" options={{ title: 'Add a friend', presentation: 'modal' }} />
          <Stack.Screen name="import" options={{ title: 'Import from Splitwise' }} />
          <Stack.Screen name="report/me" options={{ title: 'Your spending' }} />
          <Stack.Screen name="report/group" options={{ title: 'Report' }} />
          <Stack.Screen name="report/friend" options={{ title: 'Report' }} />
          <Stack.Screen name="group/invite" options={{ title: 'Invite & join', presentation: 'modal' }} />
          <Stack.Screen name="group/manage" options={{ title: 'Group settings', presentation: 'modal' }} />
        </Stack>
    </SafeAreaProvider>
  );
}
