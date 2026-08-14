import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { clearPendingInvite, setPendingInvite } from '../../src/lib/invite';
import { useAuth } from '../../src/store/useAuth';
import { Palette, font, spacing, useColors } from '../../src/theme';

type Phase = 'checking' | 'needsAuth' | 'joining' | 'failed';

/**
 * Landing screen for a shared invite link (`/join/ABCD1234`).
 *
 * Signed in, it joins and forwards to the group. Signed out, it parks the code
 * in storage and sends the visitor to sign up; the root layout brings them back
 * here once they have an account, so the link works for someone who has never
 * used the app.
 */
export default function JoinScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();

  const { code: raw } = useLocalSearchParams<{ code?: string }>();
  const code = (raw ?? '').trim().toUpperCase();

  const status = useAuth((s) => s.status);
  const refresh = useAuth((s) => s.refresh);

  const [groupName, setGroupName] = useState('');
  const [invitedBy, setInvitedBy] = useState('');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('checking');
  // The join is not idempotent from the UI's point of view — a second call
  // while the first is in flight would show a spurious error — so it runs once.
  const attempted = useRef(false);

  // Naming the group up front is what makes a stranger willing to sign up, so
  // this runs before (and independently of) knowing who the visitor is.
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    void (async () => {
      try {
        const info = await api.inviteInfo(code);
        if (cancelled) return;
        setGroupName(info.groupName);
        setInvitedBy(info.invitedBy);
      } catch {
        // Non-fatal: the join attempt reports the real problem with better
        // wording, and a signed-out visitor still gets sent to sign up.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (!code) {
      setError('This invite link is missing its code.');
      setPhase('failed');
      return;
    }
    if (status === 'loading') return;

    if (status === 'signedOut') {
      setPhase('needsAuth');
      void (async () => {
        await setPendingInvite(code);
        router.replace('/auth');
      })();
      return;
    }

    if (attempted.current) return;
    attempted.current = true;
    setPhase('joining');
    void (async () => {
      try {
        const { group } = await api.join(code);
        await clearPendingInvite();
        await refresh();
        router.replace(`/group/${group.id}`);
      } catch (err) {
        // Clear on failure too: an expired or revoked code must not follow the
        // user into every future sign-in.
        await clearPendingInvite();
        setError(err instanceof Error ? err.message : 'Could not join that group');
        setPhase('failed');
      }
    })();
  }, [code, status, refresh, router]);

  if (phase === 'failed') {
    return (
      <View style={styles.wrap}>
        <Stack.Screen options={{ title: 'Invite' }} />
        <Ionicons name="alert-circle-outline" size={44} color={c.danger} />
        <Text style={[font.h3, { color: c.text, marginTop: spacing.md, textAlign: 'center' }]}>
          {error}
        </Text>
        <Text style={styles.hint}>
          Ask whoever invited you for a fresh link, or enter a code by hand from Invite &amp; join.
        </Text>
        <Button
          title="Go to my groups"
          onPress={() => router.replace('/')}
          style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
        />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Stack.Screen options={{ title: 'Invite' }} />
      <ActivityIndicator color={c.owed} />
      <Text style={[font.h3, { color: c.text, marginTop: spacing.lg, textAlign: 'center' }]}>
        {groupName ? `Joining "${groupName}"` : 'Checking your invite'}
      </Text>
      <Text style={styles.hint}>
        {phase === 'needsAuth'
          ? 'Sign in or create an account and we will add you to the group automatically.'
          : invitedBy
            ? `${invitedBy} invited you.`
            : 'One moment.'}
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
    hint: {
      ...font.small,
      color: c.textFaint,
      marginTop: spacing.sm,
      textAlign: 'center',
    },
  });
