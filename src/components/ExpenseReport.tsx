import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { describeEntry } from '../lib/entries';
import { emptyFilter, filterExpenses, isFilterActive, type ExpenseFilter } from '../lib/filters';
import { formatMoney } from '../lib/money';
import { bucketSpend, buildReport, shareForPerson } from '../lib/reports';
import { personName, useStore } from '../store/useStore';
import { balanceColor, font, iconForCategory, spacing, useColors } from '../theme';
import type { Expense } from '../types';
import {
  ChartPicker,
  NetBars,
  RankedBars,
  Segmented,
  ShareBar,
  StatTile,
  TrendChart,
  ZoomControl,
  ZOOM_STEPS,
  type TrendType,
} from './charts';
import { ExpenseFilterBar } from './ExpenseFilterBar';
import { Avatar, Divider, EmptyState, Row, SectionTitle } from './ui';

type Range = '3m' | '6m' | '12m' | 'all';

const RANGES: { value: Range; label: string }[] = [
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: '12m', label: '12M' },
  { value: 'all', label: 'All' },
];

const MONTHS_BACK: Record<Range, number> = { '3m': 3, '6m': 6, '12m': 12, all: 0 };

/** YYYY-MM-DD cutoff n months before today, or '' for no cutoff. */
function cutoffFor(range: Range): string {
  const months = MONTHS_BACK[range];
  if (!months) return '';
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return MONTH_NAMES[m - 1] + (m === 1 ? ` ${String(y).slice(2)}` : '');
}

/** Handles both YYYY-MM and the YYYY-Www keys the week bucketing produces. */
function bucketLabel(key: string): string {
  return key.includes('-W') ? key.slice(key.indexOf('-W') + 1) : monthLabel(key);
}

