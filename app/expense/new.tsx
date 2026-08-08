import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
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

import { Avatar, Button, Divider, PromptDialog, SectionTitle } from '../../src/components/ui';
import { currencySymbol, formatAmount, parseAmount } from '../../src/lib/money';
import { buildSplits, validatePayers, validateSplits } from '../../src/lib/split';
import { useStore } from '../../src/store/useStore';
import { useCategories } from '../../src/store/selectors';
import { useSettings } from '../../src/store/useSettings';
import { Palette, font, iconForCategory, radius, spacing, useColors } from '../../src/theme';
import type { SplitMethod } from '../../src/types';

const METHODS: { key: SplitMethod; label: string; hint: string }[] = [
  { key: 'equal', label: '=', hint: 'Split equally' },
  { key: 'exact', label: '1.23', hint: 'Exact amounts' },
  { key: 'percent', label: '%', hint: 'By percentage' },
  { key: 'shares', label: '⅔', hint: 'By shares' },
];

export default function NewExpenseScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const {
    groupId,
    amount: prefillAmount,
    description: prefillDescription,
    category: prefillCategory,
  } = useLocalSearchParams<{
    groupId?: string;
    amount?: string;
    description?: string;
    category?: string;
  }>();
  const router = useRouter();

  const groups = useStore((s) => s.groups);
  const people = useStore((s) => s.people);
  const meId = useStore((s) => s.meId);
  const addExpense = useStore((s) => s.addExpense);

  const group = groups.find((g) => g.id === groupId) ?? groups[0];
  const memberIds = group?.memberIds ?? [meId];
  const currency = group?.currency ?? 'INR';

  // Scanned receipts arrive as query params; amount is already in minor units.
  const [description, setDescription] = useState(prefillDescription ?? '');
  const [amountText, setAmountText] = useState(
    prefillAmount && Number(prefillAmount) > 0
      ? (Number(prefillAmount) / 100).toFixed(2)
      : ''
  );
  const [category, setCategory] = useState(prefillCategory ?? 'general');
  const categories = useCategories();
  const addCategory = useSettings((st) => st.addCategory);
  const [namingCategory, setNamingCategory] = useState(false);
  const [paidById, setPaidById] = useState(meId);
  // Multi-payer is off by default: one person paying is overwhelmingly the
  // common case, and showing four amount fields for it would be noise.
  const [multiPayer, setMultiPayer] = useState(false);
  const [payerInputs, setPayerInputs] = useState<Record<string, string>>({});
  const [participants, setParticipants] = useState<string[]>(memberIds);
  const [method, setMethod] = useState<SplitMethod>('equal');
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const amount = parseAmount(amountText);

  // Preview the exact split the user is about to save, so a mismatch is
  // visible before they commit rather than surfacing as a wrong balance later.
  const splits = useMemo(() => {
    const numeric: Record<string, number> = {};
    for (const id of participants) {
      const raw = inputs[id] ?? '';
      numeric[id] = method === 'exact' ? parseAmount(raw) : Number(raw) || 0;
    }
    return buildSplits(method, amount, participants, numeric);
  }, [method, amount, participants, inputs]);

  const validation = validateSplits(amount, splits);

  const payers = useMemo(
    () =>
      multiPayer
        ? memberIds
            .map((id) => ({ personId: id, amount: parseAmount(payerInputs[id] ?? '') }))
            .filter((p) => p.amount !== 0)
        : [{ personId: paidById, amount }],
    [multiPayer, memberIds, payerInputs, paidById, amount]
  );
  const payerValidation = validatePayers(amount, payers);

  const canSave =
    description.trim().length > 0 &&
    amount > 0 &&
    participants.length > 0 &&
    (method !== 'exact' || validation.valid) &&
    (!multiPayer || payerValidation.valid);

  const toggleParticipant = (id: string) =>
    setParticipants((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );

  const save = () => {
    const numeric: Record<string, number> = {};
    for (const id of participants) {
      const raw = inputs[id] ?? '';
      numeric[id] = method === 'exact' ? parseAmount(raw) : Number(raw) || 0;
    }
    addExpense({
      groupId: group?.id ?? null,
      description,
      amount,
      currency,
      category,
      paidById: multiPayer ? undefined : paidById,
      paidBy: multiPayer ? payers : undefined,
      participantIds: participants,
      splitMethod: method,
      splitInputs: numeric,
    });
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ title: group ? `Add to ${group.name}` : 'Add expense' }} />
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        <View style={styles.amountBlock}>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="What was it for?"
            placeholderTextColor={c.textFaint}
            style={styles.description}
          />
          <View style={styles.amountRow}>
            <Text style={styles.currency}>{currencySymbol(currency)}</Text>
            <TextInput
              value={amountText}
              onChangeText={setAmountText}
              placeholder="0.00"
              placeholderTextColor={c.textFaint}
              keyboardType="decimal-pad"
              style={styles.amountInput}
            />
          </View>
        </View>

        <Pressable
          onPress={() => router.replace(`/expense/scan?groupId=${group?.id ?? ''}`)}
          style={styles.scanRow}
        >
          <Ionicons name="camera-outline" size={20} color={c.owed} />
          <Text style={[font.bodyStrong, { color: c.owed, marginLeft: spacing.sm }]}>
            Scan a receipt instead
          </Text>
        </Pressable>

        <SectionTitle>Category</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {categories.map((key) => {
            const active = category === key;
            return (
              <Pressable
                key={key}
                onPress={() => setCategory(key)}
                android_ripple={{ color: c.pressed }}
                style={({ pressed }) => [
                  styles.chip,
                  active && styles.chipActive,
                  pressed && !active && { backgroundColor: c.pressed },
                ]}
              >
                <Ionicons
                  name={iconForCategory(key) as never}
                  size={16}
                  color={active ? c.onDark : c.textMuted}
                />
                <Text style={[font.small, { marginLeft: 6, color: active ? c.onDark : c.text }]}>
                  {key}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setNamingCategory(true)}
            android_ripple={{ color: c.pressed }}
            style={({ pressed }) => [
              styles.chip,
              { borderStyle: 'dashed' },
              pressed && { backgroundColor: c.pressed },
            ]}
          >
            <Ionicons name="add" size={16} color={c.owed} />
            <Text style={[font.small, { marginLeft: 6, color: c.owed }]}>New</Text>
          </Pressable>
        </ScrollView>

        <PromptDialog
          visible={namingCategory}
          title="New category"
          message="It will be available everywhere, and on your other devices once an expense uses it."
          placeholder="e.g. gym, pets, medical"
          onSubmit={(name) => {
            const clean = addCategory(name);
            if (clean) setCategory(clean);
            setNamingCategory(false);
          }}
          onCancel={() => setNamingCategory(false)}
        />

        <View style={styles.paidHeader}>
          <SectionTitle>Paid by</SectionTitle>
          <Pressable
            onPress={() => setMultiPayer((v) => !v)}
            android_ripple={{ color: c.pressed }}
            style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons
              name={multiPayer ? 'people' : 'person'}
              size={15}
              color={c.owed}
            />
            <Text style={[font.small, { color: c.owed, marginLeft: 5 }]}>
              {multiPayer ? 'Single payer' : 'Multiple people'}
            </Text>
          </Pressable>
        </View>

        {!multiPayer ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {memberIds.map((id) => {
              const person = people.find((p) => p.id === id);
              if (!person) return null;
              const active = paidById === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => setPaidById(id)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[font.small, { color: active ? c.onDark : c.text }]}>
                    {id === meId ? 'You' : person.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : (
          <>
            <Text style={styles.hint}>
              Enter what each person actually put in. They must add up to the total.
            </Text>
            {memberIds.map((id, index) => {
              const person = people.find((p) => p.id === id);
              if (!person) return null;
              return (
                <View key={id}>
                  <View style={styles.splitRow}>
                    <View style={styles.splitLeft}>
                      <Avatar name={person.name} colorIndex={person.colorIndex} size={32} />
                      <Text style={[font.body, { marginLeft: spacing.sm, color: c.text }]}>
                        {id === meId ? 'You' : person.name}
                      </Text>
                    </View>
                    <TextInput
                      value={payerInputs[id] ?? ''}
                      onChangeText={(text) =>
                        setPayerInputs((prev) => ({ ...prev, [id]: text }))
                      }
                      placeholder="0.00"
                      placeholderTextColor={c.textFaint}
                      keyboardType="decimal-pad"
                      style={styles.splitInput}
                    />
                  </View>
                  {index < memberIds.length - 1 ? <Divider /> : null}
                </View>
              );
            })}
            {!payerValidation.valid && amount > 0 ? (
              <Text style={styles.error}>{payerValidation.message}</Text>
            ) : null}
          </>
        )}

        <SectionTitle>Split</SectionTitle>
        <View style={styles.methods}>
          {METHODS.map((m) => {
            const active = method === m.key;
            return (
              <Pressable
                key={m.key}
                onPress={() => setMethod(m.key)}
                style={[styles.methodBtn, active && styles.chipActive]}
              >
                <Text style={[font.bodyStrong, { color: active ? c.onDark : c.text }]}>
                  {m.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>{METHODS.find((m) => m.key === method)?.hint}</Text>

        {memberIds.map((id, index) => {
          const person = people.find((p) => p.id === id);
          if (!person) return null;
          const included = participants.includes(id);
          const share = splits.find((s) => s.personId === id)?.amount ?? 0;
          return (
            <View key={id}>
              <View style={styles.splitRow}>
                <Pressable
                  onPress={() => toggleParticipant(id)}
                  android_ripple={{ color: c.pressed }}
                  style={({ pressed }) => [styles.splitLeft, pressed && { opacity: 0.6 }]}
                >
                  <Ionicons
                    name={included ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={included ? c.owed : c.border}
                  />
                  <Avatar name={person.name} colorIndex={person.colorIndex} size={32} />
                  <Text style={[font.body, { marginLeft: spacing.sm }, { color: c.text }]}>
                    {id === meId ? 'You' : person.name}
                  </Text>
                </Pressable>

                {included && method !== 'equal' ? (
                  <TextInput
                    value={inputs[id] ?? ''}
                    onChangeText={(text) => setInputs((prev) => ({ ...prev, [id]: text }))}
                    placeholder={method === 'percent' ? '%' : method === 'shares' ? 'shares' : '0.00'}
                    placeholderTextColor={c.textFaint}
                    keyboardType="decimal-pad"
                    style={styles.splitInput}
                  />
                ) : null}

                <Text style={[font.small, { color: included ? c.textMuted : c.textFaint, minWidth: 74, textAlign: 'right' }]}>
                  {included ? currencySymbol(currency) + formatAmount(share, currency) : 'not included'}
                </Text>
              </View>
              {index < memberIds.length - 1 ? <Divider /> : null}
            </View>
          );
        })}

        {!validation.valid && method === 'exact' && amount > 0 ? (
          <Text style={styles.error}>{validation.message}</Text>
        ) : null}

        <View style={{ padding: spacing.lg }}>
          <Button title="Save expense" onPress={save} disabled={!canSave} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  amountBlock: { padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  description: {
    ...font.h3,
    color: c.text,
    backgroundColor: c.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  currency: { fontSize: 32, fontWeight: '700', color: c.textMuted, marginRight: spacing.sm },
  amountInput: { flex: 1, fontSize: 36, fontWeight: '700', color: c.text, padding: 0 },
  chips: { paddingHorizontal: spacing.lg, gap: spacing.sm, flexDirection: 'row' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.border,
  },
  chipActive: { backgroundColor: c.owed, borderColor: c.owed },
  methods: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg },
  methodBtn: {
    width: 64,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
  },
  hint: { ...font.small, color: c.textFaint, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  splitLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: spacing.sm },
  splitInput: {
    ...font.body,
    width: 76,
    textAlign: 'right',
    backgroundColor: c.surface,
    borderRadius: radius.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    color: c.text,
  },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  paidHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: spacing.lg,
  },
  linkBtn: { flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm },
  error: { ...font.small, color: c.danger, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
});
