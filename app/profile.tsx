import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar, Button, SectionTitle } from '../src/components/ui';
import { useAuth } from '../src/store/useAuth';
import { useStore } from '../src/store/useStore';
import { Palette, avatarColors, font, radius, spacing, useColors } from '../src/theme';

/**
 * Edit your own display name and avatar colour.
 *
 * Both are assigned for you at sign-up — Google supplies them, a password
 * signup takes the name you typed and picks a colour by account count — and
 * until now neither could be changed. The name in particular is what everyone
 * in a shared group sees on every expense you have paid for.
 */
export default function ProfileScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();

  const people = useStore((s) => s.people);
  const meId = useStore((s) => s.meId);
  const me = people.find((p) => p.id === meId);
  const authUser = useAuth((s) => s.user);
  const updateProfile = useAuth((s) => s.updateProfile);
  const busy = useAuth((s) => s.busy);

  // The people list is the same data the rest of the UI renders from; the auth
  // user is the fallback for an account too new to have synced yet.
  const [name, setName] = useState(me?.name ?? authUser?.name ?? '');
  const [colorIndex, setColorIndex] = useState(me?.colorIndex ?? authUser?.colorIndex ?? 0);
  const [error, setError] = useState('');

  const trimmed = name.trim();
  const dirty = trimmed !== (me?.name ?? '') || colorIndex !== (me?.colorIndex ?? 0);

  const save = async () => {
    setError('');
    const result = await updateProfile(trimmed, colorIndex);
    if (!result.ok) {
      setError(result.error ?? 'Could not save your profile');
      return;
    }
    router.back();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Edit profile' }} />

      <View style={styles.preview}>
        <Avatar name={trimmed || 'You'} colorIndex={colorIndex} size={84} />
        <Text style={[font.small, { color: c.textFaint, marginTop: spacing.sm }]}>
          {authUser?.email || 'Your account'}
        </Text>
      </View>

      <SectionTitle>Name</SectionTitle>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        placeholderTextColor={c.textFaint}
        autoCapitalize="words"
        maxLength={60}
        style={styles.input}
      />

      <SectionTitle>Avatar colour</SectionTitle>
      <View style={styles.swatches}>
        {avatarColors.map((colour, index) => {
          const active = index === colorIndex;
          return (
            <Pressable
              key={colour}
              onPress={() => setColorIndex(index)}
              accessibilityRole="button"
              accessibilityLabel={`Avatar colour ${index + 1}`}
              style={[
                styles.swatch,
                { backgroundColor: colour, borderColor: active ? c.text : 'transparent' },
              ]}
            >
              {active ? <Ionicons name="checkmark" size={20} color="#FFFFFF" /> : null}
            </Pressable>
          );
        })}
      </View>

      <View style={{ padding: spacing.lg }}>
        <Button
          title="Save"
          onPress={() => void save()}
          disabled={!trimmed || !dirty}
          loading={busy}
        />
        {error ? (
          <Text style={[font.small, { color: c.danger, marginTop: spacing.sm }]}>{error}</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    preview: { alignItems: 'center', paddingVertical: spacing.xl },
    input: {
      ...font.body,
      marginHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      color: c.text,
    },
    swatches: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    swatch: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
    },
  });
