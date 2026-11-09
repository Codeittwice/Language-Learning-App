/**
 * Design tokens. Every colour, space, radius and type size in the app comes from here
 * so that light and dark stay in step and nothing drifts into a one-off hex value.
 *
 * The palette is warm paper and Dutch orange with a sea-teal accent, rather than the
 * saturated greens every language app reaches for.
 */
import { Platform } from 'react-native';

export const palette = {
  // Orange -- the primary action colour.
  orange100: '#FDEDE1',
  orange200: '#F9D2B4',
  orange400: '#F08A3C',
  orange500: '#DD6214',
  orange600: '#B94E0C',
  orange700: '#8F3C09',

  // Teal -- secondary accent, used for information and listening affordances.
  teal100: '#DCF2EF',
  teal200: '#A9DED7',
  teal500: '#0F766E',
  teal600: '#0B5B55',
  teal700: '#08433E',

  // Amber -- streaks and celebration only. Never an action colour.
  amber100: '#FEF3C7',
  amber400: '#FBBF24',
  amber500: '#F59E0B',

  green100: '#DCF5E3',
  green500: '#2E7D4F',
  green600: '#226139',

  red100: '#FBE4E1',
  red500: '#C0392B',
  red600: '#9A2A1E',

  // Warm neutrals. Paper, not grey.
  sand50: '#FDFBF7',
  sand100: '#F7F3EB',
  sand200: '#EFE9DD',
  sand300: '#E2DACB',
  sand400: '#C4B8A4',

  ink900: '#17140F',
  ink800: '#221E18',
  ink700: '#2E2922',
  ink600: '#3C362D',
  ink400: '#6B6358',
  ink300: '#8F877A',

  white: '#FFFFFF',
  black: '#000000',
} as const;

export type ColorTokens = {
  /** Screen background. */
  bg: string;
  /** Raised card / sheet surface. */
  surface: string;
  /** A second surface tier, for rows inside a card. */
  surfaceAlt: string;
  /** Pressed / selected surface. */
  surfaceActive: string;
  border: string;
  borderStrong: string;

  text: string;
  textMuted: string;
  textFaint: string;
  /** Text that sits on `primary`, `success`, `danger` etc. */
  onAccent: string;

  primary: string;
  primaryHover: string;
  primarySoft: string;
  primaryText: string;

  accent: string;
  accentSoft: string;
  accentText: string;

  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;

  /** Streak flame and XP. */
  streak: string;
  streakSoft: string;

  /** Track behind a progress bar or ring. */
  track: string;

  /** Overlay behind modals. */
  overlay: string;
};

export const lightColors: ColorTokens = {
  bg: palette.sand50,
  surface: palette.white,
  surfaceAlt: palette.sand100,
  surfaceActive: palette.sand200,
  border: palette.sand300,
  borderStrong: palette.sand400,

  text: palette.ink900,
  textMuted: palette.ink400,
  textFaint: palette.ink300,
  onAccent: palette.white,

  primary: palette.orange500,
  primaryHover: palette.orange600,
  primarySoft: palette.orange100,
  primaryText: palette.orange700,

  accent: palette.teal500,
  accentSoft: palette.teal100,
  accentText: palette.teal700,

  success: palette.green500,
  successSoft: palette.green100,
  warning: palette.orange600,
  warningSoft: palette.orange100,
  danger: palette.red500,
  dangerSoft: palette.red100,

  streak: palette.amber500,
  streakSoft: palette.amber100,

  track: palette.sand200,
  overlay: 'rgba(23, 20, 15, 0.45)',
};

export const darkColors: ColorTokens = {
  bg: palette.ink900,
  surface: palette.ink800,
  surfaceAlt: palette.ink700,
  surfaceActive: palette.ink600,
  border: palette.ink700,
  borderStrong: palette.ink600,

  text: palette.sand50,
  textMuted: palette.sand400,
  textFaint: palette.ink300,
  onAccent: palette.white,

  primary: palette.orange400,
  primaryHover: palette.orange500,
  primarySoft: 'rgba(240, 138, 60, 0.16)',
  primaryText: palette.orange200,

  accent: palette.teal200,
  accentSoft: 'rgba(169, 222, 215, 0.14)',
  accentText: palette.teal200,

  success: '#5BBE85',
  successSoft: 'rgba(91, 190, 133, 0.16)',
  warning: palette.orange400,
  warningSoft: 'rgba(240, 138, 60, 0.16)',
  danger: '#E8736A',
  dangerSoft: 'rgba(232, 115, 106, 0.16)',

  streak: palette.amber400,
  streakSoft: 'rgba(251, 191, 36, 0.16)',

  track: palette.ink700,
  overlay: 'rgba(0, 0, 0, 0.6)',
};

/** 4pt base scale. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const fonts = Platform.select({
  ios: { sans: 'system-ui', rounded: 'ui-rounded', mono: 'ui-monospace' },
  default: { sans: 'normal', rounded: 'normal', mono: 'monospace' },
  web: { sans: 'var(--font-display)', rounded: 'var(--font-rounded)', mono: 'var(--font-mono)' },
}) as { sans: string; rounded: string; mono: string };

/**
 * Type scale. `display` is for numbers we want to feel like an achievement -- the
 * streak count, XP earned -- and nothing else.
 */
export const typography = {
  display: { fontSize: 44, lineHeight: 48, fontWeight: '800' },
  h1: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  h2: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  h3: { fontSize: 17, lineHeight: 23, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 23, fontWeight: '600' },
  small: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  smallStrong: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  /** Dutch text inside an exercise, where we want it to read a little larger. */
  dutch: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
} as const;

export const shadow = {
  card: Platform.select({
    ios: {
      shadowColor: palette.ink900,
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    default: { elevation: 2 },
  }),
  raised: Platform.select({
    ios: {
      shadowColor: palette.ink900,
      shadowOpacity: 0.12,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
    },
    default: { elevation: 6 },
  }),
} as const;

export const duration = { fast: 140, base: 220, slow: 380, celebrate: 900 } as const;

export type Theme = {
  scheme: 'light' | 'dark';
  colors: ColorTokens;
  space: typeof space;
  radius: typeof radius;
  typography: typeof typography;
  fonts: typeof fonts;
  shadow: typeof shadow;
  duration: typeof duration;
};

export function themeFor(scheme: 'light' | 'dark'): Theme {
  return {
    scheme,
    colors: scheme === 'dark' ? darkColors : lightColors,
    space,
    radius,
    typography,
    fonts,
    shadow,
    duration,
  };
}
