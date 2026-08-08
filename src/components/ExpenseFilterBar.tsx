import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { activeFilterCount, type ExpenseFilter } from '../lib/filters';
import { useCategories } from '../store/selectors';
import { useStore } from '../store/useStore';
import { GroupIcon } from './ui';
import { Palette, font, iconForCategory, radius, spacing, useColors } from '../theme';
import { Avatar } from './ui';

/**
 * Search box plus a collapsible filter panel.
 *
 * The search field is always visible because it is what people reach for; the
 * rest is behind a toggle so the list still starts near the top of the screen.
 * The button carries a count so a filter left on from last time is never
 * invisible — a filtered list that looks unfiltered is how people conclude
 * their expenses have vanished.
 */
export function ExpenseFilterBar({
  filter,
  onChange,
  people: peopleIds,
  compact,
  groupIds,
}: {
  filter: ExpenseFilter;
  onChange: (next: ExpenseFilter) => void;
  /** Restrict the person chips, e.g. to one group's members. */
  people?: string[];
  /** Hide the person row, for screens already scoped to one person. */
  compact?: boolean;
  /**
   * Group ids present in the data being filtered. The row only appears when
   * there is more than one, since a single-group chooser filters nothing.
   */
  groupIds?: (string | null)[];
}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const allPeople = useStore((s) => s.people);
  const allGroups = useStore((s) => s.groups);
  const meId = useStore((s) => s.meId);
  const categories = useCategories();
  const [open, setOpen] = useState(false);

  const people = peopleIds
    ? allPeople.filter((p) => peopleIds.includes(p.id))
    : allPeople;

  const count = activeFilterCount(filter);
  const set = (patch: Partial<ExpenseFilter>) => onChange({ ...filter, ...patch });

  const toggleGroup = (id: string | null) =>
    set({
      groupIds: filter.groupIds.includes(id)
        ? filter.groupIds.filter((x) => x !== id)
        : [...filter.groupIds, id],
    });

  const toggleCategory = (name: string) =>
    set({
      categories: filter.categories.includes(name)
        ? filter.categories.filter((x) => x !== name)
        : [...filter.categories, name],
    });

  return (
    <View style={styles.wrap}>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={c.textFaint} />
          <TextInput
            value={filter.query}
            onChangeText={(query) => set({ query })}
            placeholder="Search expenses, people…"
            placeholderTextColor={c.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
          />
          {filter.query ? (
            <Pressable onPress={() => set({ query: '' })} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={c.textFaint} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => setOpen((v) => !v)}
          android_ripple={{ color: c.pressed, borderless: true }}
          style={({ pressed }) => [
            styles.filterBtn,
            { borderColor: count ? c.owed : c.border, backgroundColor: pressed ? c.pressed : 'transparent' },
          ]}
        >
          <Ionicons name="options-outline" size={18} color={count ? c.owed : c.textMuted} />
          {count ? <Text style={[font.small, { color: c.owed, marginLeft: 4 }]}>{count}</Text> : null}
        </Pressable>
      </View>

      {open ? (
        <View style={styles.panel}>
          <Text style={styles.panelLabel}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {categories.map((name) => {
              const active = filter.categories.includes(name);
              return (
                <Pressable
                  key={name}
                  onPress={() => toggleCategory(name)}
                  android_ripple={{ color: c.pressed }}
                  style={({ pressed }) => [
                    styles.chip,
                    active && { backgroundColor: c.owed, borderColor: c.owed },
                    pressed && !active && { backgroundColor: c.pressed },
                  ]}
                >
                  <Ionicons
                    name={iconForCategory(name) as never}
                    size={14}
                    color={active ? c.onDark : c.textMuted}
                  />
                  <Text style={[font.small, { marginLeft: 5, color: active ? c.onDark : c.text }]}>
                    {name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {groupIds && groupIds.length > 1 ? (
            <>
              <Text style={styles.panelLabel}>Group</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {groupIds.map((id) => {
                  const group = allGroups.find((g) => g.id === id);
                  const active = filter.groupIds.includes(id);
                  return (
                    <Pressable
                      key={id ?? '__none'}
                      onPress={() => toggleGroup(id)}
                      android_ripple={{ color: c.pressed }}
                      style={({ pressed }) => [
                        styles.chip,
                        active && { backgroundColor: c.owed, borderColor: c.owed },
                        pressed && !active && { backgroundColor: c.pressed },
                      ]}
                    >
                      <GroupIcon type={group?.type ?? 'other'} size={18} />
                      <Text style={[font.small, { marginLeft: 6, color: active ? c.onDark : c.text }]}>
                        {group?.name ?? 'No group'}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          ) : null}

          {!compact && people.length > 1 ? (
            <>
              <Text style={styles.panelLabel}>Involving</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {people.map((p) => {
                  const active = filter.personId === p.id;
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => set({ personId: active ? null : p.id })}
                      android_ripple={{ color: c.pressed }}
                      style={({ pressed }) => [
                        styles.chip,
                        active && { backgroundColor: c.owed, borderColor: c.owed },
                        pressed && !active && { backgroundColor: c.pressed },
                      ]}
                    >
                      <Avatar name={p.name} colorIndex={p.colorIndex} size={18} />
                      <Text style={[font.small, { marginLeft: 6, color: active ? c.onDark : c.text }]}>
                        {p.id === meId ? 'You' : p.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          ) : null}

          <Text style={styles.panelLabel}>Dates</Text>
          <View style={styles.dateRow}>
            <TextInput
              value={filter.from}
              onChangeText={(from) => set({ from })}
              placeholder="From YYYY-MM-DD"
              placeholderTextColor={c.textFaint}
              autoCapitalize="none"
              style={styles.dateInput}
            />
            <TextInput
              value={filter.to}
              onChangeText={(to) => set({ to })}
              placeholder="To YYYY-MM-DD"
              placeholderTextColor={c.textFaint}
              autoCapitalize="none"
              style={styles.dateInput}
            />
          </View>

          <View style={styles.footerRow}>
            <Pressable
              onPress={() => set({ includeSettlements: !filter.includeSettlements })}
              style={({ pressed }) => [styles.toggle, pressed && { backgroundColor: c.pressed }]}
            >
              <Ionicons
                name={filter.includeSettlements ? 'checkbox' : 'square-outline'}
                size={18}
                color={filter.includeSettlements ? c.owed : c.textMuted}
              />
              <Text style={[font.small, { color: c.text, marginLeft: spacing.sm }]}>
                Include settlements
              </Text>
            </Pressable>
            {count ? (
              <Pressable
                onPress={() =>
                  onChange({
                    query: '',
                    categories: [],
                    groupIds: [],
                    personId: null,
                    from: '',
                    to: '',
                    includeSettlements: false,
                  })
                }
                style={({ pressed }) => [styles.toggle, pressed && { backgroundColor: c.pressed }]}
              >
                <Text style={[font.small, { color: c.owe }]}>Clear all</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    searchBox: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    },
    searchInput: {
      ...font.body,
      flex: 1,
      // Without minWidth a flex child refuses to shrink below its content
      // width, so the placeholder pushed the field past the screen edge.
      minWidth: 0,
      color: c.text,
      paddingVertical: 10,
      outlineStyle: 'none',
    } as never,
    filterBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: radius.md,
      borderWidth: 1,
    },
    panel: { marginTop: spacing.md, gap: spacing.xs },
    panelLabel: { ...font.small, color: c.textFaint, marginTop: spacing.sm },
    chips: { gap: spacing.sm, paddingVertical: 4 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.border,
    },
    dateRow: { flexDirection: 'row', gap: spacing.sm },
    dateInput: {
      ...font.small,
      flex: 1,
      minWidth: 0,
      color: c.text,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      outlineStyle: 'none',
    } as never,
    footerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.sm,
    },
    toggle: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 6,
      borderRadius: radius.sm,
    },
  });
