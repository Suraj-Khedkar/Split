import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, SectionTitle } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/store/useAuth';
import { Palette, font, radius, spacing, useColors } from '../../src/theme';

/**
 * Connect with someone who already has an account.
 *
 * This used to take a name and store it on the device, which connected nobody
 * to anybody: the other person never heard about it, and the record never left
 * the phone. Adding by email creates a real, mutual link on the server, so you
 * appear in their friend list at the same moment they appear in yours.
 *
 * Someone with no account belongs in a group instead — Group settings has
 * "Add someone by name" for exactly that, and their history becomes claimable
 * if they ever sign up.
 */
export default function NewFriendScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const refresh = useAuth((s) => s.refresh);

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const { friend } = await api.addFriend(email.trim());
      await refresh();
      router.replace(`/friend/${friend.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that person');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Add a friend', presentation: 'modal' }} />

      <SectionTitle>Their email</SectionTitle>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="priya@example.com"
        placeholderTextColor={c.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        style={styles.input}
        autoFocus
      />
      <Text style={styles.hint}>You will each appear in the other's friend list.</Text>

      <View style={{ padding: spacing.lg }}>
        <Button
          title="Add friend"
          onPress={() => void save()}
          disabled={!email.trim().includes('@')}
          loading={busy}
        />
        {error ? (
          <View style={styles.error}>
            <Ionicons name="alert-circle-outline" size={17} color={c.danger} />
            <Text style={[font.small, { color: c.danger, marginLeft: spacing.sm, flex: 1 }]}>
              {error}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.hint}>
        No account yet? Add them to a group by name from Group settings instead.
      </Text>
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
    hint: {
      ...font.small,
      color: c.textFaint,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
    },
    error: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: c.oweTint,
    },
  });
