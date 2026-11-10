/**
 * Typography primitives.
 *
 * Everything that renders words goes through here, so the type scale in
 * `src/theme/tokens.ts` is the only place sizes are decided.
 */
import { Text as RNText, type TextProps, type TextStyle } from 'react-native';

import type { ColorTokens, typography } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

type Variant = keyof typeof typography;

type Tone =
  | 'default'
  | 'muted'
  | 'faint'
  | 'accent'
  | 'primary'
  | 'danger'
  | 'success'
  | 'onAccent';

/**
 * Tone to colour token. Module-level, because this component renders once per piece
 * of text on screen and allocating the map in the component body made it the most
 * frequently constructed object in the app.
 */
const TONE_TOKEN: Record<Tone, keyof ColorTokens> = {
  default: 'text',
  muted: 'textMuted',
  faint: 'textFaint',
  accent: 'accentText',
  primary: 'primaryText',
  danger: 'danger',
  success: 'success',
  onAccent: 'onAccent',
};

export type AppTextProps = TextProps & {
  variant?: Variant;
  tone?: Tone;
  center?: boolean;
};

export function Text({
  variant = 'body',
  tone = 'default',
  center,
  style,
  ...rest
}: AppTextProps) {
  const theme = useTheme();

  return (
    <RNText
      style={[
        theme.typography[variant] as TextStyle,
        { color: theme.colors[TONE_TOKEN[tone]] },
        center ? { textAlign: 'center' } : null,
        style,
      ]}
      {...rest}
    />
  );
}

/** Dutch content inside an exercise, rendered a little larger than UI text. */
export function DutchText(props: AppTextProps) {
  return <Text variant="dutch" {...props} />;
}
