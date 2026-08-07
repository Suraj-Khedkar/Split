import React from 'react';
import { FlatList, Text, View } from 'react-native';

import { Avatar, Divider, EmptyState, Row } from '../../src/components/ui';
import { formatMoney } from '../../src/lib/money';
import { personName, useStore } from '../../src/store/useStore';
import { balanceColor, font, useColors } from '../../src/theme';

export default function ActivityScreen() {
  const c = useColors();
  const expenses = useStore((s) => s.expenses);
  const people = useStore((s) => s.people);
  const groups = useStore((s) => s.groups);
  const meId = useStore((s) => s.meId);

  const feed = [...expenses].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={feed}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={
          <EmptyState icon="pulse-outline" title="Nothing here yet" body="Expenses you add will show up in this feed." />
        }
        renderItem={({ item }) => {
          const payer = item.paidBy[0];
          const payerName = personName(people, payer?.personId ?? '', meId);
          const group = groups.find((g) => g.id === item.groupId);
          const person = people.find((p) => p.id === payer?.personId);

          // What this entry did to *your* balance, which is the only number
          // that matters at a glance.
          const myShare = item.splits.find((s) => s.personId === meId)?.amount ?? 0;
          const myPaid = item.paidBy.find((p) => p.personId === meId)?.amount ?? 0;
          const delta = myPaid - myShare;

          const headline = item.isSettlement
            ? `${payerName} paid ${personName(people, item.splits[0]?.personId ?? '', meId)}`
            : `${payerName} added "${item.description}"`;

          return (
            <Row
              left={<Avatar name={person?.name ?? '?'} colorIndex={person?.colorIndex ?? 0} size={36} />}
              title={headline}
              subtitle={
                <Text style={[font.small, { color: c.textMuted, marginTop: 2 }]}>
                  {group ? group.name + ' · ' : ''}
                  {formatMoney(item.amount, item.currency)}
                  {delta !== 0 ? (
                    <Text style={{ color: balanceColor(delta, c), fontWeight: '600' }}>
                      {'  '}
                      {delta > 0 ? 'you lent ' : 'you borrowed '}
                      {formatMoney(Math.abs(delta), item.currency)}
                    </Text>
                  ) : null}
                </Text>
              }
            />
          );
        }}
      />
    </View>
  );
}