/** First and last day of a YYYY-MM, for turning a tapped column into a filter. */
function monthBounds(key: string): { from: string; to: string } {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, '0')}` };
}

/**
 * The report body, shared by the group and person screens.
 *
 * Everything on screen derives from one filter. Tapping a category bar, a
 * person, or a month writes to that same filter, so the charts, the totals and
 * the expense list below can never disagree about what is being shown — and
 * the search box reaches the charts, not just the list.
 */
export function ExpenseReport({
  expenses,
  currency,
  subjectId,
  mode,
  memberIds,
}: {
  expenses: Expense[];
  currency: string;
  /** Whose share to headline. Omit for a pure group view. */
  subjectId?: string;
  mode: 'group' | 'person' | 'personal';
  memberIds?: string[];
}) {
  const c = useColors();
  const router = useRouter();
  const people = useStore((s) => s.people);
  const groups = useStore((s) => s.groups);
  const meId = useStore((s) => s.meId);

  // 27 months of history does not fit across a phone, and squeezing it makes
  // every column unreadable. A year is the default window; All stays available.
  const [range, setRange] = useState<Range>('12m');
  const [filter, setFilter] = useState<ExpenseFilter>(emptyFilter);
  const [trendType, setTrendType] = useState<TrendType>('columns');
  const [grain, setGrain] = useState<'month' | 'week'>('month');
  const [zoom, setZoom] = useState(2);
  const [categoryChart, setCategoryChart] = useState<'bars' | 'share'>('bars');

  const scoped = useMemo(() => {
    const cutoff = cutoffFor(range);
    const byRange = cutoff
      ? expenses.filter((e) => (e.date || e.createdAt.slice(0, 10)) >= cutoff)
      : expenses;
    return filterExpenses(byRange, filter, people);
  }, [expenses, range, filter, people]);

  const report = useMemo(() => buildReport(scoped, subjectId), [scoped, subjectId]);

  const personal = mode === 'personal';

  /**
   * Groups the incoming expenses actually touch — the chooser's options,
   * sorted by name so the chips do not reshuffle as expenses come and go.
   */
  const scopeGroupIds = useMemo(() => {
    const seen = new Set<string | null>();
    for (const e of expenses) seen.add(e.groupId);
    const nameOf = (id: string | null) =>
      id === null ? '\uffff' : (groups.find((g) => g.id === id)?.name ?? '\uffff');
    return [...seen].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  }, [expenses, groups]);

  const trendPoints = useMemo(
    () =>
      // In a personal report every series is the subject's slice, not the
      // whole bill, so the chart and the headline describe the same money.
      bucketSpend(scoped, grain, personal ? subjectId : undefined).map((p) => ({
        key: p.month,
        label: bucketLabel(p.month),
        value: p.amount,
      })),
    [scoped, grain, personal, subjectId]
  );

  // The unfiltered report, so "X% of the total" can mean the period total
  // rather than the total of whatever is currently selected.
  const periodTotal = useMemo(() => {
    const cutoff = cutoffFor(range);
    const byRange = cutoff
      ? expenses.filter((e) => (e.date || e.createdAt.slice(0, 10)) >= cutoff)
      : expenses;
    return buildReport(byRange).total;
  }, [expenses, range]);

  if (!expenses.length) {
    return (
      <EmptyState
        icon="bar-chart-outline"
        title="Nothing to report yet"
        body="Add a few expenses and this fills in with where the money went."
      />
    );
  }

  const subjectShare = report.subject?.share ?? 0;
  const sharePct = report.total > 0 ? Math.round((subjectShare / report.total) * 100) : 0;
  const filtered = isFilterActive(filter);

  /**
   * Monthly series at the report's own scope.
   *
   * Personal mode reads the subject's share here too. Reading report.byMonth
   * instead made "busiest month" quote the group's figure while the chart
   * directly above it plotted the subject's — two different numbers for the
   * same month, on the same screen.
   */
  const monthSeries = useMemo(
    () => bucketSpend(scoped, 'month', personal ? subjectId : undefined),
    [scoped, personal, subjectId]
  );
  const headlineTotal = personal ? report.subject?.share ?? 0 : report.total;
  const monthsWithSpend = monthSeries.filter((m) => m.amount > 0);
  const perMonth = monthsWithSpend.length
    ? Math.round(headlineTotal / monthsWithSpend.length)
    : 0;
  const busiest = monthSeries.reduce(
    (best, m) => (!best || m.amount > best.amount ? m : best),
    null as { month: string; amount: number } | null
  );
  const topPayer = [...report.byMember].sort((a, b) => b.paid - a.paid)[0] ?? null;

  /** Largest single slice the subject carried, for the personal "Biggest" tile. */
  const biggestOwnShare = useMemo(() => {
    if (!personal || !subjectId) return null;
    let best: { amount: number; description: string } | null = null;
    for (const e of scoped) {
      if (e.isSettlement) continue;
      const mine = shareForPerson(e, subjectId);
      if (mine > 0 && (!best || mine > best.amount)) {
        best = { amount: mine, description: e.description };
      }
    }
    return best;
  }, [scoped, personal, subjectId]);

  const toggleCategory = (name: string) =>
    setFilter((f) => ({
      ...f,
      categories: f.categories.includes(name)
        ? f.categories.filter((x) => x !== name)
        : [...f.categories, name],
    }));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        <Segmented options={RANGES} value={range} onChange={setRange} />
      </View>

      <ExpenseFilterBar
        filter={filter}
        onChange={setFilter}
        people={memberIds}
        compact={mode !== 'group'}
        groupIds={mode === 'group' ? undefined : scopeGroupIds}
      />

      {filtered ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          <Text style={[font.small, { color: c.owed }]}>
            Filtered to {report.count} expense{report.count === 1 ? '' : 's'} — every
            figure below reflects it.
          </Text>
        </View>
      ) : null}

      <View style={{ padding: spacing.lg, gap: spacing.lg }}>
        {report.count === 0 ? (
          <Text style={[font.body, { color: c.textMuted }]}>
            Nothing matches. Widen the range or clear a filter.
          </Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: spacing.lg }}>
              {personal ? (
                <>
                  {/* A personal report leads with what you spent, not what the
                      groups spent around you. */}
                  <StatTile
                    label="You spent"
                    value={formatMoney(subjectShare, currency)}
                    hint={`across ${report.count} expense${report.count === 1 ? '' : 's'}`}
                    hero
                  />
                  <StatTile
                    label="You paid out"
                    value={formatMoney(report.subject?.paid ?? 0, currency)}
                    hint={
                      (report.subject?.net ?? 0) >= 0
                        ? `${formatMoney(report.subject?.net ?? 0, currency)} still owed to you`
                        : `${formatMoney(Math.abs(report.subject?.net ?? 0), currency)} you still owe`
                    }
                  />
                </>
              ) : (
                <>
                  <StatTile
                    label="Total spent"
                    value={formatMoney(report.total, currency)}
                    hint={`${report.count} expense${report.count === 1 ? '' : 's'}`}
                    hero
                  />
                  {subjectId ? (
                    <StatTile
                      label={subjectId === meId ? 'Your share' : 'Their share'}
                      value={formatMoney(subjectShare, currency)}
                      hint={`${sharePct}% of what is shown`}
                    />
                  ) : (
                    <StatTile
                      label="Average"
                      value={formatMoney(report.average, currency)}
                      hint="per expense"
                    />
                  )}
                </>
              )}
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.lg }}>
              <StatTile
                label="Per month"
                value={formatMoney(
                  personal && monthsWithSpend.length
                    ? Math.round(subjectShare / monthsWithSpend.length)
                    : perMonth,
                  currency
                )}
                hint={`across ${monthsWithSpend.length} active month${monthsWithSpend.length === 1 ? '' : 's'}`}
              />
              <StatTile
                label="Average expense"
                value={formatMoney(report.average, currency)}
                hint={`${report.byCategory.length} categor${report.byCategory.length === 1 ? 'y' : 'ies'}`}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.lg }}>
              <StatTile
                label={personal ? 'Your biggest' : 'Biggest'}
                value={formatMoney(
                  (personal ? biggestOwnShare?.amount : report.largest?.amount) ?? 0,
                  currency
                )}
                hint={(personal ? biggestOwnShare?.description : report.largest?.description) ?? ''}
              />
              <StatTile
                label="Busiest month"
                value={busiest ? formatMoney(busiest.amount, currency) : '—'}
                hint={busiest ? monthLabel(busiest.month) : ''}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.lg }}>
              <StatTile
                label="Settled up"
                value={formatMoney(report.settledTotal, currency)}
                hint={`${report.settledCount} payment${report.settledCount === 1 ? '' : 's'}`}
              />
              {personal ? (
                <StatTile
                  label="Share of the bill"
                  value={`${report.total ? Math.round((subjectShare / report.total) * 100) : 0}%`}
                  hint={`of ${formatMoney(report.total, currency)} spent around you`}
                />
              ) : topPayer ? (
                <StatTile
                  label="Paid the most"
                  value={formatMoney(topPayer.paid, currency)}
                  hint={personName(people, topPayer.personId, meId)}
                />
              ) : (
                <StatTile label="Share of period" value={`${periodTotal ? Math.round((report.total / periodTotal) * 100) : 100}%`} hint="of this period" />
              )}
            </View>
          </>
        )}
      </View>

      {report.count > 0 ? (
        <>
          <Divider />
          <SectionTitle>Spending over time</SectionTitle>
          <View style={{ paddingHorizontal: spacing.lg }}>
            <View style={styles.chartControls}>
              <ChartPicker
                options={[
                  { value: 'columns' as TrendType, icon: 'stats-chart-outline', label: 'Bars' },
                  { value: 'line' as TrendType, icon: 'trending-up-outline', label: 'Line' },
                ]}
                value={trendType}
                onChange={setTrendType}
              />
              <ChartPicker
                options={[
                  { value: 'month' as const, icon: 'calendar-outline', label: 'Month' },
                  { value: 'week' as const, icon: 'calendar-number-outline', label: 'Week' },
                ]}
                value={grain}
                onChange={setGrain}
              />
            </View>

            <TrendChart
              points={trendPoints}
              currency={currency}
              type={trendType}
              bucketWidth={ZOOM_STEPS[zoom]}
              selectedKey={
                grain === 'month' && filter.from && filter.from.slice(0, 7) === filter.to.slice(0, 7)
                  ? filter.from.slice(0, 7)
                  : null
              }
              onSelect={(key) => {
                // Only month buckets map cleanly onto a date filter; a week key
                // would need its own bounds, so weeks stay read-only for now.
                if (grain !== 'month') return;
                setFilter((f) => ({ ...f, ...(key ? monthBounds(key) : { from: '', to: '' }) }));
              }}
            />

            <View style={styles.chartControls}>
              <ZoomControl
                index={zoom}
                onChange={(next) => setZoom(Math.max(0, Math.min(ZOOM_STEPS.length - 1, next)))}
                hint={`${trendPoints.length} ${grain === 'month' ? 'months' : 'weeks'}`}
              />
            </View>

            <Text style={[font.small, { color: c.textFaint, marginTop: spacing.sm }]}>
              {grain === 'month'
                ? 'Tap a column to narrow everything to that month. '
                : 'Zoom in and scroll sideways to read individual weeks. '}
              Settlements are left out — they move money that was already counted.
            </Text>
          </View>

          <SectionTitle>Where it went</SectionTitle>
          <View style={{ paddingHorizontal: spacing.lg }}>
            <View style={[styles.chartControls, { marginBottom: spacing.md }]}>
              <ChartPicker
                options={[
                  { value: 'bars' as const, icon: 'reorder-four-outline', label: 'Ranked' },
                  { value: 'share' as const, icon: 'pie-chart-outline', label: 'Share' },
                ]}
                value={categoryChart}
                onChange={setCategoryChart}
              />
            </View>
            {categoryChart === 'share' ? (
              <ShareBar
                currency={currency}
                activeKey={filter.categories[0] ?? null}
                onPressSlice={toggleCategory}
                slices={(personal ? report.subjectByCategory : report.byCategory).map((s) => ({
                  key: s.category,
                  label: s.category.charAt(0).toUpperCase() + s.category.slice(1),
                  value: s.amount,
                }))}
              />
            ) : (
            <RankedBars
              currency={currency}
              onPressRow={toggleCategory}
              rows={(personal ? report.subjectByCategory : report.byCategory).map((s) => ({
                key: s.category,
                label: s.category.charAt(0).toUpperCase() + s.category.slice(1),
                value: s.amount,
                note: `${Math.round(s.share * 100)}%`,
                active: filter.categories.includes(s.category),
                left: (
                  <Ionicons
                    name={iconForCategory(s.category) as never}
                    size={18}
                    color={c.textMuted}
                  />
                ),
              }))}
            />
            )}
            <Text style={[font.small, { color: c.textFaint, marginTop: spacing.xs }]}>
              Tap a category to filter by it; tap again to clear.
            </Text>
          </View>

          {mode === 'group' && report.byMember.length > 1 ? (
            <>
              <SectionTitle>Who paid, who consumed</SectionTitle>
              <View style={{ paddingHorizontal: spacing.lg }}>
                <RankedBars
                  currency={currency}
                  onPressRow={(personId) =>
                    setFilter((f) => ({ ...f, personId: f.personId === personId ? null : personId }))
                  }
                  rows={report.byMember.map((m) => ({
                    key: m.personId,
                    label: personName(people, m.personId, meId),
                    value: m.share,
                    note: `paid ${formatMoney(m.paid, currency)}`,
                    active: filter.personId === m.personId,
                    left: (
                      <Avatar
                        name={people.find((p) => p.id === m.personId)?.name ?? '?'}
                        colorIndex={people.find((p) => p.id === m.personId)?.colorIndex ?? 0}
                        size={24}
                      />
                    ),
                  }))}
                />
                <Text style={[font.small, { color: c.textFaint, marginTop: spacing.xs }]}>
                  Bars show what each person consumed; the figure beside it is what
                  they actually paid. Tap to see only their expenses.
                </Text>
              </View>

              <SectionTitle>Net position</SectionTitle>
              <View style={{ paddingHorizontal: spacing.lg }}>
                <NetBars
                  currency={currency}
                  rows={report.byMember.map((m) => ({
                    key: m.personId,
                    label: personName(people, m.personId, meId),
                    net: m.net,
                    isSelf: m.personId === meId,
                  }))}
                />
                <Text style={[font.small, { color: c.textFaint, marginTop: spacing.xs }]}>
                  Paid minus consumed, over what is shown. These always cancel out.
                </Text>
              </View>
            </>
          ) : null}

          {mode !== 'group' &&
          (personal ? report.subjectByGroup : report.byGroup).length >= (personal ? 1 : 2) ? (
            <>
              <SectionTitle>By group</SectionTitle>
              <View style={{ paddingHorizontal: spacing.lg }}>
                <RankedBars
                  currency={currency}
                  onPressRow={(key) =>
                    setFilter((f) => {
                      const id = key === 'none' ? null : key;
                      return {
                        ...f,
                        groupIds: f.groupIds.includes(id)
                          ? f.groupIds.filter((x) => x !== id)
                          : [...f.groupIds, id],
                      };
                    })
                  }
                  rows={(personal ? report.subjectByGroup : report.byGroup).map((g) => ({
                    key: g.groupId ?? 'none',
                    label: groups.find((x) => x.id === g.groupId)?.name ?? 'Outside any group',
                    value: g.amount,
                    note: `${Math.round(g.share * 100)}%`,
                    active: filter.groupIds.includes(g.groupId),
                  }))}
                />
                <Text style={[font.small, { color: c.textFaint, marginTop: spacing.xs }]}>
                  {personal
                    ? 'Your share of the spending in each group. Tap one to see only that group.'
                    : 'Total spending in each group.'}
                </Text>
              </View>
            </>
          ) : null}

          <SectionTitle>
            {/* report.count is spend only, so the heading agrees with every
                figure above it even when paybacks are shown in the list. */}
            {filtered ? `Matching expenses (${report.count})` : `Expenses (${report.count})`}
            {scoped.length - report.count > 0
              ? ` · ${scoped.length - report.count} payback${
                  scoped.length - report.count === 1 ? '' : 's'
                }`
              : ''}
          </SectionTitle>
          {scoped.slice(0, 40).map((e) => {
            const entry = describeEntry(e, people, meId);
            return (
              <Row
                key={e.id}
                left={
                  <Ionicons
                    name={
                      (entry.isPayback
                        ? 'swap-horizontal-outline'
                        : iconForCategory(e.category)) as never
                    }
                    size={20}
                    color={entry.isPayback ? c.settled : c.textMuted}
                  />
                }
                title={entry.title}
                subtitle={
                  <Text style={[font.small, { color: c.textMuted, marginTop: 2 }]}>
                    {e.date} · {formatMoney(e.amount, e.currency)}
                    {entry.isPayback ? ' · payback, not spending' : null}
                    {entry.delta !== 0 && !entry.isPayback ? (
                      <Text style={{ color: balanceColor(entry.delta, c), fontWeight: '600' }}>
                        {'  '}
                        {entry.deltaLabel}{' '}
                        {formatMoney(Math.abs(entry.delta), e.currency)}
                      </Text>
                    ) : null}
                  </Text>
                }
                onPress={() => router.push(`/expense/${e.id}`)}
                chevron
              />
            );
          })}
          {scoped.length > 40 ? (
            <Text style={[font.small, { color: c.textFaint, padding: spacing.lg }]}>
              Showing the first 40. Narrow the filter to see the rest.
            </Text>
          ) : null}

          <View style={{ padding: spacing.lg }}>
            <Text style={[font.small, { color: c.textFaint }]}>
              {report.earliest === report.latest
                ? `On ${report.earliest}.`
                : `From ${report.earliest} to ${report.latest}.`}
            </Text>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chartControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
});
