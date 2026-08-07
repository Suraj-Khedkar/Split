import { useColorScheme } from 'react-native';

import { useSettings } from '../store/useSettings';

/**
 * Design tokens.
 *
 * The two signal colours carry most of the meaning in this app: teal = you are
 * owed, orange = you owe. They keep their hue in both themes (brightened for
 * dark so they stay legible on a near-black surface) because users read the
 * balance state by colour before they read the number.
 *
 * Layout values live in StyleSheet.create; only colours are resolved at render
 * time, via useColors(). That keeps stylesheets static and cheap while still
 * letting the palette flip with the system setting.
 */

export interface Palette {
  owed: string;
  owedTint: string;
  owe: string;
  oweTint: string;

  bg: string;
  surface: string;
  card: string;
  border: string;

  text: string;
  textMuted: string;
  textFaint: string;
  onDark: string;

  header: string;
  settled: string;
  danger: string;
}

export const lightColors: Palette = {
  owed: '#1CC29F',
  owedTint: '#E7F8F4',
  owe: '#FF652F',
  oweTint: '#FFEDE6',

  bg: '#FFFFFF',
  surface: '#F7F7F7',
  card: '#FFFFFF',
  border: '#E6E6E6',

  text: '#1B1B1B',
  textMuted: '#6B6B6B',
  textFaint: '#9B9B9B',
  onDark: '#FFFFFF',

  header: '#FFFFFF',
  settled: '#8A8A8A',
  danger: '#D93025',
};

export const darkColors: Palette = {
  // Lifted toward white so they hold contrast on #121212.
  owed: '#2EDCB4',
  owedTint: '#12312B',
  owe: '#FF8354',
  oweTint: '#3A2118',

  bg: '#121212',
  // Elevated surfaces get lighter, not darker - the Material dark convention.
  surface: '#1E1E1E',
  card: '#1A1A1A',
  border: '#2C2C2C',

  text: '#ECECEC',
  textMuted: '#A0A0A0',
  textFaint: '#6E6E6E',
  onDark: '#0A0A0A',

  header: '#121212',
  settled: '#7A7A7A',
  danger: '#FF6B5E',
};

/**
 * Live palette. Defaults to dark; "system" follows the OS setting.
 * Re-renders on both a preference change and an OS appearance change.
 */
export function useIsDark(): boolean {
  const mode = useSettings((s) => s.themeMode);
  const system = useColorScheme();
  if (mode === 'system') return system === 'dark';
  return mode === 'dark';
}

export function useColors(): Palette {
  return useIsDark() ? darkColors : lightColors;
}

/** Deterministic avatar tints, indexed by Person.colorIndex. */
export const avatarColors = [
  '#1CC29F',
  '#5B8DEF',
  '#F2994A',
  '#BB6BD9',
  '#EB5757',
  '#27AE60',
  '#2D9CDB',
  '#F2C94C',
];

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 };

export const font = {
  h1: { fontSize: 28, fontWeight: '700' as const },
  h2: { fontSize: 20, fontWeight: '700' as const },
  h3: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  small: { fontSize: 13, fontWeight: '400' as const },
  tiny: { fontSize: 11, fontWeight: '600' as const },
};

/** Colour for a signed balance: teal when owed, orange when owing. */
export function balanceColor(amount: number, palette: Palette): string {
  if (amount > 0) return palette.owed;
  if (amount < 0) return palette.owe;
  return palette.settled;
}

export const categoryIcon: Record<string, string> = {
  general: 'receipt-outline',
  food: 'restaurant-outline',
  groceries: 'cart-outline',
  transport: 'car-outline',
  home: 'home-outline',
  utilities: 'flash-outline',
  entertainment: 'film-outline',
  travel: 'airplane-outline',
  shopping: 'bag-outline',
  settlement: 'swap-horizontal-outline',
};

export const CATEGORIES = Object.keys(categoryIcon).filter(
  (c) => c !== 'settlement'
);
