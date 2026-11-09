/**
 * Typography primitives.
 *
 * Everything that renders words goes through here, so the type scale in
 * `src/theme/tokens.ts` is the only place sizes are decided.
 */
import { Text as RNText, type TextProps, type TextStyle } from 'react-native';

import type { typography } from '@/theme/tokens';
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

  const colorFor: Record<Tone, string> = {
    default: theme.colors.text,
    muted: theme.colors.textMuted,
    faint: theme.colors.textFaint,
    accent: theme.colors.accentText,
    primary: theme.colors.primaryText,
    danger: theme.colors.danger,
    success: theme.colors.success,
    onAccent: theme.colors.onAccent,
  };

  return (
    <RNText
      style={[
        theme.typography[variant] as TextStyle,
        { color: colorFor[tone] },
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
