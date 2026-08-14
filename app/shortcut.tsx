import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Stack } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, SectionTitle } from '../src/components/ui';
import { API_BASE } from '../src/lib/api';
import { api } from '../src/lib/api';
import { Palette, font, radius, spacing, useColors } from '../src/theme';

/** Absolute, because a Shortcut has no origin to resolve a relative path against. */
const PUBLIC_BASE = 'https://pinaka.tail2f85bc.ts.net:10000/api';

/** One action: open the app's own quick-add screen. */
const FORM_STEPS = [
  'Shortcuts app → new shortcut → add "Open URLs".',
  'Paste the URL below into it.',
  'Name it, then Settings → Accessibility → Touch → Back Tap → Double Tap → pick it.',
];

/** Two actions: type the amount in the Shortcuts prompt, never leave the app you are in. */
const SILENT_STEPS = [
  'Shortcuts app → new shortcut → add "Ask for Input", type Number, prompt "Amount".',
  'Add "Get Contents of URL" and paste the URL below. Leave the method as GET.',
  'Drag the "Provided Input" variable onto the word AMOUNT at the end of the URL.',
  'Add "Show Result" if you want the confirmation.',
  'Name it, then Settings → Accessibility → Touch → Back Tap → Double Tap → pick it.',
];

/**
 * Signing the generated file so iOS will accept it.
 *
 * iOS 15 removed unsigned shortcut import outright, together with the old
 * "Allow Untrusted Shortcuts" setting — the phone now answers "importing
 * unsigned shortcut file is not supported" and offers nothing. Apple's
 * `shortcuts sign` on macOS is the only way to produce a file it will take,
 * so a Mac has to be in the loop once. Without one, build it by hand instead:
 * a shortcut you assemble on the phone is never imported and never checked.
 */
const IMPORT_STEPS = [
  'On a Mac, run:  shortcuts sign --mode anyone --input in.shortcut --output out.shortcut',
  'scripts/sign-shortcut.sh in this repo does the download and signing in one go.',
  'AirDrop the signed file to the iPhone and tap it — Shortcuts imports it normally.',
  'Settings → Accessibility → Touch → Back Tap → Double Tap → pick it.',
];

/**
 * The full prompt-for-everything recipe.
 *
 * The group and category lists are fetched when it runs rather than typed in,
 * so a group made today is offered without editing the Shortcut. "Set Variable"
 * after each prompt is not optional busywork: every "Ask for Input" produces a
 * variable called "Provided Input", and three of them in one JSON body is the
 * step people get wrong.
 */
const FULL_STEPS: { text: string; detail?: string }[] = [
  { text: 'Shortcuts → + → Add Action. Search "Get Contents of URL" and paste the OPTIONS url below. Leave it as GET.' },
  { text: 'Add "Get Dictionary Value".', detail: 'Get "Value" for key  groups  in  Contents of URL' },
  { text: 'Add "Choose from List". Set Prompt to "Where?".', detail: 'It picks up the previous action automatically' },
  { text: 'Add "Set Variable" → name it  Group' },
  {
    text: 'Add "Get Dictionary Value" again — key  categories .',
    detail:
      'Important: its input will have auto-filled with the previous action. Tap it and pick Contents of URL again, or you will be reading the key out of your own answer.',
  },
  { text: 'Add "Choose from List". Prompt "Category?".' },
  { text: 'Add "Set Variable" → name it  Category' },
  { text: 'Add "Ask for Input" → Number, prompt "Amount". Then "Set Variable" → Amount' },
  { text: 'Add "Ask for Input" → Text, prompt "What was it for?". Then "Set Variable" → Desc' },
  { text: 'Add "Ask for Input" → Text, prompt "Note (optional)". Then "Set Variable" → Note' },
  {
    text: 'Add "Get Contents of URL" with the ADD url below. Set Method to POST, Request Body to JSON, and add six text fields:',
    detail: 'token = your token · amount = Amount · group = Group · category = Category · description = Desc · note = Note',
  },
  { text: 'Add "Get Dictionary Value" → key  message , then "Show Result" of it.' },
  { text: 'Name it, then Settings → Accessibility → Touch → Back Tap → Double Tap → pick it.' },
];

