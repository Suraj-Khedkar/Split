import { Ionicons } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Divider, SectionTitle } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { formatMoney } from '../../src/lib/money';
import { setReceiptDraft } from '../../src/lib/receiptDraft';
import { useStore } from '../../src/store/useStore';
import { Palette, font, radius, spacing, useColors } from '../../src/theme';

/** OCR.space rejects anything over 1MB, so shrink before uploading. */
const MAX_BYTES = 900 * 1024;

interface Item {
  label: string;
  amount: number;
  include: boolean;
}

export default function ScanScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const groups = useStore((s) => s.groups);

  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [merchant, setMerchant] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [rawText, setRawText] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  /**
   * Shrink until it fits. Receipt photos from a modern phone are several MB;
   * uploading one unchanged just fails at the provider. Successive passes
   * because a single guess at quality rarely lands under the limit.
   */
  const compress = async (uri: string): Promise<string> => {
    let width = 1400;
    let quality = 0.7;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const out = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width } }],
        { compress: quality, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      const base64 = out.base64 ?? '';
      // base64 is ~4/3 the size of the bytes it encodes.
      if ((base64.length * 3) / 4 <= MAX_BYTES) return base64;
      width = Math.round(width * 0.75);
      quality = Math.max(0.4, quality - 0.1);
    }
    throw new Error('That photo is too large even after compressing. Try a tighter crop.');
  };

  const handle = async (uri: string) => {
    setBusy(true);
    setError('');
    setPreview(uri);
    try {
      const base64 = await compress(uri);
      const result = await api.ocr(base64, 'receipt.jpg');
      setMerchant(result.merchant);
      setTotal(result.total);
      setRawText(result.text ?? '');
      setItems((result.items ?? []).map((i) => ({ ...i, include: true })));
      if (!result.total && !(result.items ?? []).length) {
        setError('Nothing readable was found. Try better lighting or a straighter angle.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that receipt');
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setError('Camera permission was not granted.');
    const shot = await ImagePicker.launchCameraAsync({ quality: 1, allowsEditing: true });
    if (!shot.canceled && shot.assets[0]) void handle(shot.assets[0].uri);
  };

  const pickImage = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ quality: 1, allowsEditing: true });
    if (!picked.canceled && picked.assets[0]) void handle(picked.assets[0].uri);
  };

  const group = groups.find((g) => g.id === groupId);
  const selected = items.filter((i) => i.include);
  const canAssign = selected.length > 0 && (group?.memberIds.length ?? 0) > 1;
  const selectedSum = selected.reduce((sum, i) => sum + i.amount, 0);
  // Prefer the receipt's own total: it includes tax and service the line items
  // do not. Fall back to the selection when no total was found.
  const amountToUse = selected.length && selectedSum !== total ? selectedSum : total ?? selectedSum;

  /**
   * Hand the whole receipt on, rather than only its total.
   *
   * Only offered when there are lines to assign and more than one person to
   * assign them to — on a solo group there is nothing to decide.
   */
  const assign = () => {
    setReceiptDraft({
      groupId: groupId ?? '',
      items: selected.map(({ label, amount }) => ({ label, amount })),
      total: amountToUse ?? 0,
      merchant,
    });
    router.push(`/expense/assign?groupId=${groupId ?? ''}`);
  };

  const useIt = () => {
    const description = merchant ?? 'Receipt';
    router.replace(
      `/expense/new?groupId=${groupId ?? ''}&amount=${amountToUse ?? 0}&description=${encodeURIComponent(description)}&category=food`
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: 'Scan a receipt' }} />

      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        {Platform.OS !== 'web' ? (
          <Button title="Take a photo" onPress={() => void takePhoto()} />
        ) : null}
        <Button
          title={Platform.OS === 'web' ? 'Choose a receipt image' : 'Pick from library'}
          variant={Platform.OS === 'web' ? 'primary' : 'secondary'}
          onPress={() => void pickImage()}
        />
      </View>

      {preview ? (
        <Image source={{ uri: preview }} style={styles.preview} resizeMode="contain" />
      ) : null}

      {busy ? (
        <Text style={[font.body, { color: c.textMuted, textAlign: 'center', padding: spacing.lg }]}>
          Reading the receipt…
        </Text>
      ) : null}

      {error ? (
        <View style={styles.error}>
          <Ionicons name="alert-circle-outline" size={18} color={c.danger} />
          <Text style={[font.small, { color: c.danger, flex: 1, marginLeft: spacing.sm }]}>{error}</Text>
        </View>
      ) : null}

      {total !== null || items.length > 0 ? (
        <>
          <SectionTitle>What I read</SectionTitle>
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
            {merchant ? (
              <Text style={[font.h3, { color: c.text }]}>{merchant}</Text>
            ) : null}
            {total !== null ? (
              <Text style={[font.h1, { color: c.owed }]}>{formatMoney(total)}</Text>
            ) : (
              <Text style={[font.small, { color: c.owe }]}>No total found — pick items below.</Text>
            )}
            <Text style={[font.small, { color: c.textFaint, marginTop: 4 }]}>
              Always check these against the paper before saving.
            </Text>
          </View>

          {items.length ? (
            <>
              <SectionTitle>Line items</SectionTitle>
              {items.map((item, index) => (
                <View key={`${item.label}-${index}`}>
                  <Pressable
                    onPress={() =>
                      setItems((prev) =>
                        prev.map((it, i) => (i === index ? { ...it, include: !it.include } : it))
                      )
                    }
                    style={styles.itemRow}
                  >
                    <Ionicons
                      name={item.include ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={item.include ? c.owed : c.border}
                    />
                    <Text style={[font.body, { flex: 1, marginLeft: spacing.md, color: c.text }]}>
                      {item.label}
                    </Text>
                    <Text style={[font.bodyStrong, { color: c.textMuted }]}>
                      {formatMoney(item.amount)}
                    </Text>
                  </Pressable>
                  {index < items.length - 1 ? <Divider /> : null}
                </View>
              ))}
              <Text style={styles.hint}>
                Selected: {formatMoney(selectedSum)}
                {total !== null && selectedSum !== total
                  ? `  ·  receipt total ${formatMoney(total)} (includes tax/service)`
                  : ''}
              </Text>
            </>
          ) : null}

          <Pressable onPress={() => setShowRaw((v) => !v)} style={{ padding: spacing.lg }}>
            <Text style={[font.small, { color: c.owed }]}>
              {showRaw ? 'Hide' : 'Show'} the raw text I read
            </Text>
          </Pressable>
          {showRaw ? <Text style={styles.raw}>{rawText || '(nothing)'}</Text> : null}

          <View style={{ padding: spacing.lg, gap: spacing.sm }}>
            {canAssign ? (
              <Button
                title="Split by dish"
                onPress={assign}
                disabled={!amountToUse}
              />
            ) : null}
            <Button
              title={`Use ${formatMoney(amountToUse ?? 0)}`}
              variant={canAssign ? 'secondary' : 'primary'}
              onPress={useIt}
              disabled={!amountToUse}
            />
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    preview: {
      height: 220,
      marginHorizontal: spacing.lg,
      borderRadius: radius.md,
      backgroundColor: c.surface,
    },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    hint: { ...font.small, color: c.textFaint, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
    raw: {
      ...font.small,
      color: c.textMuted,
      marginHorizontal: spacing.lg,
      padding: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    error: {
      flexDirection: 'row',
      alignItems: 'center',
      margin: spacing.lg,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: c.oweTint,
    },
  });
