import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
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

import { Avatar, Button, Divider, EmptyState, GroupIcon, PromptDialog, Row, SectionTitle } from '../../src/components/ui';
import { suggestCategory } from '../../src/lib/categorise';
import { currencySymbol, formatAmount, parseAmount } from '../../src/lib/money';
import { buildSplits, validatePayers, validateSplits } from '../../src/lib/split';
import { personName, useStore } from '../../src/store/useStore';
import { useAuth } from '../../src/store/useAuth';
import { useCategories } from '../../src/store/selectors';
import { useSettings } from '../../src/store/useSettings';
import { Palette, font, iconForCategory, radius, spacing, useColors } from '../../src/theme';
import type { Expense, Group, SplitMethod } from '../../src/types';

const METHODS: { key: SplitMethod; label: string; hint: string }[] = [
  { key: 'equal', label: '=', hint: 'Split equally' },
  { key: 'exact', label: '1.23', hint: 'Exact amounts' },
  { key: 'percent', label: '%', hint: 'By percentage' },
  { key: 'shares', label: '⅔', hint: 'By shares' },
  { key: 'adjust', label: '+', hint: 'Equal, plus extra for some' },
  { key: 'reduce', label: '−', hint: 'Equal, minus some for some' },
];

/**
 * Add an expense, in two steps: where it goes, then what it was.
 *
 * The target used to default to `groups[0]` whenever none was supplied, which
 * meant the Groups-tab button silently filed everything against whichever group
 * happened to sort first — a wrong guess that only showed up later as a balance
 * nobody recognised. Screens that already know the target (a group's own Add
 * button, the receipt scanner) pass ?groupId= and skip straight past the picker.
 */
export default function NewExpenseScreen() {
  const params = useLocalSearchParams<{
    groupId?: string;
    amount?: string;
    description?: string;
    category?: string;
    /** Set when correcting an existing expense instead of adding one. */
    id?: string;
  }>();

  const groups = useStore((s) => s.groups);
  const expenses = useStore((s) => s.expenses);
  const editing = params.id ? expenses.find((e) => e.id === params.id) : undefined;
  // An edit already belongs to a group, so the picker never applies to it.
  const [picked, setPicked] = useState(editing?.groupId ?? params.groupId ?? '');
  const target = groups.find((g) => g.id === picked);

  if (params.id && !editing) {
    return <EmptyState icon="alert-circle-outline" title="Expense not found" />;
  }
  if (!target) return <TargetPicker onPick={setPicked} />;

  return (
    // Remounting on a target change is what keeps the participant list, payer
    // and split inputs consistent with the group they belong to.
    <ExpenseForm
      key={target.id}
      group={target}
      editing={editing}
      prefillAmount={params.amount}
      prefillDescription={params.description}
      prefillCategory={params.category}
    />
  );
}

/** Step one: which group, which friend, or just you. */
function TargetPicker({ onPick }: { onPick: (groupId: string) => void }) {
  const c = useColors();
  const router = useRouter();
  const groups = useStore((s) => s.groups);
  const people = useStore((s) => s.people);
  const meId = useStore((s) => s.meId);

  /** Set when a friend shares more than one group and we have to disambiguate. */
  const [friendId, setFriendId] = useState<string | null>(null);

  const personal = groups.find((g) => g.type === 'personal') ?? null;
  const shared = useMemo(
    () => groups.filter((g) => g.type !== 'personal'),
    [groups]
  );

  /** Groups a given friend and the device owner are both in. */
  const groupsWith = (personId: string) =>
    shared.filter((g) => g.memberIds.includes(personId) && g.memberIds.includes(meId));

  const friends = useMemo(
    () => people.filter((p) => p.id !== meId),
    [people, meId]
  );

  const focused = friendId ? people.find((p) => p.id === friendId) : null;
  if (focused) {
    const options = groupsWith(focused.id);
    return (
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }}>
        <Stack.Screen options={{ title: `Expense with ${focused.name}` }} />
        <Text style={[font.small, { color: c.textFaint, padding: spacing.lg }]}>
          You share {options.length} groups with {focused.name}. An expense has
          to live in one of them, so everyone in it sees the same balances.
        </Text>
        {options.map((g, index) => (
          <View key={g.id}>
            <Row
              left={<GroupIcon type={g.type} size={38} />}
              title={g.name}
              subtitle={`${g.memberIds.length} members`}
              onPress={() => onPick(g.id)}
              chevron
            />
            {index < options.length - 1 ? <Divider /> : null}
          </View>
        ))}
        <View style={{ padding: spacing.lg }}>
          <Button title="Back" variant="secondary" onPress={() => setFriendId(null)} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
      <Stack.Screen options={{ title: 'Add expense' }} />
      <Text style={[font.small, { color: c.textFaint, paddingHorizontal: spacing.lg, paddingTop: spacing.lg }]}>
        Where should this go?
      </Text>

      {personal ? (
        <>
          <SectionTitle>Just you</SectionTitle>
          <Row
            left={<GroupIcon type="personal" size={38} />}
            title="Personal"
            subtitle="Yours alone — not split with anyone"
            onPress={() => onPick(personal.id)}
            chevron
          />
        </>
      ) : null}

      {shared.length ? (
        <>
          <SectionTitle>Groups</SectionTitle>
          {shared.map((g, index) => (
            <View key={g.id}>
              <Row
                left={<GroupIcon type={g.type} size={38} />}
                title={g.name}
                subtitle={`${g.memberIds.length} member${g.memberIds.length === 1 ? '' : 's'}`}
                onPress={() => onPick(g.id)}
                chevron
              />
              {index < shared.length - 1 ? <Divider /> : null}
            </View>
          ))}
        </>
      ) : null}

      {friends.length ? (
        <>
          <SectionTitle>Friends</SectionTitle>
          {friends.map((p, index) => {
            const options = groupsWith(p.id);
            return (
              <View key={p.id}>
                <Row
                  left={<Avatar name={p.name} colorIndex={p.colorIndex} size={38} />}
                  title={personName(people, p.id, meId)}
                  subtitle={
                    options.length === 0
                      ? 'No shared group yet — create one first'
                      : options.length === 1
                      ? `in ${options[0].name}`
                      : `${options.length} shared groups — pick one`
                  }
                  // An expense needs a group to sync into; with none shared
                  // there is nowhere to put it that they would ever see.
                  onPress={
                    options.length === 0
                      ? undefined
                      : options.length === 1
                      ? () => onPick(options[0].id)
                      : () => setFriendId(p.id)
                  }
                  chevron={options.length > 0}
                />
                {index < friends.length - 1 ? <Divider /> : null}
              </View>
            );
          })}
        </>
      ) : null}

      {!shared.length && !friends.length ? (
        <EmptyState
          icon="people-outline"
          title="Nobody to split with yet"
          body="Create a group or add a friend, or track this as a personal expense."
        />
      ) : null}

      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Button
          title="Create a group"
          variant="secondary"
          onPress={() => router.replace('/group/new')}
        />
      </View>
    </ScrollView>
  );
}

