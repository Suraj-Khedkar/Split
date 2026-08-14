import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../src/components/ui';
import { api } from '../src/lib/api';
import { useAuth } from '../src/store/useAuth';
import { Palette, font, radius, spacing, useColors } from '../src/theme';

/**
 * One-field expense entry, for Back Tap.
 *
 * Deliberately not the full add-expense form: the point of a back tap is that
 * you are holding a receipt and want the number recorded before you forget it.
 * Payer, split and group are filled in by the server, and anything that needs
 * correcting can be corrected later in the app.
 */
export default function QuickAddScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const refresh = useAuth((s) => s.refresh);

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const amountRef = useRef<TextInput>(null);

  const save = async () => {
    if (!amount.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const { message } = await api.quickAdd({ amount, description: description.trim() });
      setSaved(message);
      setAmount('');
      setDescription('');
      // Pull the new expense into the local ledger so the rest of the app is
      // right the moment you navigate away.
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
    }
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ title: 'Quick add' }} />
      <View style={[styles.wrap, { paddingBottom: spacing.xl + insets.bottom }]}>
        <Text style={[font.small, { color: c.textMuted }]}>Amount</Text>
        <TextInput
          ref={amountRef}
          value={amount}
          onChangeText={(v) => {
            setAmount(v.replace(/[^0-9.]/g, ''));
            setSaved('');
          }}
          placeholder="0"
          placeholderTextColor={c.textFaint}
          keyboardType="decimal-pad"
          autoFocus
          onSubmitEditing={() => void save()}
          style={styles.amount}
        />

        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="What for? (optional)"
          placeholderTextColor={c.textFaint}
          returnKeyType="done"
          onSubmitEditing={() => void save()}
          style={styles.input}
        />

        {error ? (
          <View style={styles.notice}>
            <Ionicons name="alert-circle-outline" size={17} color={c.danger} />
            <Text style={[font.small, { color: c.danger, marginLeft: spacing.sm, flex: 1 }]}>
              {error}
            </Text>
          </View>
        ) : null}

        {saved ? (
          <View style={[styles.notice, { backgroundColor: c.owedTint }]}>
            <Ionicons name="checkmark-circle" size={17} color={c.owed} />
            <Text style={[font.small, { color: c.owed, marginLeft: spacing.sm, flex: 1 }]}>
              {saved}
            </Text>
          </View>
        ) : null}

        <Button
          title={saved ? 'Add another' : 'Save'}
          onPress={() => (saved ? amountRef.current?.focus() : void save())}
          disabled={!saved && !amount.trim()}
          loading={busy}
          style={{ marginTop: spacing.xl, alignSelf: 'stretch' }}
        />

        <Pressable
          onPress={() => router.replace('/')}
          style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
        >
          <Text style={[font.small, { color: c.textMuted }]}>
            {saved ? 'Done' : 'Open the full app'}
          </Text>
        </Pressable>

        <Text style={[font.small, { color: c.textFaint, textAlign: 'center', marginTop: spacing.md }]}>
          Goes to the group you used last, split equally, paid by you.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { flex: 1, justifyContent: 'center', padding: spacing.xl },
    amount: {
      ...font.h1,
      fontSize: 44,
      color: c.text,
      borderBottomWidth: 2,
      borderBottomColor: c.border,
      paddingVertical: spacing.sm,
      marginBottom: spacing.xl,
      outlineStyle: 'none',
    } as never,
    input: {
      ...font.body,
      color: c.text,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 14,
      outlineStyle: 'none',
    } as never,
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.lg,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: c.oweTint,
    },
    link: { alignSelf: 'center', padding: spacing.md, marginTop: spacing.sm },
  });
