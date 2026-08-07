import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Stack, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Avatar, Button, Divider, SectionTitle } from '../src/components/ui';
import { formatMoney } from '../src/lib/money';
import {
  mapCategory,
  parseSplitwiseCsv,
  rebuildShares,
  type ImportPreview,
} from '../src/lib/splitwiseImport';
import { api } from '../src/lib/api';
import { useAuth } from '../src/store/useAuth';
import { useStore } from '../src/store/useStore';
import { Palette, font, radius, spacing, useColors } from '../src/theme';

export default function ImportScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();

  const people = useStore((s) => s.people);
  const meId = useStore((s) => s.meId);
  const refresh = useAuth((s) => s.refresh);
  const [importing, setImporting] = useState(false);

  const [csv, setCsv] = useState('');
  const [groupName, setGroupName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  /** Splitwise name -> local person id, or '' meaning "create new". */
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const analyse = (text: string) => {
    setError('');
    setDone('');
    try {
      const parsed = parseSplitwiseCsv(text);
      setPreview(parsed);
      // Pre-match on name, and guess that the first column is you — Splitwise
      // exports list the exporting user first.
      const guess: Record<string, string> = {};
      parsed.people.forEach((name, index) => {
        const hit = people.find((p) => p.name.toLowerCase() === name.toLowerCase());
        guess[name] = hit ? hit.id : index === 0 ? meId : '';
      });
      setMapping(guess);
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      let text = '';
      if (Platform.OS === 'web') {
        // On web the picker hands back a File via the blob URL.
        text = await (await fetch(asset.uri)).text();
      } else {
        const FS = await import('expo-file-system/legacy');
        text = await FS.readAsStringAsync(asset.uri);
      }
      setCsv(text);
      if (!groupName) setGroupName(asset.name?.replace(/\.csv$/i, '') ?? '');
      analyse(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file');
    }
  };

  const runImport = async () => {
    if (!preview) return;
    setImporting(true);
    setError('');
    try {
      // Create the group on the server first. The previous version built it
      // only in local state, so the next sync — which is server-authoritative
      // — deleted the whole import moments later.
      const { group } = await api.createGroup(
        groupName.trim() || 'Imported from Splitwise',
        'other',
        preview.currency
      );

      // Every name has to resolve to a real server user id, because expense
      // rows are foreign-keyed to users. Anyone who is not you is added as a
      // placeholder member — a person with no account who can still appear in
      // expenses, and who can be replaced when they sign up and join.
      const ids: Record<string, string> = {};
      for (const name of preview.people) {
        if (mapping[name] === meId) {
          ids[name] = meId;
          continue;
        }
        const { member } = await api.addMember(group.id, name);
        ids[name] = member.id;
      }

      let failed = 0;
      for (const row of preview.rows) {
        const { paidBy, splits } = rebuildShares(row.amount, row.nets, (n) => ids[n]);
        try {
          await api.createExpense({
            groupId: group.id,
            description: row.description,
            amount: row.amount,
            currency: row.currency,
            category: mapCategory(row.category),
            splitMethod: 'exact',
            date: row.date || undefined,
            isSettlement: row.isSettlement,
            paidBy,
            splits,
          });
        } catch {
          failed += 1;
        }
      }

      // Pull the server's copy so what is on screen is what was actually saved.
      await refresh();
      setDone(
        failed === 0
          ? `Imported ${preview.rows.length} expenses into "${group.name}".`
          : `Imported ${preview.rows.length - failed} of ${preview.rows.length}; ${failed} could not be saved.`
      );
      setTimeout(() => router.replace(`/group/${group.id}`), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const total = preview?.rows.reduce((sum, r) => sum + r.amount, 0) ?? 0;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Import from Splitwise' }} />

      <View style={styles.intro}>
        <Text style={[font.body, { color: c.textMuted, lineHeight: 21 }]}>
          In Splitwise, open a group → the gear icon → <Text style={{ fontWeight: '700', color: c.text }}>Export as spreadsheet</Text>.
          Pick the CSV here, or paste its contents below. Balances come across exactly.
        </Text>
      </View>

      <View style={{ paddingHorizontal: spacing.lg }}>
        <Button title="Choose CSV file" variant="secondary" onPress={pickFile} />
      </View>

      <SectionTitle>Or paste the CSV</SectionTitle>
      <TextInput
        value={csv}
        onChangeText={(t) => {
          setCsv(t);
          if (t.trim().length > 40) analyse(t);
        }}
        placeholder={'Date,Description,Category,Cost,Currency,Alice,Bob\n2026-01-15,Dinner,Dining out,900.00,INR,600.00,-300.00'}
        placeholderTextColor={c.textFaint}
        multiline
        style={styles.csvBox}
      />

      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={18} color={c.danger} />
          <Text style={[font.small, { color: c.danger, flex: 1, marginLeft: spacing.sm }]}>{error}</Text>
        </View>
      ) : null}

      {preview ? (
        <>
          <SectionTitle>Group name</SectionTitle>
          <TextInput
            value={groupName}
            onChangeText={setGroupName}
            placeholder="Imported from Splitwise"
            placeholderTextColor={c.textFaint}
            style={styles.input}
          />

          <SectionTitle>Who is who</SectionTitle>
          <Text style={styles.hint}>
            Tap to match a Splitwise name to someone you already have. Unmatched names are created.
          </Text>
          {preview.people.map((name, index) => (
            <View key={name}>
              <View style={styles.mapRow}>
                <Text style={[font.bodyStrong, { color: c.text, width: 96 }]} numberOfLines={1}>
                  {name}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  <Pressable
                    onPress={() => setMapping((m) => ({ ...m, [name]: '' }))}
                    style={[styles.chip, mapping[name] === '' && styles.chipActive]}
                  >
                    <Text style={[font.small, { color: mapping[name] === '' ? c.onDark : c.text }]}>
                      + New
                    </Text>
                  </Pressable>
                  {people.map((p) => {
                    const active = mapping[name] === p.id;
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => setMapping((m) => ({ ...m, [name]: p.id }))}
                        style={[styles.chip, active && styles.chipActive]}
                      >
                        <Avatar name={p.name} colorIndex={p.colorIndex} size={18} />
                        <Text style={[font.small, { marginLeft: 5, color: active ? c.onDark : c.text }]}>
                          {p.id === meId ? 'You' : p.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
              {index < preview.people.length - 1 ? <Divider /> : null}
            </View>
          ))}

          <SectionTitle>Preview</SectionTitle>
          <View style={styles.summary}>
            <Text style={[font.body, { color: c.text }]}>
              {preview.rows.length} expenses · {formatMoney(total, preview.currency)} total
            </Text>
            {preview.warnings.map((w) => (
              <Text key={w} style={[font.small, { color: c.owe, marginTop: 4 }]}>
                {w}
              </Text>
            ))}
          </View>
          {preview.rows.slice(0, 6).map((r, i) => (
            <View key={i} style={styles.previewRow}>
              <Text style={[font.small, { color: c.text, flex: 1 }]} numberOfLines={1}>
                {r.description}
              </Text>
              <Text style={[font.small, { color: c.textMuted }]}>
                {formatMoney(r.amount, r.currency)}
              </Text>
            </View>
          ))}
          {preview.rows.length > 6 ? (
            <Text style={styles.hint}>…and {preview.rows.length - 6} more</Text>
          ) : null}

          {done ? (
            <View style={styles.doneBox}>
              <Ionicons name="checkmark-circle" size={18} color={c.owed} />
              <Text style={[font.small, { color: c.owed, marginLeft: spacing.sm }]}>{done}</Text>
            </View>
          ) : null}

          <View style={{ padding: spacing.lg }}>
            <Button
              title={`Import ${preview.rows.length} expenses`}
              onPress={() => void runImport()}
              loading={importing}
            />
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    intro: { padding: spacing.lg, paddingBottom: spacing.md },
    csvBox: {
      ...font.small,
      marginHorizontal: spacing.lg,
      minHeight: 130,
      padding: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      color: c.text,
      textAlignVertical: 'top',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    input: {
      ...font.body,
      marginHorizontal: spacing.lg,
      padding: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      color: c.text,
    },
    hint: {
      ...font.small,
      color: c.textFaint,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    mapRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: spacing.lg,
      paddingVertical: spacing.sm,
    },
    chips: { gap: spacing.sm, flexDirection: 'row', paddingRight: spacing.lg },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.border,
    },
    chipActive: { backgroundColor: c.owed, borderColor: c.owed },
    summary: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    previewRow: {
      flexDirection: 'row',
      paddingHorizontal: spacing.lg,
      paddingVertical: 5,
      gap: spacing.md,
    },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      margin: spacing.lg,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: c.oweTint,
    },
    doneBox: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: spacing.lg,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: c.owedTint,
    },
  });
