/**
 * Buttons and chips.
 *
 * Every press gives haptic feedback, which is most of what makes a drill feel
 * responsive rather than merely functional. Haptics are best-effort: they are absent
 * on some devices and must never throw into a press handler.
 */
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/theme/use-theme';
import { Text } from '@/ui/text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'large' | 'medium' | 'small';

export function tapFeedback(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  Haptics.impactAsync(style).catch(() => undefined);
}

export function successFeedback() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

export function warningFeedback() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
}

export type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Rendered before the label, typically an icon. */
  leading?: ReactNode;
  fullWidth?: boolean;
  style?: ViewStyle;
};

export function Button({
  title,
  variant = 'primary',
  size = 'large',
  loading = false,
  leading,
  fullWidth = true,
  disabled,
  onPress,
  style,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const height = size === 'large' ? 54 : size === 'medium' ? 44 : 36;
  const paddingHorizontal = size === 'small' ? theme.space.md : theme.space.lg;

  const background: Record<ButtonVariant, string> = {
    primary: theme.colors.primary,
    secondary: theme.colors.surfaceAlt,
    ghost: 'transparent',
    danger: theme.colors.dangerSoft,
  };
  const label: Record<ButtonVariant, string> = {
    primary: theme.colors.onAccent,
    secondary: theme.colors.text,
    ghost: theme.colors.textMuted,
    danger: theme.colors.danger,
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(isDisabled), busy: loading }}
      disabled={isDisabled}
      onPress={(event) => {
        tapFeedback();
        onPress?.(event);
      }}
      style={({ pressed }) => [
        {
          height,
          paddingHorizontal,
          borderRadius: theme.radius.md,
          backgroundColor: background[variant],
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: theme.space.sm,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          opacity: isDisabled ? 0.45 : pressed ? 0.85 : 1,
          borderWidth: variant === 'ghost' ? StyleSheet.hairlineWidth : 0,
          borderColor: theme.colors.border,
        },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={label[variant]} />
      ) : (
        <>
          {leading}
          <Text
            variant={size === 'small' ? 'smallStrong' : 'bodyStrong'}
            style={{ color: label[variant] }}
          >
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'streak';
  leading?: ReactNode;
};

/** A small pill: a filter, a selectable option, or a static status badge. */
export function Chip({ label, selected = false, onPress, tone = 'neutral', leading }: ChipProps) {
  const theme = useTheme();

  const soft: Record<NonNullable<ChipProps['tone']>, string> = {
    neutral: theme.colors.surfaceAlt,
    accent: theme.colors.accentSoft,
    success: theme.colors.successSoft,
    danger: theme.colors.dangerSoft,
    streak: theme.colors.streakSoft,
  };
  const strong: Record<NonNullable<ChipProps['tone']>, string> = {
    neutral: theme.colors.text,
    accent: theme.colors.accentText,
    success: theme.colors.success,
    danger: theme.colors.danger,
    // The reward orange is a fill colour; `streakText` is its accessible twin.
    streak: theme.colors.streakText,
  };

  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.xs,
        paddingHorizontal: theme.space.md,
        paddingVertical: theme.space.sm,
        borderRadius: theme.radius.pill,
        backgroundColor: selected ? theme.colors.primary : soft[tone],
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: selected ? theme.colors.primary : theme.colors.border,
      }}
    >
      {leading}
      <Text
        variant="smallStrong"
        style={{ color: selected ? theme.colors.onAccent : strong[tone] }}
      >
        {label}
      </Text>
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        tapFeedback(Haptics.ImpactFeedbackStyle.Soft);
        onPress();
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      {body}
    </Pressable>
  );
}