/** Step two: the expense itself, against a target that is now known. */
function ExpenseForm({
  group,
  editing,
  prefillAmount,
  prefillDescription,
  prefillCategory,
}: {
  group: Group;
  editing?: Expense;
  prefillAmount?: string;
  prefillDescription?: string;
  prefillCategory?: string;
}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();

  const people = useStore((s) => s.people);
  const meId = useStore((s) => s.meId);
  const addExpense = useStore((s) => s.addExpense);
  const editExpense = useStore((s) => s.editExpense);
  // Pulls the new edit-log entry down so the history is already there when the
  // user lands back on the detail screen.
  const refresh = useAuth((s) => s.refresh);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const memberIds = group.memberIds;
  const currency = group.currency;
  // A personal expense has one member who both paid and consumed it, so the
  // payer picker and the split editor would each be a single unchangeable row.
  const solo = group.type === 'personal';

  // Scanned receipts arrive as query params; amount is already in minor units.
  const [description, setDescription] = useState(editing?.description ?? prefillDescription ?? '');
  const [amountText, setAmountText] = useState(() => {
    if (editing) return (editing.amount / 100).toFixed(2);
    return prefillAmount && Number(prefillAmount) > 0
      ? (Number(prefillAmount) / 100).toFixed(2)
      : '';
  });
  const [category, setCategory] = useState(editing?.category ?? prefillCategory ?? 'general');
  /**
   * True once the user picks a category themselves, which stops the guesser
   * from overwriting a deliberate choice on the next keystroke. An edit or a
   * scanned receipt arrives with a category already decided, so both count as
   * touched from the start.
   */
  const [categoryTouched, setCategoryTouched] = useState(
    Boolean(editing || prefillCategory)
  );
  const [autoPicked, setAutoPicked] = useState(false);
  const categories = useCategories();
  const addCategory = useSettings((st) => st.addCategory);
  const learnedCategories = useSettings((st) => st.learnedCategories);
  const learnCategory = useSettings((st) => st.learnCategory);
  const [namingCategory, setNamingCategory] = useState(false);
  const [paidById, setPaidById] = useState(
    editing && editing.paidBy.length === 1 ? editing.paidBy[0].personId : meId
  );
  // Multi-payer is off by default: one person paying is overwhelmingly the
  // common case, and showing four amount fields for it would be noise.
  const [multiPayer, setMultiPayer] = useState((editing?.paidBy.length ?? 0) > 1);
  const [payerInputs, setPayerInputs] = useState<Record<string, string>>(() =>
    editing
      ? Object.fromEntries(editing.paidBy.map((p) => [p.personId, (p.amount / 100).toFixed(2)]))
      : {}
  );
  const [participants, setParticipants] = useState<string[]>(
    editing ? editing.splits.map((s) => s.personId) : memberIds
  );
  // An equal split recomputes exactly, so it survives a round trip. The other
  // methods do not: only the resulting amounts were stored, and percentages or
  // shares cannot be recovered from them without re-rounding and quietly moving
  // money. Reopening them as exact amounts keeps every paisa where it was, and
  // the user can switch method back if that is what they actually want.
  const [method, setMethod] = useState<SplitMethod>(
    editing ? (editing.splitMethod === 'equal' ? 'equal' : 'exact') : 'equal'
  );
  const [inputs, setInputs] = useState<Record<string, string>>(() =>
    editing && editing.splitMethod !== 'equal'
      ? Object.fromEntries(editing.splits.map((s) => [s.personId, (s.amount / 100).toFixed(2)]))
      : {}
  );

  // Follow the description until the user overrides it. Cheap enough to run on
  // every keystroke because the guesser is local — no request, no key.
  useEffect(() => {
    if (categoryTouched) return;
    const guess = suggestCategory(description, learnedCategories);
    setCategory(guess ?? 'general');
    setAutoPicked(Boolean(guess));
  }, [description, categoryTouched, learnedCategories]);

  const amount = parseAmount(amountText);

  // Preview the exact split the user is about to save, so a mismatch is
  // visible before they commit rather than surfacing as a wrong balance later.
  const splits = useMemo(() => {
    const numeric: Record<string, number> = {};
    for (const id of participants) {
      const raw = inputs[id] ?? '';
      numeric[id] =
        method === 'exact' || method === 'adjust' || method === 'reduce'
          ? parseAmount(raw)
          : Number(raw) || 0;
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

  const save = async () => {
    const numeric: Record<string, number> = {};
    for (const id of participants) {
      const raw = inputs[id] ?? '';
      numeric[id] =
        method === 'exact' || method === 'adjust' || method === 'reduce'
          ? parseAmount(raw)
          : Number(raw) || 0;
    }
    // Remember a category the user chose themselves, so the next expense with
    // the same words does not need correcting again. Only their own picks —
    // learning from the guesser's own output would just entrench its mistakes.
    if (categoryTouched) learnCategory(description, category);

    const input = {
      groupId: group.id,
      description,
      amount,
      currency,
      category,
      paidById: multiPayer ? undefined : paidById,
      paidBy: multiPayer ? payers : undefined,
      participantIds: participants,
      splitMethod: method,
      splitInputs: numeric,
    };

    if (editing) {
      setSaving(true);
      setSaveError('');
      // Unlike adding, this waits: the server is the only side that can refuse
      // an edit, and navigating away first would hide the refusal.
      const result = await editExpense(editing.id, {
        ...input,
        date: editing.date,
        notes: editing.notes,
      });
      setSaving(false);
      if (!result.ok) {
        setSaveError(result.error ?? 'Could not save the edit');
        return;
      }
      void refresh();
      router.back();
      return;
    }

    addExpense(input);
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen
        options={{
          title: editing
            ? 'Edit expense'
            : solo
              ? 'Personal expense'
              : `Add to ${group.name}`,
        }}
      />
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
          onPress={() => router.replace(`/expense/scan?groupId=${group.id}`)}
          style={styles.scanRow}
        >
          <Ionicons name="camera-outline" size={20} color={c.owed} />
          <Text style={[font.bodyStrong, { color: c.owed, marginLeft: spacing.sm }]}>
            Scan a receipt instead
          </Text>
        </Pressable>

        <View style={styles.categoryHeader}>
          <SectionTitle>Category</SectionTitle>
          {autoPicked ? (
            <View style={[styles.autoBadge, { backgroundColor: c.owedTint }]}>
              <Ionicons name="sparkles-outline" size={11} color={c.owed} />
              <Text style={[font.tiny, { color: c.owed, marginLeft: 4 }]}>Auto</Text>
            </View>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {categories.map((key) => {
            const active = category === key;
            return (
              <Pressable
                key={key}
                onPress={() => {
                  setCategory(key);
                  setCategoryTouched(true);
                  setAutoPicked(false);
                }}
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
            if (clean) {
              setCategory(clean);
              setCategoryTouched(true);
              setAutoPicked(false);
            }
            setNamingCategory(false);
          }}
          onCancel={() => setNamingCategory(false)}
        />

        {solo ? (
          <Text style={styles.hint}>
            This one is yours alone — nobody is splitting it with you, so it
            never touches anyone's balance.
          </Text>
        ) : (
          <>
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
                        placeholder={
                          method === 'percent'
                            ? '%'
                            : method === 'shares'
                              ? 'shares'
                              : method === 'adjust'
                                ? '+extra'
                                : method === 'reduce'
                                  ? '−less'
                                  : '0.00'
                        }
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
          </>
        )}

        <View style={{ padding: spacing.lg }}>
          <Button
            title={editing ? 'Save changes' : 'Save expense'}
            onPress={() => void save()}
            disabled={!canSave}
            loading={saving}
          />
          {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  amountBlock: {
    padding: spacing.lg,
    backgroundColor: c.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  description: {
    ...font.h3,
    color: c.text,
    backgroundColor: c.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  currency: { fontSize: 32, fontWeight: '700', color: c.textMuted, marginRight: spacing.sm },
  amountInput: {
    flex: 1,
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: -0.8,
    color: c.text,
    padding: 0,
    ...font.numeric,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: spacing.lg,
  },
  autoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
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
