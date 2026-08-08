import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatMoney } from '../lib/money';
import { Palette, font, radius, spacing, useColors } from '../theme';

/**
 * Charts, built from plain Views.
 *
 * No charting library and no react-native-svg: every mark here is a rectangle,
 * which View draws natively on all three platforms and keeps the APK from
 * needing a rebuild to gain a dependency.
 *
 * Colour follows the job, not the category. Ranked bars are *nominal* — the bar
 * length already encodes the value and the row is labelled — so every bar takes
 * the same hue rather than spending the identity channel re-encoding magnitude.
 * Only the net chart is diverging, because there the sign is the point.
 */

/** Bars never vanish: a nonzero value always shows a sliver worth seeing. */
const MIN_BAR = 0.02;

const ratio = (value: number, max: number) =>
  max <= 0 ? 0 : Math.max(value === 0 ? 0 : MIN_BAR, value / max);

/* ------------------------------- stat tiles ------------------------------ */

/**
 * A single number is a stat tile, not a one-bar chart. The hero figure is the
 * one the screen leads with.
 */
export function StatTile({
  label,
  value,
  hint,
  hero,
}: {
  label: string;
  value: string;
  hint?: string;
  hero?: boolean;
}) {
  const c = useColors();
  return (
    <View style={{ flex: 1, minWidth: 96 }}>
      <Text style={[font.small, { color: c.textMuted }]} numberOfLines={1}>
        {label}
      </Text>
      {/* No numberOfLines and no adjustsFontSizeToFit: the latter is a no-op in
          react-native-web, so the pair silently ellipsised long amounts —
          "₹7,15,115.20" became "₹7,15,1…". A figure that cannot be read in
          full is worse than one that wraps, so it wraps. */}
      <Text style={[hero ? font.h2 : font.h3, { color: c.text, marginTop: 2 }]}>
        {value}
      </Text>
      {hint ? (
        <Text style={[font.small, { color: c.textFaint, marginTop: 2 }]} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/* ------------------------------- ranked bars ----------------------------- */

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** Shown to the right of the label, e.g. a percentage. */
  note?: string;
  left?: React.ReactNode;
  /** Drawn as selected. Selection is owned by the caller, not the chart. */
  active?: boolean;
}

/**
 * Horizontal ranked bars — the default for "compare magnitude".
 *
 * Horizontal because the labels are words: category and people's names do not
 * fit under vertical columns without rotating them, and rotated labels are an
 * anti-pattern.
 */
export function RankedBars({
  rows,
  currency,
  max,
  onPressRow,
}: {
  rows: BarRow[];
  currency: string;
  /** Defaults to the largest row, so the top bar is full width. */
  max?: number;
  /** Makes rows tappable — used to drill into the matching expenses. */
  onPressRow?: (key: string) => void;
}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const ceiling = max ?? Math.max(0, ...rows.map((r) => r.value));

  if (!rows.length) return null;

  return (
    <View>
      {rows.map((row) => (
        <Pressable
          key={row.key}
          onPress={onPressRow ? () => onPressRow(row.key) : undefined}
          disabled={!onPressRow}
          android_ripple={onPressRow ? { color: c.pressed } : undefined}
          style={({ pressed }) => [
            styles.barRow,
            onPressRow && styles.tappable,
            row.active && { backgroundColor: c.owedTint },
            pressed && onPressRow && { backgroundColor: c.pressed },
          ]}
        >
          <View style={styles.barHeader}>
            {row.left ? <View style={{ marginRight: spacing.sm }}>{row.left}</View> : null}
            <Text style={[font.body, { color: c.text, flex: 1 }]} numberOfLines={1}>
              {row.label}
            </Text>
            {/* Direct label on every row. The dataviz method requires visible
                values wherever mark contrast is relieved, and it also makes the
                chart readable without colour at all. */}
            <Text style={[font.bodyStrong, { color: c.text }]}>
              {formatMoney(row.value, currency)}
            </Text>
            {row.note ? (
              <Text style={[font.small, { color: c.textFaint, marginLeft: spacing.sm, minWidth: 38, textAlign: 'right' }]}>
                {row.note}
              </Text>
            ) : null}
          </View>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${ratio(row.value, ceiling) * 100}%`, backgroundColor: c.chartPos },
              ]}
            />
          </View>
        </Pressable>
      ))}
    </View>
  );
}

/* -------------------------------- net bars ------------------------------- */

export interface NetRow {
  key: string;
  label: string;
  /** Positive = owed, negative = owes. */
  net: number;
  /** Switches the verb to second person: "you are owed" rather than "is owed". */
  isSelf?: boolean;
  left?: React.ReactNode;
}

/**
 * Diverging bars about a zero baseline: which side of even each person sits.
 *
 * Two hues plus the baseline, per the diverging rule. The sign is also stated
 * in words on every row, so the reading never depends on colour alone.
 */
export function NetBars({
  rows,
  currency,
  onPressRow,
}: {
  rows: NetRow[];
  currency: string;
  onPressRow?: (key: string) => void;
}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const ceiling = Math.max(0, ...rows.map((r) => Math.abs(r.net)));

  if (!rows.length) return null;

  return (
    <View>
      {rows.map((row) => {
        const positive = row.net >= 0;
        const width = (ratio(Math.abs(row.net), ceiling) * 100) / 2;
        return (
          <Pressable
            key={row.key}
            onPress={onPressRow ? () => onPressRow(row.key) : undefined}
            disabled={!onPressRow}
            android_ripple={onPressRow ? { color: c.pressed } : undefined}
            style={({ pressed }) => [
              styles.barRow,
              onPressRow && styles.tappable,
              pressed && onPressRow && { backgroundColor: c.pressed },
            ]}
          >
            <View style={styles.barHeader}>
              {row.left ? <View style={{ marginRight: spacing.sm }}>{row.left}</View> : null}
              <Text style={[font.body, { color: c.text, flex: 1 }]} numberOfLines={1}>
                {row.label}
              </Text>
              <Text style={[font.bodyStrong, { color: positive ? c.owed : c.owe }]}>
                {row.net === 0
                  ? 'settled up'
                  : `${
                      row.isSelf
                        ? positive
                          ? 'you are owed '
                          : 'you owe '
                        : positive
                        ? 'is owed '
                        : 'owes '
                    }${formatMoney(Math.abs(row.net), currency)}`}
              </Text>
            </View>
            <View style={styles.track}>
              {/* The baseline sits at the centre; bars grow out from it. */}
              <View style={[styles.baseline, { backgroundColor: c.border }]} />
              <View
                style={[
                  styles.fill,
                  styles.netFill,
                  positive
                    ? { left: '50%', backgroundColor: c.chartPos }
                    : { right: '50%', backgroundColor: c.chartNeg },
                  { width: `${width}%` },
                ]}
              />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------ trend columns ---------------------------- */

export interface TrendPoint {
  key: string;
  /** Short axis label, e.g. "Jan". */
  label: string;
  value: number;
}

/* ------------------------------ chart chooser ---------------------------- */

/** Compact icon segmented control for picking a chart form. */
export function ChartPicker<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; icon: string; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            android_ripple={{ color: c.pressed }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: active ? c.owed : c.border,
              backgroundColor: active ? c.owed : pressed ? c.pressed : 'transparent',
            })}
          >
            <Ionicons name={o.icon as never} size={13} color={active ? c.onDark : c.textMuted} />
            <Text style={[font.small, { marginLeft: 5, color: active ? c.onDark : c.text }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* -------------------------------- trend ---------------------------------- */

export type TrendType = 'columns' | 'line';

const PLOT_HEIGHT = 150;
/** Bucket widths the zoom control steps through, in px. */
export const ZOOM_STEPS = [14, 22, 34, 52, 78];

/**
 * Trend as columns or as a line, zoomable and scrollable.
 *
 * Zoom widens each bucket rather than rescaling the value axis: a year of
 * weeks is 52 buckets, which cannot be read at screen width, so widening them
 * and letting the plot scroll sideways is the only honest way to show it — the
 * alternative, squeezing 52 buckets into 350px, produces bars two pixels wide.
 *
 * The line is drawn from rotated Views. No SVG is involved, which keeps this
 * working in the APK without a rebuild.
 */
export function TrendChart({
  points,
  currency,
  type = 'columns',
  bucketWidth = 34,
  onSelect,
  selectedKey,
}: {
  points: TrendPoint[];
  currency: string;
  type?: TrendType;
  bucketWidth?: number;
  onSelect?: (key: string | null) => void;
  selectedKey?: string | null;
}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [internal, setInternal] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const selected = selectedKey !== undefined ? selectedKey : internal;
  const ceiling = Math.max(0, ...points.map((p) => p.value));

  if (!points.length) return null;

  const active = points.find((p) => p.key === selected) ?? null;
  const plotWidth = Math.max(width, points.length * bucketWidth);
  const step = plotWidth / points.length;
  // Label density follows the zoom: wider buckets can carry more labels.
  const labelEvery = Math.max(1, Math.ceil(52 / step));

  const pick = (key: string, isActive: boolean) => {
    const next = isActive ? null : key;
    if (selectedKey === undefined) setInternal(next);
    onSelect?.(next);
  };

  const yFor = (v: number) => PLOT_HEIGHT - (ceiling > 0 ? (v / ceiling) * PLOT_HEIGHT : 0);

  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.trendHeader}>
        <Text style={[font.small, { color: c.textMuted }]}>{active ? active.label : 'Peak'}</Text>
        <Text style={[font.bodyStrong, { color: c.text }]}>
          {formatMoney(active ? active.value : ceiling, currency)}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={plotWidth > width}
        contentContainerStyle={{ width: plotWidth }}
      >
        <View style={{ width: plotWidth }}>
          <View style={{ height: PLOT_HEIGHT, flexDirection: 'row' }}>
            {type === 'line' ? (
              <View style={{ width: plotWidth, height: PLOT_HEIGHT }}>
                {points.slice(0, -1).map((p, i) => {
                  const x1 = i * step + step / 2;
                  const x2 = (i + 1) * step + step / 2;
                  const y1 = yFor(p.value);
                  const y2 = yFor(points[i + 1].value);
                  const len = Math.hypot(x2 - x1, y2 - y1);
                  const angle = Math.atan2(y2 - y1, x2 - x1);
                  return (
                    <View
                      key={`seg-${p.key}`}
                      style={{
                        position: 'absolute',
                        left: (x1 + x2) / 2 - len / 2,
                        top: (y1 + y2) / 2 - 1,
                        width: len,
                        height: 2,
                        backgroundColor: c.chartPos,
                        transform: [{ rotate: `${angle}rad` }],
                      }}
                    />
                  );
                })}
                {points.map((p) => {
                  const isActive = active?.key === p.key;
                  return (
                    <Pressable
                      key={p.key}
                      onPress={() => pick(p.key, isActive)}
                      style={{
                        position: 'absolute',
                        left: points.indexOf(p) * step,
                        top: 0,
                        width: step,
                        height: PLOT_HEIGHT,
                      }}
                    >
                      <View
                        style={{
                          position: 'absolute',
                          left: step / 2 - (isActive ? 6 : 4),
                          top: yFor(p.value) - (isActive ? 6 : 4),
                          width: isActive ? 12 : 8,
                          height: isActive ? 12 : 8,
                          borderRadius: 6,
                          backgroundColor: c.chartPos,
                          borderWidth: 2,
                          borderColor: c.bg,
                        }}
                      />
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              points.map((p) => {
                const isActive = active?.key === p.key;
                return (
                  <Pressable
                    key={p.key}
                    onPress={() => pick(p.key, isActive)}
                    style={{ width: step, height: '100%', justifyContent: 'flex-end', paddingHorizontal: 1 }}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.label}: ${formatMoney(p.value, currency)}`}
                  >
                    <View
                      style={{
                        height: `${ratio(p.value, ceiling) * 100}%`,
                        backgroundColor: c.chartPos,
                        borderTopLeftRadius: 4,
                        borderTopRightRadius: 4,
                        minHeight: 2,
                        opacity: !active || isActive ? 1 : 0.35,
                      }}
                    />
                  </Pressable>
                );
              })
            )}
          </View>

          <View style={[styles.baselineFull, { backgroundColor: c.border }]} />

          <View style={{ flexDirection: 'row' }}>
            {points.map((p, i) => {
              const isActive = active?.key === p.key;
              return (
                <Text
                  key={`lbl-${p.key}`}
                  numberOfLines={1}
                  style={[
                    font.small,
                    {
                      width: step,
                      textAlign: 'center',
                      fontSize: 10,
                      color: isActive ? c.text : c.textFaint,
                    },
                  ]}
                >
                  {i % labelEvery === 0 || isActive ? p.label : ''}
                </Text>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/** −/+ zoom, with the current level shown so the control is not a mystery. */
export function ZoomControl({
  index,
  onChange,
  hint,
}: {
  index: number;
  onChange: (next: number) => void;
  hint?: string;
}) {
  const c = useColors();
  const btn = (icon: string, delta: number, enabled: boolean) => (
    <Pressable
      onPress={() => onChange(index + delta)}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={delta > 0 ? 'Zoom in' : 'Zoom out'}
      android_ripple={{ color: c.pressed, borderless: true }}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: c.border,
        opacity: enabled ? 1 : 0.35,
        backgroundColor: pressed ? c.pressed : 'transparent',
      })}
    >
      <Ionicons name={icon as never} size={16} color={c.text} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      {btn('remove', -1, index > 0)}
      {btn('add', 1, index < ZOOM_STEPS.length - 1)}
      {hint ? <Text style={[font.small, { color: c.textFaint }]}>{hint}</Text> : null}
    </View>
  );
}

/* ------------------------------- share bar ------------------------------- */

export interface ShareSlice {
  key: string;
  label: string;
  value: number;
}

/**
 * Part-to-whole as one horizontal stacked bar.
 *
 * Horizontal rather than a pie: the categories have long names, and a stacked
 * bar compares lengths along a common baseline, which people read far more
 * accurately than angles. Segments carry a 2px surface gap so neighbours never
 * blur together, and the legend states every value, so identity never rests on
 * colour alone.
 */
export function ShareBar({
  slices,
  currency,
  onPressSlice,
  activeKey,
}: {
  slices: ShareSlice[];
  currency: string;
  onPressSlice?: (key: string) => void;
  activeKey?: string | null;
}) {
  const c = useColors();
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (!slices.length || total <= 0) return null;

  // Eight is the ramp's length; past it the tail becomes an unreadable sliver,
  // so it folds into one honest "Other" rather than growing more steps.
  const shown = slices.slice(0, 7);
  const rest = slices.slice(7);
  const restTotal = rest.reduce((sum, s) => sum + s.value, 0);
  const segments = restTotal
    ? [...shown, { key: '__other', label: `Other (${rest.length})`, value: restTotal }]
    : shown;

  return (
    <View>
      <View style={{ flexDirection: 'row', height: 22, borderRadius: 6, overflow: 'hidden', gap: 2 }}>
        {segments.map((s, i) => (
          <View
            key={s.key}
            style={{
              flex: s.value,
              backgroundColor: c.chartRamp[i % c.chartRamp.length],
              opacity: activeKey && activeKey !== s.key ? 0.4 : 1,
            }}
          />
        ))}
      </View>

      <View style={{ marginTop: spacing.md, gap: 2 }}>
        {segments.map((s, i) => (
          <Pressable
            key={s.key}
            onPress={onPressSlice && s.key !== '__other' ? () => onPressSlice(s.key) : undefined}
            disabled={!onPressSlice || s.key === '__other'}
            android_ripple={{ color: c.pressed }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 7,
              paddingHorizontal: spacing.sm,
              marginHorizontal: -spacing.sm,
              borderRadius: radius.sm,
              backgroundColor:
                activeKey === s.key ? c.owedTint : pressed ? c.pressed : 'transparent',
            })}
          >
            <View
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                backgroundColor: c.chartRamp[i % c.chartRamp.length],
                marginRight: spacing.sm,
              }}
            />
            <Text style={[font.body, { color: c.text, flex: 1 }]} numberOfLines={1}>
              {s.label}
            </Text>
            <Text style={[font.bodyStrong, { color: c.text }]}>
              {formatMoney(s.value, currency)}
            </Text>
            <Text style={[font.small, { color: c.textFaint, marginLeft: spacing.sm, minWidth: 38, textAlign: 'right' }]}>
              {Math.round((s.value / total) * 100)}%
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/* -------------------------------- segmented ------------------------------ */


/** Range filter, sitting in one row above the charts. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: radius.pill,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: active ? c.owed : c.border,
              backgroundColor: active ? c.owed : 'transparent',
            }}
          >
            <Text style={[font.small, { color: active ? c.onDark : c.text }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    barRow: { marginBottom: spacing.md },
    // Tappable rows get padding so the hit target is bigger than the mark.
    tappable: {
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
      paddingBottom: 10,
      marginHorizontal: -spacing.sm,
      borderRadius: radius.md,
    },
    barHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    track: {
      height: 10,
      borderRadius: 5,
      backgroundColor: c.chartTrack,
      overflow: 'hidden',
      justifyContent: 'center',
    },
    // 4px rounded data-end, anchored flat against the baseline.
    fill: { position: 'absolute', left: 0, height: 10, borderRadius: 4 },
    netFill: { position: 'absolute' },
    baseline: { position: 'absolute', left: '50%', width: 1, top: 0, bottom: 0 },
    baselineFull: { height: StyleSheet.hairlineWidth, marginTop: 6 },
    trendHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: spacing.sm,
    },
    trendPlot: { flexDirection: 'row', alignItems: 'flex-end', height: 132, gap: 2 },
    column: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' },
    columnInner: { flex: 1, width: '100%', justifyContent: 'flex-end' },
    columnFill: { width: '100%', borderTopLeftRadius: 4, borderTopRightRadius: 4, minHeight: 2 },
  });
