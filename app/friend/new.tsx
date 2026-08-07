import { Stack, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button, SectionTitle } from '../../src/components/ui';
import { useStore } from '../../src/store/useStore';
import { Palette, font, radius, spacing, useColors } from '../../src/theme';

export default function NewFriendScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const addPerson = useStore((s) => s.addPerson);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const save = () => {
    addPerson(name, email);
    router.back();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: 'Add a friend', presentation: 'modal' }} />
      <SectionTitle>Name</SectionTitle>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Priya"
        placeholderTextColor={c.textFaint}
        style={styles.input}
        autoFocus
      />
      <SectionTitle>Email (optional)</SectionTitle>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="priya@example.com"
        placeholderTextColor={c.textFaint}
        autoCapitalize="none"
        keyboardType="email-address"
        style={styles.input}
      />
      <View style={{ padding: spacing.lg }}>
        <Button title="Add friend" onPress={save} disabled={!name.trim()} />
      </View>
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
});
