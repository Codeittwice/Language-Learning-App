/**
 * Design tokens. Every colour, space, radius and type size in the app comes from here
 * so that light and dark stay in step and nothing drifts into a one-off hex value.
 *
 * The palette is "Delft": cobalt blue for action, hot orange for reward.
 *
 * The choice is deliberate and the reason is contrast, not patriotism. A palette feels
 * alive when exactly two colours carry chroma -- the thing you tap and the thing you
 * earn -- and those two sit far apart on the wheel so a reward can never be mistaken
 * for a button. The previous palette failed on that second count: a muted orange
 * primary next to an amber accent meant nothing ever stood out from anything.
 * Everything that is not action or reward is a near-neutral blue-grey.
 */
import { Platform } from 'react-native';

export const palette = {
  // Cobalt -- the primary action colour, and the only blue that is ever saturated.
  blue50: '#F5F7FD',
  blue100: '#E4EBFD',
  blue200: '#C3D0EC',
  blue300: '#8794AE',
  blue400: '#5B83E8',
  blue500: '#1B4FD8',
  blue600: '#143BA0',
  blue700: '#0F2C78',

  // Orange -- reward only: XP, the streak, a level gained. NEVER an action.
  orange100: '#FFE8DF',
  orange300: '#FF8A5C',
  orange500: '#FF6B35',
  orange600: '#D2410B',
  orange700: '#A03606',

  // Cyan -- listening, audio and saved words. Informational, never celebratory.
  cyan100: '#DCF0F7',
  cyan300: '#4FC3DE',
  cyan500: '#0A7490',
  cyan700: '#075A72',

  green100: '#D9F3EC',
  green300: '#45C79C',
  green500: '#0E8A6A',
  green600: '#075944',

  amber100: '#FDF0DC',
  amber300: '#E8A23C',
  amber500: '#B45309',

  red100: '#FBE4E1',
  red300: '#EE7D72',
  red500: '#C23A2B',
  red600: '#8E2318',

  // Cool neutrals, tinted very slightly blue so they sit under the cobalt rather
  // than fighting it.
  slate50: '#F5F7FD',
  slate100: '#EDF1FB',
  slate200: '#E0E7F7',
  slate300: '#C3D0EC',

  navy900: '#0B1222',
  navy800: '#121B2E',
  navy700: '#1A2440',
  navy600: '#24304F',
  navy500: '#2E3C5C',

  ink900: '#0E1A33',
  ink600: '#4A5872',
  ink400: '#6E7D9B',
  ink300: '#8794AE',

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

  /** Streak flame and XP. A fill colour. */
  streak: string;
  streakSoft: string;
  /**
   * Streak and XP as TEXT. Separate from `streak` because the reward orange is
   * chosen to be loud as a fill, which leaves it well under 4.5:1 as a label --
   * the one place a "just use the brand colour" shortcut silently fails contrast.
   */
  streakText: string;

  /** Track behind a progress bar or ring. */
  track: string;

  /** Overlay behind modals. */
  overlay: string;
};

export const lightColors: ColorTokens = {
  bg: palette.slate50,
  surface: palette.white,
  surfaceAlt: palette.slate100,
  surfaceActive: palette.slate200,
  border: palette.slate200,
  borderStrong: palette.slate300,

  text: palette.ink900,
  textMuted: palette.ink600,
  textFaint: palette.ink300,
  onAccent: palette.white,

  primary: palette.blue500,
  primaryHover: palette.blue600,
  primarySoft: palette.blue100,
  primaryText: palette.blue600,

  accent: palette.cyan500,
  accentSoft: palette.cyan100,
  accentText: palette.cyan700,

  success: palette.green500,
  successSoft: palette.green100,
  warning: palette.amber500,
  warningSoft: palette.amber100,
  danger: palette.red500,
  dangerSoft: palette.red100,

  streak: palette.orange500,
  streakSoft: palette.orange100,
  streakText: palette.orange700,

  track: palette.slate200,
  overlay: 'rgba(14, 26, 51, 0.5)',
};

