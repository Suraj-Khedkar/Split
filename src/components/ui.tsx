import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

import { formatMoney } from '../lib/money';
import {
  avatarColors,
  balanceColor,
  font,
  radius,
  spacing,
  useColors,
} from '../theme';

export function Avatar({
  name,
  colorIndex = 0,
  size = 40,
}: {
  name: string;
  colorIndex?: number;
  size?: number;
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: avatarColors[colorIndex % avatarColors.length],
        },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>
        {initials || '?'}
      </Text>
    </View>
  );
}

export function GroupIcon({ type, size = 48 }: { type: string; size?: number }) {
  const c = useColors();
  const icon =
    type === 'trip'
      ? 'airplane'
      : type === 'home'
      ? 'home'
      : type === 'couple'
      ? 'heart'
      : 'people';
  return (
    <View
      style={[
        styles.center,
        {
          width: size,
          height: size,
          borderRadius: radius.md,
          backgroundColor: c.owedTint,
        },
      ]}
    >
      <Ionicons name={icon as never} size={size * 0.5} color={c.owed} />
    </View>
  );
}

/** Signed amount rendered in the owed/owe colour. */
export function Amount({
  value,
  currency = 'INR',
  size = 'body',
}: {
  value: number;
  currency?: string;
  size?: 'body' | 'h2' | 'small';
}) {
  const c = useColors();
  return (
    <Text style={[font[size], { color: balanceColor(value, c), fontWeight: '600' }]}>
      {formatMoney(value, currency)}
    </Text>
  );
}

/**
 * The recurring "owes / is owed / settled up" phrase. Centralised because it
 * appears on five screens and the wording must stay consistent.
 */
export function BalanceLabel({
  amount,
  currency = 'INR',
  subject = 'You',
}: {
  amount: number;
  currency?: string;
  subject?: string;
}) {
  const c = useColors();
  if (amount === 0) {
    return <Text style={[font.small, { color: c.settled }]}>settled up</Text>;
  }
  const owed = amount > 0;
  const verb =
    subject === 'You' ? (owed ? 'are owed' : 'owe') : owed ? 'is owed' : 'owes';
  return (
    <Text style={[font.small, { color: c.textMuted }]}>
      {subject} {verb}{' '}
      <Text style={{ color: balanceColor(amount, c), fontWeight: '600' }}>
        {formatMoney(amount, currency)}
      </Text>
    </Text>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const c = useColors();
  const bg =
    variant === 'primary' ? c.owed : variant === 'danger' ? c.danger : 'transparent';
  const fg = variant === 'secondary' ? c.text : c.onDark;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        variant === 'secondary' && { borderWidth: 1, borderColor: c.border },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[font.bodyStrong, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Row({
  left,
  title,
  subtitle,
  right,
  onPress,
  chevron,
}: {
  left?: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
}) {
  const c = useColors();
  const content = (
    <View style={styles.row}>
      {left ? <View style={{ marginRight: spacing.md }}>{left}</View> : null}
      <View style={{ flex: 1 }}>
        <Text style={[font.bodyStrong, { color: c.text }]} numberOfLines={1}>
          {title}
        </Text>
        {typeof subtitle === 'string' ? (
          <Text style={[font.small, { color: c.textMuted, marginTop: 2 }]}>
            {subtitle}
          </Text>
        ) : (
          subtitle
        )}
      </View>
      {right}
      {chevron ? (
        <Ionicons
          name="chevron-forward"
          size={18}
          color={c.textFaint}
          style={{ marginLeft: spacing.xs }}
        />
      ) : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? c.surface : c.card })}
    >
      {content}
    </Pressable>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <Text style={[styles.sectionTitle, { color: c.textFaint }]}>{children}</Text>;
}

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  body,
}: {
  icon?: string;
  title: string;
  body?: string;
}) {
  const c = useColors();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon as never} size={44} color={c.textFaint} />
      <Text style={[font.h3, { marginTop: spacing.md, color: c.text }]}>{title}</Text>
      {body ? (
        <Text
          style={[
            font.small,
            { color: c.textMuted, textAlign: 'center', marginTop: spacing.xs },
          ]}
        >
          {body}
        </Text>
      ) : null}
    </View>
  );
}

export function Divider() {
  const c = useColors();
  return <View style={[styles.divider, { backgroundColor: c.border }]} />;
}

/** Floating action button, Splitwise's "Add expense" affordance. */
export function Fab({
  onPress,
  label = 'Add expense',
}: {
  onPress: () => void;
  label?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor: c.owe, opacity: pressed ? 0.9 : 1 },
      ]}
    >
      <Ionicons name="add" size={20} color={c.onDark} />
      <Text style={[font.bodyStrong, { color: c.onDark, marginLeft: 6 }]}>{label}</Text>
    </Pressable>
  );
}

/** Screen background that follows the theme. */
export function Screen({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <View style={{ flex: 1, backgroundColor: c.bg }}>{children}</View>;
}

/**
 * Confirmation dialog.
 *
 * Exists because `Alert.alert` is a no-op on react-native-web - the shipped
 * implementation is an empty method body - so every confirm-then-act button
 * silently did nothing in the browser and the installed PWA. Rendering the
 * dialog ourselves is the only version that behaves the same on all three
 * surfaces.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  destructive,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const c = useColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/* Tapping the backdrop cancels; the inner Pressable stops that from
          firing when the dialog itself is tapped. */}
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={[styles.dialog, { backgroundColor: c.card }]} onPress={() => {}}>
          <Text style={[font.h3, { color: c.text }]}>{title}</Text>
          {message ? (
            <Text
              style={[font.small, { color: c.textMuted, marginTop: spacing.sm, lineHeight: 20 }]}
            >
              {message}
            </Text>
          ) : null}
          <View style={styles.dialogActions}>
            <Button title="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
            <Button
              title={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              onPress={onConfirm}
              style={{ flex: 1 }}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  dialog: {
    width: '100%',
    maxWidth: 380,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  dialogActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFF', fontWeight: '700' },
  center: { alignItems: 'center', justifyContent: 'center' },
  button: {
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sectionTitle: {
    ...font.tiny,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xxl * 1.5,
    paddingHorizontal: spacing.xl,
  },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: spacing.lg },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderRadius: radius.pill,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
});
