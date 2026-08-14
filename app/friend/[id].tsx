import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  Avatar,
  Button,
  ConfirmDialog,
  Divider,
  EmptyState,
  Row,
} from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { balanceBetween } from '../../src/lib/balances';
import { describeEntry } from '../../src/lib/entries';
import { formatMoney } from '../../src/lib/money';
import { usePersonExpenses } from '../../src/store/selectors';
import { useAuth } from '../../src/store/useAuth';
import { personName, useStore } from '../../src/store/useStore';
import { Palette, balanceColor, font, spacing, useColors } from '../../src/theme';

export default function FriendScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const people = useStore((s) => s.people);
  const groups = useStore((s) => s.groups);
  const expenses = useStore((s) => s.expenses);
  const meId = useStore((s) => s.meId);
  const friendIds = useStore((s) => s.friendIds);
  const refresh = useAuth((s) => s.refresh);
  // Declared before the early return below, or the hook order changes.
  const [confirming, setConfirming] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [removing, setRemoving] = useState(false);

  const person = people.find((p) => p.id === id);
  const shared = usePersonExpenses(id ?? '').filter((e) =>
    e.paidBy.some((p) => p.personId === meId) || e.splits.some((s) => s.personId === meId)
  );
  const net = balanceBetween(expenses, meId, id ?? '');

  if (!person) return <EmptyState icon="alert-circle-outline" title="Friend not found" />;

  const isFriend = friendIds.includes(person.id);
  // Named locally so the message can list them; the server checks this too and
  // is the one that actually refuses — this only saves a pointless round trip.
  const sharedGroups = groups.filter(
    (g) => g.type !== 'personal' && g.memberIds.includes(meId) && g.memberIds.includes(person.id)
  );

  const removeFriend = async () => {
    setConfirming(false);
    setRemoving(true);
    setRemoveError('');
    try {
      await api.removeFriend(person.id);
      await refresh();
      router.back();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : 'Could not remove that friend');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: person.name }} />
      <View style={styles.header}>
        <Avatar name={person.name} colorIndex={person.colorIndex} size={64} />
        <Text style={[font.h2, { marginTop: spacing.md }, { color: c.text }]}>{person.name}</Text>
        <Text style={[font.body, { color: c.textMuted, marginTop: 2 }]}>
          {net === 0 ? (
            'You are all settled up'
          ) : (
            <>
              {net > 0 ? `${person.name} owes you ` : `You owe ${person.name} `}
              <Text style={{ color: balanceColor(net, c), fontWeight: '700' }}>
                {formatMoney(Math.abs(net))}
              </Text>
            </>
          )}
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignSelf: 'stretch' }}>
          {net !== 0 ? (
            <Button
              title="Settle up"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => router.push(`/settle/none?friendId=${person.id}`)}
            />
          ) : null}
          <Button
            title="Report"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => router.push(`/report/friend?friendId=${person.id}`)}
          />
        </View>
      </View>

      {isFriend ? (
        <View style={{ padding: spacing.lg }}>
          <Button
            title="Remove friend"
            variant="secondary"
            loading={removing}
            onPress={() => {
              if (sharedGroups.length) {
                setRemoveError(
                  `You still share ${sharedGroups.length === 1 ? 'a group' : 'groups'} with ${person.name} (${sharedGroups
                    .map((g) => g.name)
                    .join(', ')}). Leave ${sharedGroups.length === 1 ? 'it' : 'those'} first.`
                );
                return;
              }
              setConfirming(true);
            }}
          />
          {removeError ? (
            <Text style={[font.small, { color: c.owe, marginTop: spacing.sm }]}>
              {removeError}
            </Text>
          ) : null}
        </View>
      ) : null}

      <ConfirmDialog
        visible={confirming}
        title={`Remove ${person.name}?`}
        message="You will drop off each other's friend lists. Shared history stays where it is."
        confirmLabel="Remove"
        destructive
        onConfirm={() => void removeFriend()}
        onCancel={() => setConfirming(false)}
      />

      {shared.length === 0 ? (
        <EmptyState icon="receipt-outline" title="Nothing shared yet" />
      ) : (
        shared.map((expense, index) => {
          const group = groups.find((g) => g.id === expense.groupId);
          const entry = describeEntry(expense, people, meId);
          return (
            <View key={expense.id}>
              <Row
                title={entry.title}
                subtitle={
                  entry.isPayback
                    ? // A payback settled a debt; who "paid" the bill is not the
                      // interesting fact, the fact that it cleared is.
                      `Payback · ${formatMoney(expense.amount, expense.currency)}`
                    : `${group?.name ?? 'No group'} · ${personName(
                        people,
                        expense.paidBy[0]?.personId ?? '',
                        meId
                      )} paid ${formatMoney(expense.amount, expense.currency)}`
                }
                right={
                  entry.isPayback ? (
                    <Text style={[font.small, { color: c.settled }]}>settled</Text>
                  ) : (
                    <Text style={[font.bodyStrong, { color: balanceColor(entry.delta, c) }]}>
                      {entry.delta === 0
                        ? '—'
                        : formatMoney(Math.abs(entry.delta), expense.currency)}
                    </Text>
                  )
                }
                onPress={() => router.push(`/expense/${expense.id}`)}
              />
              {index < shared.length - 1 ? <Divider /> : null}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  header: {
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
});
