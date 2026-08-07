import { useRouter } from 'expo-router';
import React from 'react';
import { FlatList, View } from 'react-native';

import { Avatar, BalanceLabel, Divider, EmptyState, Fab, Row } from '../../src/components/ui';
import { useFriendBalances } from '../../src/store/selectors';
import { useStore } from '../../src/store/useStore';
import { useColors } from '../../src/theme';

export default function FriendsScreen() {
  const c = useColors();
  const router = useRouter();
  const people = useStore((s) => s.people);
  const meId = useStore((s) => s.meId);
  const balances = useFriendBalances();

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={balances}
        keyExtractor={(item) => item.personId}
        ItemSeparatorComponent={Divider}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListEmptyComponent={
          <EmptyState
            icon="person-add-outline"
            title="No friends yet"
            body="People you add to a group show up here with their running balance."
          />
        }
        renderItem={({ item }) => {
          const person = people.find((p) => p.id === item.personId);
          if (!person) return null;
          return (
            <Row
              left={<Avatar name={person.name} colorIndex={person.colorIndex} />}
              title={person.name}
              subtitle={<BalanceLabel amount={item.amount} />}
              onPress={() => router.push(`/friend/${person.id}`)}
              chevron
            />
          );
        }}
      />
      <Fab onPress={() => router.push('/friend/new')} label="Add friend" />
    </View>
  );
}
