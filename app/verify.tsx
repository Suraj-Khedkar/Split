import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '../src/components/ui';
import { useAuth } from '../src/store/useAuth';
import { Palette, font, spacing, useColors } from '../src/theme';

/**
 * Landing screen for the link in a verification email.
 *
 * Confirming also signs the account in, so following the link out of an inbox
 * lands in the app rather than back at a login form with nothing to show for
 * the trip.
 */
export default function VerifyScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();

  const verifyEmail = useAuth((s) => s.verifyEmail);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  // The token is single use; a re-render must not spend it twice.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    if (!token) {
      setError('That link is missing its token.');
      return;
    }
    attempted.current = true;
    void (async () => {
      const result = await verifyEmail(token);
      if (result.ok) {
        setDone(true);
        router.replace('/');
      } else {
        setError(result.error ?? 'Could not confirm that link');
      }
    })();
  }, [token, verifyEmail, router]);

  if (error) {
    return (
      <View style={styles.wrap}>
        <Stack.Screen options={{ title: 'Confirm email' }} />
        <Ionicons name="alert-circle-outline" size={44} color={c.danger} />
        <Text style={[font.h3, { color: c.text, marginTop: spacing.md, textAlign: 'center' }]}>
          {error}
        </Text>
        <Button
          title="Back to sign in"
          onPress={() => router.replace('/auth')}
          style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
        />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Stack.Screen options={{ title: 'Confirm email' }} />
      <ActivityIndicator color={c.owed} />
      <Text style={[font.h3, { color: c.text, marginTop: spacing.lg }]}>
        {done ? 'Confirmed' : 'Confirming your address'}
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      flex: 1,
      backgroundColor: c.bg,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
    },
  });
