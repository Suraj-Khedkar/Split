import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar, Button, SectionTitle } from '../../src/components/ui';
import { balanceBetween } from '../../src/lib/balances';
import { currencySymbol, formatAmount, formatMoney, parseAmount } from '../../src/lib/money';
import { useGroupSummary } from '../../src/store/selectors';
import { personName, useStore } from '../../src/store/useStore';
import { Palette, font, radius, spacing, useColors } from '../../src/theme';

export default function SettleScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { groupId, friendId } = useLocalSearchParams<{ groupId: string; friendId?: string }>();
  const router = useRouter();

  const groups = useStore((s) => s.groups);
  const people = useStore((s) => s.people);
  const expenses = useStore((s) => s.expenses);
  const meId = useStore((s) => s.meId);
  const settleUp = useStore((s) => s.settleUp);

  // "none" means settling with a friend outside any group.
  const group = groups.find((g) => g.id === groupId);
  const currency = group?.currency ?? 'INR';
  const { debts } = useGroupSummary(group?.id ?? '');

  const candidates = group
    ? group.memberIds.filter((id) => id !== meId)
    : people.filter((p) => p.id !== meId).map((p) => p.id);

  const [withId, setWithId] = useState(friendId ?? candidates[0] ?? '');
  const suggested = group
    ? debts.find((d) => d.fromId === meId && d.toId === withId)?.amount ??
      debts.find((d) => d.fromId === withId && d.toId === meId)?.amount ??
      Math.abs(balanceBetween(expenses, meId, withId))
    : Math.abs(balanceBetween(expenses, meId, withId));

  const [amountText, setAmountText] = useState(formatAmount(suggested, currency));
  const amount = parseAmount(amountText);
  const net = balanceBetween(expenses, meId, withId);
  // net > 0 means they owe you, so they are the payer.
  const iAmPayer = net < 0;

  const record = () => {
    if (amount <= 0) return;
    const fromId = iAmPayer ? meId : withId;
    const toId = iAmPayer ? withId : meId;
    // Settling with a friend outside any group still has to land in one, or
    // the server has nowhere to put it and the row vanishes on the next sync.
    const target =
      group?.id ??
      groups.find((g) => g.memberIds.includes(meId) && g.memberIds.includes(withId))?.id ??
      null;
    settleUp(fromId, toId, amount, target, currency);
    router.back();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: 'Settle up' }} />

      <SectionTitle>With</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {candidates.map((id) => {
          const person = people.find((p) => p.id === id);
          if (!person) return null;
          const active = withId === id;
          return (
            <Pressable
              key={id}
              onPress={() => {
                setWithId(id);
                setAmountText(formatAmount(Math.abs(balanceBetween(expenses, meId, id)), currency));
              }}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Avatar name={person.name} colorIndex={person.colorIndex} size={22} />
              <Text style={[font.small, { marginLeft: 6, color: active ? c.onDark : c.text }]}>
                {person.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.summary}>
        <Text style={[font.body, { color: c.textMuted, textAlign: 'center' }]}>
          {net === 0
            ? 'You are already settled up'
            : iAmPayer
            ? `You owe ${personName(people, withId, meId)} ${formatMoney(Math.abs(net), currency)}`
            : `${personName(people, withId, meId)} owes you ${formatMoney(Math.abs(net), currency)}`}
        </Text>
      </View>

      <SectionTitle>Amount</SectionTitle>
      <View style={styles.amountRow}>
        <Text style={styles.currency}>{currencySymbol(currency)}</Text>
        <TextInput
          value={amountText}
          onChangeText={setAmountText}
          keyboardType="decimal-pad"
          style={styles.amountInput}
          placeholder="0.00"
          placeholderTextColor={c.textFaint}
        />
      </View>

      <View style={{ padding: spacing.lg }}>
        <Button
          title={
            amount > 0
              ? iAmPayer
                ? `You paid ${formatMoney(amount, currency)}`
                : `${personName(people, withId, meId)} paid ${formatMoney(amount, currency)}`
              : 'Record payment'
          }
          onPress={record}
          disabled={amount <= 0 || !withId}
        />
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
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
  summary: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
  amountRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg },
  currency: { fontSize: 30, fontWeight: '700', color: c.textMuted, marginRight: spacing.sm },
  amountInput: { flex: 1, fontSize: 34, fontWeight: '700', color: c.text, padding: 0 },
});
