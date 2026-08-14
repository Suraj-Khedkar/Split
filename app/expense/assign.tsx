import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, Button, Divider, EmptyState, SectionTitle } from '../../src/components/ui';
import { suggestCategory } from '../../src/lib/categorise';
import { formatMoney, splitByWeights } from '../../src/lib/money';
import { clearReceiptDraft, readReceiptDraft } from '../../src/lib/receiptDraft';
import { personName, useStore } from '../../src/store/useStore';
import { Palette, font, radius, spacing, useColors } from '../../src/theme';

/**
 * Turn a scanned receipt into a split, dish by dish.
 *
 * The scan screen could only ever hand back one number — a total — which threw
 * away the part of the receipt that actually says who owes what. Here each line
 * is assigned to the people who ate it, and everyone pays for their own.
 */
export default function AssignReceiptScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();

  const groups = useStore((s) => s.groups);
  const people = useStore((s) => s.people);
  const meId = useStore((s) => s.meId);
  const addExpense = useStore((s) => s.addExpense);

  const draft = readReceiptDraft();
  const group = groups.find((g) => g.id === (groupId ?? draft?.groupId));
  const memberIds = group?.memberIds ?? [];

  /** itemIndex -> the people sharing that line. Everyone, to begin with. */
  const [shared, setShared] = useState<Record<number, string[]>>(() => {
    const initial: Record<number, string[]> = {};
    (draft?.items ?? []).forEach((_, i) => {
      initial[i] = memberIds;
    });
    return initial;
  });
  const [equally, setEqually] = useState(false);
  const [busy, setBusy] = useState(false);

  const total = draft?.total ?? 0;

  /**
   * What each person owes, before rounding.
   *
   * Fed to splitByWeights rather than used directly, which does two jobs at
   * once: it absorbs the rounding remainder, and it scales everyone up to the
   * receipt's own total — so tax and service, which never appear as line items,
   * are shared in proportion to what each person actually ordered.
   */
  const weights = useMemo(() => {
    if (equally) return memberIds.map(() => 1);
    const owed = new Map<string, number>(memberIds.map((id) => [id, 0]));
    (draft?.items ?? []).forEach((item, index) => {
      const eaters = shared[index] ?? [];
      if (eaters.length === 0) return;
      const each = item.amount / eaters.length;
      for (const id of eaters) owed.set(id, (owed.get(id) ?? 0) + each);
    });
    return memberIds.map((id) => owed.get(id) ?? 0);
  }, [equally, memberIds, shared, draft]);

  const amounts = useMemo(() => splitByWeights(total, weights), [total, weights]);

  if (!draft || !group) {
    return (
      <>
        <Stack.Screen options={{ title: 'Assign items' }} />
        <EmptyState
          icon="receipt-outline"
          title="No receipt to assign"
          body="Scan one first, then come back here."
        />
      </>
    );
  }

  const toggle = (index: number, personId: string) =>
    setShared((prev) => {
      const current = prev[index] ?? [];
      return {
        ...prev,
        [index]: current.includes(personId)
          ? current.filter((id) => id !== personId)
          : [...current, personId],
      };
    });

  const create = () => {
    setBusy(true);
    const description = draft.merchant?.trim() || 'Receipt';
    addExpense({
      groupId: group.id,
      description,
      amount: total,
      currency: group.currency,
      category: suggestCategory(description) ?? 'food',
      paidById: meId,
      participantIds: memberIds,
      // Exact, because the per-person figures are already reconciled to the
      // total above; re-deriving them from a method would only round twice.
      splitMethod: 'exact',
      splitInputs: Object.fromEntries(memberIds.map((id, i) => [id, amounts[i]])),
    });
    clearReceiptDraft();
    router.replace(`/group/${group.id}`);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: 'Who had what?' }} />

      <View style={styles.header}>
        <Text style={[font.small, { color: c.textMuted }]}>
          {draft.merchant || 'Receipt'}
        </Text>
        <Text style={[font.h1, font.numeric, { color: c.text }]}>
          {formatMoney(total, group.currency)}
        </Text>

        <View style={styles.modes}>
          {[
            { key: false, label: 'By item' },
            { key: true, label: 'Split equally' },
          ].map((mode) => {
            const active = equally === mode.key;
            return (
              <Pressable
                key={String(mode.key)}
                onPress={() => setEqually(mode.key)}
                style={[
                  styles.mode,
                  { borderColor: active ? c.owed : c.border },
                  active && { backgroundColor: c.owed },
                ]}
              >
                <Text style={[font.small, { color: active ? c.onDark : c.text }]}>
                  {mode.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {equally ? null : (
        <>
          <SectionTitle>Items</SectionTitle>
          {draft.items.map((item, index) => {
            const eaters = shared[index] ?? [];
            return (
              <View key={`${item.label}-${index}`} style={styles.item}>
                <View style={styles.itemHead}>
                  <Text style={[font.bodyStrong, { color: c.text, flex: 1 }]} numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Text style={[font.bodyStrong, font.numeric, { color: c.text }]}>
                    {formatMoney(item.amount, group.currency)}
                  </Text>
                </View>

                <View style={styles.eaters}>
                  {memberIds.map((id) => {
                    const person = people.find((p) => p.id === id);
                    const on = eaters.includes(id);
                    return (
                      <Pressable
                        key={id}
                        onPress={() => toggle(index, id)}
                        style={[
                          styles.eater,
                          { borderColor: on ? c.owed : c.border },
                          on && { backgroundColor: c.owedTint },
                        ]}
                      >
                        <Avatar
                          name={person?.name ?? '?'}
                          colorIndex={person?.colorIndex ?? 0}
                          size={22}
                        />
                        <Text
                          style={[
                            font.small,
                            { color: on ? c.text : c.textFaint, marginLeft: 6 },
                          ]}
                        >
                          {personName(people, id, meId)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {eaters.length === 0 ? (
                  <Text style={[font.small, { color: c.owe, marginTop: spacing.sm }]}>
                    Nobody assigned — this line is shared by everyone.
                  </Text>
                ) : null}
              </View>
            );
          })}
        </>
      )}

      <SectionTitle>Each person pays</SectionTitle>
      {memberIds.map((id, index) => {
        const person = people.find((p) => p.id === id);
        return (
          <View key={id}>
            <View style={styles.owedRow}>
              <Avatar name={person?.name ?? '?'} colorIndex={person?.colorIndex ?? 0} size={34} />
              <Text style={[font.body, { color: c.text, flex: 1, marginLeft: spacing.md }]}>
                {personName(people, id, meId)}
              </Text>
              <Text style={[font.bodyStrong, font.numeric, { color: c.text }]}>
                {formatMoney(amounts[index] ?? 0, group.currency)}
              </Text>
            </View>
            {index < memberIds.length - 1 ? <Divider /> : null}
          </View>
        );
      })}

      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Text style={[font.small, { color: c.textFaint }]}>
          <Ionicons name="information-circle-outline" size={13} /> Tax and service are
          shared in proportion to what each person ordered.
        </Text>
        <Button title="Add this expense" onPress={create} loading={busy} />
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    header: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      backgroundColor: c.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    modes: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    mode: {
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    item: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      backgroundColor: c.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    itemHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    eaters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    eater: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    owedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      backgroundColor: c.card,
    },
  });
