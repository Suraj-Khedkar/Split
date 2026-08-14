import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useGoogleSignIn } from '../../src/lib/googleAuth';
import { useAuth } from '../../src/store/useAuth';
import { Palette, font, radius, spacing, useColors } from '../../src/theme';

export default function AuthScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  // This is the one route with no navigation header, so nothing else is
  // holding the content clear of the notch and the home indicator.
  const insets = useSafeAreaInsets();

  const signIn = useAuth((s) => s.signIn);
  const signUp = useAuth((s) => s.signUp);
  const busy = useAuth((s) => s.busy);
  const error = useAuth((s) => s.error);
  const clearError = useAuth((s) => s.clearError);
  const signInWithGoogle = useAuth((s) => s.signInWithGoogle);

  const google = useGoogleSignIn(
    useCallback((result) => void signInWithGoogle(result), [signInWithGoogle])
  );

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [sent, setSent] = useState(false);
  const [resending, setResending] = useState(false);

  const isSignup = mode === 'signup';
  const canSubmit =
    email.trim().includes('@') &&
    password.length >= 8 &&
    (!isSignup || name.trim().length > 0);

  const submit = async () => {
    if (!isSignup) {
      // On success the root guard performs the redirect; navigating here as
      // well raced it and could land on a route that does not exist.
      await signIn(email.trim(), password);
      return;
    }
    // Signing up no longer signs you in — the address has to be confirmed
    // first — so this screen has to say what happens next itself.
    if (await signUp(email.trim(), name.trim(), password)) setSent(true);
  };

  const resend = async () => {
    setResending(true);
    try {
      await api.resendVerification(email.trim());
    } catch {
      // The endpoint answers the same way regardless; nothing to report.
    } finally {
      setResending(false);
    }
  };

  const swap = (next: 'signin' | 'signup') => {
    clearError();
    setMode(next);
  };

  const shell = (children: React.ReactNode) => (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.wrap,
          { paddingTop: spacing.xl + insets.top, paddingBottom: spacing.xl + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logo}>
          <Ionicons name="wallet" size={34} color={c.onDark} />
        </View>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );

  if (sent) {
    return shell(
      <>
        <Text style={[font.h1, { color: c.text, marginTop: spacing.lg }]}>Check your email</Text>
        <Text
          style={[font.body, { color: c.textMuted, marginTop: spacing.md, textAlign: 'center' }]}
        >
          We sent a confirmation link to {email.trim()}. Open it to finish setting up your
          account.
        </Text>
        <Button
          title={resending ? 'Sending…' : 'Send it again'}
          variant="secondary"
          onPress={() => void resend()}
          disabled={resending}
          style={{ marginTop: spacing.xl, alignSelf: 'stretch' }}
        />
        <Text
          onPress={() => {
            setSent(false);
            setMode('signin');
          }}
          style={[font.small, { color: c.owed, marginTop: spacing.lg }]}
        >
          Back to sign in
        </Text>
      </>
    );
  }

  return shell(
    <>
      <Text style={[font.h1, { color: c.text, marginTop: spacing.lg }]}>Split &amp; Track</Text>
      <Text style={[font.body, { color: c.textMuted, marginTop: spacing.xs, textAlign: 'center' }]}>
        {isSignup
          ? 'Create an account to share groups with friends.'
          : 'Sign in to get back to your groups.'}
      </Text>

      {google.available ? (
        <>
          <Pressable
            onPress={() => void google.promptAsync()}
            disabled={busy}
            style={({ pressed }) => [styles.googleButton, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Ionicons name="logo-google" size={18} color={c.text} />
            <Text style={[font.bodyStrong, { color: c.text, marginLeft: spacing.sm }]}>
              Continue with Google
            </Text>
          </Pressable>
          <View style={styles.orRow}>
            <View style={styles.orLine} />
            <Text style={[font.small, { color: c.textFaint, marginHorizontal: spacing.md }]}>or</Text>
            <View style={styles.orLine} />
          </View>
        </>
      ) : null}

      {google.error ? (
        <View style={styles.error}>
          <Ionicons name="alert-circle-outline" size={17} color={c.danger} />
          <Text style={[font.small, { color: c.danger, marginLeft: spacing.sm, flex: 1 }]}>
            {google.error}
          </Text>
        </View>
      ) : null}

      <View style={styles.tabs}>
        {(['signin', 'signup'] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => swap(m)}
            style={[styles.tab, mode === m && { backgroundColor: c.owed }]}
          >
            <Text style={[font.bodyStrong, { color: mode === m ? c.onDark : c.textMuted }]}>
              {m === 'signin' ? 'Sign in' : 'Sign up'}
            </Text>
          </Pressable>
        ))}
      </View>

      {isSignup ? (
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={c.textFaint}
          autoCapitalize="words"
          style={styles.input}
        />
      ) : null}

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        placeholderTextColor={c.textFaint}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        style={styles.input}
      />

      <View style={styles.passwordRow}>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={c.textFaint}
          autoCapitalize="none"
          secureTextEntry={!showPassword}
          style={[styles.input, { flex: 1, marginBottom: 0 }]}
        />
        <Pressable
            onPress={() => setShowPassword((v) => !v)}
            style={({ pressed }) => [styles.eye, pressed && { opacity: 0.5 }]}
          >
          <Ionicons
            name={showPassword ? 'eye-off-outline' : 'eye-outline'}
            size={20}
            color={c.textMuted}
          />
        </Pressable>
      </View>

      {isSignup ? (
        <Text style={[font.small, { color: c.textFaint, marginTop: spacing.xs }]}>
          At least 8 characters.
        </Text>
      ) : null}

      {error ? (
        <View style={styles.error}>
          <Ionicons name="alert-circle-outline" size={17} color={c.danger} />
          <Text style={[font.small, { color: c.danger, marginLeft: spacing.sm, flex: 1 }]}>
            {error}
          </Text>
        </View>
      ) : null}

      <Button
        title={isSignup ? 'Create account' : 'Sign in'}
        onPress={submit}
        disabled={!canSubmit}
        loading={busy}
        style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
      />

      <Text style={[font.small, { color: c.textFaint, marginTop: spacing.xl, textAlign: 'center' }]}>
        Your data is stored on your own server, not a third party.
      </Text>
    </>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      flexGrow: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.xl,
    },
    logo: {
      width: 68,
      height: 68,
      borderRadius: 20,
      backgroundColor: c.owed,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabs: {
      flexDirection: 'row',
      backgroundColor: c.surface,
      borderRadius: radius.pill,
      padding: 4,
      marginBottom: spacing.xl,
      alignSelf: 'stretch',
    },
    googleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'stretch',
      marginTop: spacing.xl,
      paddingVertical: 14,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    orRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'stretch',
      marginVertical: spacing.lg,
    },
    orLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.border },
    tab: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: radius.pill,
      alignItems: 'center',
    },
    input: {
      ...font.body,
      alignSelf: 'stretch',
      backgroundColor: c.surface,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 14,
      color: c.text,
      marginBottom: spacing.md,
    },
    passwordRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
    eye: { padding: spacing.md, marginLeft: -48 },
    error: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'stretch',
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: c.oweTint,
    },
  });
