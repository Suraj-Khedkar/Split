import { useColorScheme, type TextStyle } from 'react-native';

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

  /**
   * Chart marks only — deliberately not the same as owed/owe.
   *
   * The semantic colours above are tuned for text and tints. As chart fills
   * they fail two of the checks in the dataviz method: below 3:1 against white
   * in light mode, and above the dark-mode lightness band on #121212. These are
   * the same two hues snapped to a passing lightness step, validated in both
   * modes (lightness, chroma, CVD separation, normal-vision floor, contrast).
   */
  chartPos: string;
  chartNeg: string;
  /** Recessive track behind a bar, showing the full width for comparison. */
  chartTrack: string;

  /**
   * Pressed-state background.
   *
   * Deliberately not `surface`: card and surface differ by 4 points of
   * lightness in dark mode (#1A1A1A vs #1E1E1E), so using surface as the
   * pressed state meant taps produced no perceptible feedback at all.
   */
  pressed: string;

  /**
   * Ordinal ramp for part-to-whole charts.
   *
   * One hue, monotonically lighter/darker by rank — not eight competing hues.
   * Segments in a share bar are ordered by size, so the order carries meaning
   * and the colour should show it; a nominal palette would spend the identity
   * channel re-encoding what segment width already says, and would drag in the
   * colour-blindness separation problem for no gain. Checked for monotonic
   * lightness and for every step clearing 2:1 against its own surface.
   */
  chartRamp: string[];
}

export const lightColors: Palette = {
  owed: '#1CC29F',
  owedTint: '#E4F7F2',
  owe: '#FF652F',
  oweTint: '#FFEDE5',

  // The canvas is a soft neutral rather than white, so white cards lift off it
  // on their own. That is what lets the app drop most of its divider lines and
  // still read as separate blocks.
  bg: '#F6F7F9',
  surface: '#EFF1F4',
  card: '#FFFFFF',
  border: '#E4E7EB',

  text: '#15171A',
  textMuted: '#5F6570',
  textFaint: '#9AA1AC',
  onDark: '#FFFFFF',

  header: '#FFFFFF',
  settled: '#8A9099',
  danger: '#D93B30',

  chartPos: '#00A07E',
  chartNeg: '#E34B06',
  chartTrack: '#E8EBEF',
  pressed: '#E8EBEF',
  chartRamp: ['#006143', '#006E50', '#007C5C', '#008969', '#009776', '#13A583', '#2FB491', '#42C29E'],
};

export const darkColors: Palette = {
  // Lifted toward white so they hold contrast on a near-black surface.
  owed: '#2EDCB4',
  owedTint: '#10312A',
  owe: '#FF8354',
  oweTint: '#3A2118',

  // Very slightly cool rather than neutral grey: pure greys next to the teal
  // read as dirty, and the cast is what stops the dark theme looking flat.
  bg: '#0E0F12',
  // Elevated surfaces get lighter, not darker - the Material dark convention.
  surface: '#1F2228',
  card: '#17191D',
  border: '#282C33',

  text: '#EDEFF2',
  textMuted: '#9BA2AD',
  textFaint: '#6B727D',
  onDark: '#0A0A0A',

  header: '#0E0F12',
  settled: '#7A818B',
  danger: '#FF6B5E',

  chartPos: '#00AE88',
  chartNeg: '#E2693A',
  chartTrack: '#24272E',
  pressed: '#2A2E36',
  chartRamp: ['#50D9B1', '#3DCAA3', '#27BC95', '#00AD87', '#009F7A', '#00916D', '#008360', '#007553'],
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

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 8, md: 12, lg: 18, xl: 26, pill: 999 };

export const font = {
  // Negative tracking on the large sizes only. Headlines set at default
  // spacing look loose at 22px and above; body text does not.
  h1: { fontSize: 32, fontWeight: '700' as const, letterSpacing: -0.6 },
  h2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  small: { fontSize: 13, fontWeight: '400' as const },
  tiny: { fontSize: 11, fontWeight: '600' as const },
  /**
   * Figures. Tabular digits are all one width, so a column of amounts lines up
   * on the decimal instead of shuffling as the numbers change.
   */
  numeric: { fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] },
};

/**
 * Elevation.
 *
 * Two levels only: things resting on the canvas, and things floating over it.
 * More than that and the hierarchy stops being readable at a glance.
 */
export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  floating: {
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
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
  sports: 'football-outline',
  settlement: 'swap-horizontal-outline',
};

export const CATEGORIES = Object.keys(categoryIcon).filter(
  (c) => c !== 'settlement'
);

/** Built-in icon, or a generic tag for a category the user invented. */
export function iconForCategory(category: string): string {
  return categoryIcon[category] ?? 'pricetag-outline';
}