export const darkColors: ColorTokens = {
  bg: palette.navy900,
  surface: palette.navy800,
  surfaceAlt: palette.navy700,
  surfaceActive: palette.navy600,
  border: palette.navy700,
  borderStrong: palette.navy500,

  text: '#EEF2FB',
  textMuted: '#9FACC6',
  textFaint: palette.ink400,
  onAccent: palette.white,

  primary: palette.blue400,
  primaryHover: '#7C9DEF',
  primarySoft: 'rgba(91, 131, 232, 0.18)',
  primaryText: '#B7CAF7',

  accent: palette.cyan300,
  accentSoft: 'rgba(79, 195, 222, 0.16)',
  accentText: '#9BDCEE',

  success: palette.green300,
  successSoft: 'rgba(69, 199, 156, 0.16)',
  warning: palette.amber300,
  warningSoft: 'rgba(232, 162, 60, 0.16)',
  danger: palette.red300,
  dangerSoft: 'rgba(238, 125, 114, 0.16)',

  streak: palette.orange300,
  streakSoft: 'rgba(255, 138, 92, 0.18)',
  streakText: '#FFB694',

  track: palette.navy700,
  overlay: 'rgba(0, 0, 0, 0.62)',
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

/**
 * `display` is a serif, and it is the one new face in the app.
 *
 * Platform serifs rather than a bundled font: Georgia and Noto Serif are both well
 * drawn, cost nothing to load, and cannot fail to render on a cold start. Swapping in
 * a webfont later means `expo-font`'s `useFonts` plus one line here.
 */
export const fonts = Platform.select({
  ios: { sans: 'system-ui', rounded: 'ui-rounded', mono: 'ui-monospace', display: 'Georgia' },
  android: { sans: 'normal', rounded: 'normal', mono: 'monospace', display: 'serif' },
  default: { sans: 'normal', rounded: 'normal', mono: 'monospace', display: 'serif' },
  web: {
    sans: 'var(--font-display)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
    display: 'Georgia, serif',
  },
}) as { sans: string; rounded: string; mono: string; display: string };

/**
 * Type scale.
 *
 * `display` and `title` are the serif voice: a number we want to feel like an
 * achievement, and the name of the thing you are about to practise. Everything else
 * is the system sans. Two faces, and a hard rule about which gets used where, is what
 * keeps a screen from looking like a template.
 */
export const typography = {
  display: { fontSize: 44, lineHeight: 48, fontWeight: '400', fontFamily: fonts.display },
  title: { fontSize: 30, lineHeight: 34, fontWeight: '400', fontFamily: fonts.display },
  numeral: { fontSize: 22, lineHeight: 24, fontWeight: '400', fontFamily: fonts.display },
  h1: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  h2: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  h3: { fontSize: 17, lineHeight: 23, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 19, fontWeight: '400' },
  smallStrong: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  caption: { fontSize: 11, lineHeight: 15, fontWeight: '600', letterSpacing: 0.6 },
  /** Dutch text inside an exercise, where we want it to read a little larger. */
  dutch: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
} as const;

export const shadow = {
  card: Platform.select({
    ios: {
      shadowColor: palette.ink900,
      shadowOpacity: 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 5 },
    },
    default: { elevation: 2 },
  }),
  raised: Platform.select({
    ios: {
      shadowColor: palette.ink900,
      shadowOpacity: 0.14,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 9 },
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

/**
 * The two themes, built once.
 *
 * These MUST be module-level singletons rather than fresh objects per call. Every
 * `Text`, `Card`, `Row` and `Button` calls `useTheme()`, so a new object here means
 * no style array anywhere in the app is ever reference-equal between renders, and
 * nothing downstream can memoise. Building them once makes `useTheme()` a stable
 * reference and is the single cheapest performance fix in the codebase.
 */
const lightTheme: Theme = Object.freeze({
  scheme: 'light',
  colors: lightColors,
  space,
  radius,
  typography,
  fonts,
  shadow,
  duration,
});

const darkTheme: Theme = Object.freeze({
  scheme: 'dark',
  colors: darkColors,
  space,
  radius,
  typography,
  fonts,
  shadow,
  duration,
});

export function themeFor(scheme: 'light' | 'dark'): Theme {
  return scheme === 'dark' ? darkTheme : lightTheme;
}