export default function ShortcutScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  // The generated file is the path that works; the steps are the fallback for
  // when iOS refuses an unsigned import, so they start folded away.
  const [showSteps, setShowSteps] = useState(false);

  const formUrl = PUBLIC_BASE.replace(/\/api$/, '') + '/quick';
  const silentUrl = token
    ? `${PUBLIC_BASE}/quick-add?token=${encodeURIComponent(token)}&amount=AMOUNT`
    : '';
  const optionsUrl = token
    ? `${PUBLIC_BASE}/quick-add/options?token=${encodeURIComponent(token)}`
    : '';

  /**
   * Absolute, and public, because the Shortcuts app fetches it itself — a
   * relative URL or a loopback one means nothing outside this browser.
   */
  const fullFileUrl = token
    ? `${PUBLIC_BASE}/shortcut/full.shortcut?token=${encodeURIComponent(token)}`
    : '';

  /**
   * Safari sometimes hands the file to Shortcuts directly when it is not
   * marked as an attachment, skipping the trip through Files. Offered as an
   * alternative rather than the default, because when Safari does not
   * recognise the type it renders the plist as text instead.
   *
   * Note there is deliberately no shortcuts://import-shortcut link here: that
   * scheme only accepts iCloud-hosted shortcuts and rejects a self-hosted URL
   * outright, which surfaces as "the shortcut URL provided was invalid".
   */
  const inlineFileUrl = fullFileUrl ? `${fullFileUrl}&inline=1` : '';

  /** The amount-only build, imported through the same Safari route. */
  const simpleFileUrl = token
    ? `${PUBLIC_BASE}/shortcut.shortcut?token=${encodeURIComponent(token)}`
    : '';
  // No query string: the full recipe POSTs a JSON body, which is what keeps a
  // note containing a space or an ampersand from truncating the request.
  const addUrl = `${PUBLIC_BASE}/quick-add`;

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const { token: fresh } = await api.createApiToken();
      setToken(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a token');
    }
    setBusy(false);
  };

  const copy = async (value: string, what: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(what);
    setTimeout(() => setCopied(''), 1500);
  };

  const CopyRow = ({ label, value, secret }: { label: string; value: string; secret?: boolean }) => (
    <Pressable
      onPress={() => void copy(value, label)}
      android_ripple={{ color: c.pressed }}
      style={({ pressed }) => [styles.copyBox, pressed && { backgroundColor: c.pressed }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[font.small, { color: c.textFaint }]}>{label}</Text>
        <Text style={[font.small, { color: c.text, marginTop: 2 }]} selectable>
          {secret ? `${value.slice(0, 10)}…${value.slice(-6)}` : value}
        </Text>
      </View>
      <Ionicons
        name={copied === label ? 'checkmark' : 'copy-outline'}
        size={18}
        color={copied === label ? c.owed : c.textMuted}
      />
    </Pressable>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
      <Stack.Screen options={{ title: 'Back Tap to add' }} />

      <View style={{ padding: spacing.lg }}>
        <Text style={[font.body, { color: c.textMuted, lineHeight: 22 }]}>
          Double-tap the back of your iPhone to log an expense without opening
          anything. The full version below asks where it goes, the category, the
          amount and a note; the shorter ones just take an amount and file it in
          your most recently used group — split equally, paid by you.
        </Text>
        <Text style={[font.small, { color: c.textFaint, lineHeight: 20, marginTop: spacing.md }]}>
          This uses Apple Shortcuts, so it works on the installed web app with no
          App Store build. Needs iPhone 8 or newer. iOS will not let an app
          install a Shortcut for you, so the last step is always yours — but
          the import below is as close as it gets.
        </Text>
      </View>

      <SectionTitle>Full version — asks for everything</SectionTitle>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <Text style={[font.small, { color: c.textFaint, lineHeight: 20, marginBottom: spacing.md }]}>
          Prompts for where it goes (Personal or any group), the category, the
          amount, what it was for, and an optional note — then saves it without
          opening the app. The group and category lists are fetched when it
          runs, so a group you make tomorrow is already in the list.
        </Text>
        {token ? (
          <>
            <View style={styles.warning}>
              <Ionicons name="warning-outline" size={16} color={c.owe} />
              <Text style={[font.small, { color: c.owe, marginLeft: spacing.sm, flex: 1, lineHeight: 20 }]}>
                iOS 15 and later refuse to import an unsigned shortcut, and the
                old "Allow Untrusted Shortcuts" setting is gone. The file below
                needs signing on a Mac first — or build it by hand, which needs
                no import at all.
              </Text>
            </View>

            <Pressable
              onPress={() => setShowSteps((v) => !v)}
              style={{ paddingVertical: spacing.md }}
            >
              <Text style={[font.small, { color: c.owed }]}>
                {showSteps
                  ? 'Hide the build-by-hand steps'
                  : 'Build it by hand — no Mac needed, works today'}
              </Text>
            </Pressable>

            {showSteps ? (
              <>
                <CopyRow label="OPTIONS url (step 1)" value={optionsUrl} secret />
                <View style={{ height: spacing.sm }} />
                <CopyRow label="ADD url (step 11)" value={addUrl} />
                <View style={{ height: spacing.sm }} />
                <CopyRow label="token (for the JSON body)" value={token} secret />
                <View style={{ height: spacing.md }} />
                {FULL_STEPS.map((step, i) => (
                  <View key={i} style={{ flexDirection: 'row', marginBottom: spacing.sm }}>
                    <Text style={[font.small, { color: c.owed, width: 26 }]}>{i + 1}.</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[font.small, { color: c.text, lineHeight: 20 }]}>
                        {step.text}
                      </Text>
                      {step.detail ? (
                        <Text
                          style={[font.small, { color: c.textFaint, lineHeight: 20, marginTop: 2 }]}
                        >
                          {step.detail}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </>
            ) : null}

            <Text style={[font.small, { color: c.textFaint, lineHeight: 20, marginTop: spacing.sm }]}>
              Leave the note prompt blank to skip it. Leave "What was it for?"
              blank and the category is used as the description. You only build
              it once — the token lasts ten years.
            </Text>
          </>
        ) : (
          <Button
            title="Generate a token first"
            onPress={() => void generate()}
            loading={busy}
            style={{ alignSelf: 'stretch' }}
          />
        )}
      </View>

      <SectionTitle>Or sign it on a Mac</SectionTitle>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <Text style={[font.small, { color: c.textFaint, lineHeight: 20, marginBottom: spacing.md }]}>
          Skips the building entirely: sign the generated file with Apple's own
          tool and the iPhone imports it like any other shortcut. Needs a Mac
          on macOS 12 or newer, once.
        </Text>
        {token ? (
          <>
            <CopyRow label="Full version — download url" value={fullFileUrl} secret />
            <View style={{ height: spacing.sm }} />
            <CopyRow label="Amount only — download url" value={simpleFileUrl} secret />
            <View style={{ height: spacing.md }} />
            {IMPORT_STEPS.map((step, i) => (
              <View key={i} style={{ flexDirection: 'row', marginBottom: spacing.sm }}>
                <Text style={[font.small, { color: c.owed, width: 22 }]}>{i + 1}.</Text>
                <Text style={[font.small, { color: c.text, flex: 1, lineHeight: 20 }]}>{step}</Text>
              </View>
            ))}
            <Text style={[font.small, { color: c.textFaint, lineHeight: 20, marginTop: spacing.xs }]}>
              If Shortcuts still refuses it, the inline variant serves the same
              bytes without the attachment header: {inlineFileUrl ? 'add &inline=1' : ''}
            </Text>
          </>
        ) : (
          <Button
            title="Generate a token first"
            onPress={() => void generate()}
            loading={busy}
            style={{ alignSelf: 'stretch' }}
          />
        )}
        {error ? (
          <Text style={[font.small, { color: c.danger, marginTop: spacing.sm }]}>{error}</Text>
        ) : null}
      </View>

      <SectionTitle>Fallback A — a form appears (1 action)</SectionTitle>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <Text style={[font.small, { color: c.textFaint, lineHeight: 20, marginBottom: spacing.md }]}>
          Back Tap opens this app on a single-field screen: type the amount, hit
          Save. Nothing to authorise, because the app is already signed in on
          this device.
        </Text>
        <CopyRow label="URL" value={formUrl} />
        <View style={{ height: spacing.md }} />
        {FORM_STEPS.map((step, i) => (
          <View key={i} style={{ flexDirection: 'row', marginBottom: spacing.sm }}>
            <Text style={[font.small, { color: c.owed, width: 22 }]}>{i + 1}.</Text>
            <Text style={[font.small, { color: c.text, flex: 1, lineHeight: 20 }]}>{step}</Text>
          </View>
        ))}
      </View>

      <SectionTitle>Fallback B — no app opens (2 actions)</SectionTitle>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <Text style={[font.small, { color: c.textFaint, lineHeight: 20, marginBottom: spacing.md }]}>
          Back Tap prompts for the amount right where you are and saves it in the
          background. Needs a token, since the Shortcut is not signed in.
        </Text>
        {token ? (
          <>
            <CopyRow label="URL, token included" value={silentUrl} secret />
            <View style={{ height: spacing.md }} />
            {SILENT_STEPS.map((step, i) => (
              <View key={i} style={{ flexDirection: 'row', marginBottom: spacing.sm }}>
                <Text style={[font.small, { color: c.owed, width: 22 }]}>{i + 1}.</Text>
                <Text style={[font.small, { color: c.text, flex: 1, lineHeight: 20 }]}>{step}</Text>
              </View>
            ))}
          </>
        ) : (
          <Button
            title="Generate the URL"
            onPress={() => void generate()}
            loading={busy}
            style={{ alignSelf: 'stretch' }}
          />
        )}
        {error ? (
          <Text style={[font.small, { color: c.danger, marginTop: spacing.sm }]}>{error}</Text>
        ) : null}
      </View>

      <View style={{ padding: spacing.lg }}>
        <Text style={[font.small, { color: c.textFaint, lineHeight: 20 }]}>
          Option B's URL contains a token, so treat it like a password — anyone
          holding it can add expenses to your groups. Signing out revokes it.
          Option A carries no token at all, which is why it is the safer of the
          two.
        </Text>
        {API_BASE !== PUBLIC_BASE ? (
          <Text style={[font.small, { color: c.textFaint, marginTop: spacing.sm }]}>
            This app is talking to {API_BASE}; the Shortcut uses the public URL above.
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    copyBox: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.md,
    },
    warning: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: c.oweTint,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
  });
