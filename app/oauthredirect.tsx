import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { font, spacing, useColors } from '../src/theme';

/**
 * Landing page for Google's redirect.
 *
 * expo-auth-session runs the consent screen in a popup and expects the page it
 * redirects back to hand the resulting URL to the opener. That handoff is
 * maybeCompleteAuthSession(), and it has to run on *this* route. Without a
 * real route here expo-router rendered its not-found screen instead, the
 * handoff never happened, and the popup sat on "Unmatched Route" holding an
 * authorization code nobody collected.
 *
 * Called at module scope so it fires on import, before the first render and
 * before the root layout's auth guard has a chance to navigate away.
 */
WebBrowser.maybeCompleteAuthSession();

export default function OAuthRedirect() {
  const c = useColors();
  const router = useRouter();

  useEffect(() => {
    // No opener means this was a full-page redirect rather than the popup, so
    // there is nothing to hand back. Send them home rather than leaving a page
    // that spins forever.
    if (typeof window === 'undefined' || window.opener) return;
    const timer = setTimeout(() => router.replace('/'), 1500);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <View
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}
    >
      <ActivityIndicator color={c.owed} />
      <Text style={[font.body, { color: c.textMuted, marginTop: spacing.md }]}>
        Finishing sign-in…
      </Text>
    </View>
  );
}
