/**
 * A hairline row.
 *
 * This is the component that replaces most of the cards. The old screens were a stack
 * of five identically bordered, identically shadowed white cards, which made
 * everything on screen exactly as important as everything else -- so the eye had
 * nowhere to land. Depth is now reserved for "act on this": at most one raised card
 * per screen, and everything else is a row like this one on the page background.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/use-theme';
import { tapFeedback } from '@/ui/button';
import { Text } from '@/ui/text';

export type ListRowProps = {
  title: string;
  detail?: string;
  /** Rendered instead of `detail`, for a line that needs its own styling. */
  children?: ReactNode;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Tint for the icon tile. `primary` is reserved for actions. */
  tone?: 'accent' | 'primary' | 'success' | 'streak' | 'neutral';
  /** A short value pinned to the right, before the chevron. */
  value?: string;
  onPress?: () => void;
  /** Draw the top hairline too. Set on the first row of a group. */
  first?: boolean;
  style?: ViewStyle;
};

export function ListRow({
  title,
  detail,
  children,
  icon,
  tone = 'accent',
  value,
  onPress,
  first = false,
  style,
}: ListRowProps) {
  const theme = useTheme();

  const tileBg: Record<NonNullable<ListRowProps['tone']>, string> = {
    accent: theme.colors.accentSoft,
    primary: theme.colors.primarySoft,
    success: theme.colors.successSoft,
    streak: theme.colors.streakSoft,
    neutral: theme.colors.surfaceAlt,
  };
  const tileFg: Record<NonNullable<ListRowProps['tone']>, string> = {
    accent: theme.colors.accentText,
    primary: theme.colors.primaryText,
    success: theme.colors.success,
    streak: theme.colors.streakText,
    neutral: theme.colors.textMuted,
  };

  const body = (
    <>
      {icon ? (
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: theme.radius.sm + 2,
            backgroundColor: tileBg[tone],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={17} color={tileFg[tone]} />
        </View>
      ) : null}

      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{title}</Text>
        {children ?? (detail ? <Text variant="small" tone="muted">{detail}</Text> : null)}
      </View>

      {value ? <Text variant="smallStrong" tone="muted">{value}</Text> : null}
      {onPress ? (
        <Ionicons name="chevron-forward" size={16} color={theme.colors.textFaint} />
      ) : null}
    </>
  );

  const frame: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    paddingVertical: theme.space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    borderTopWidth: first ? StyleSheet.hairlineWidth : 0,
    borderTopColor: theme.colors.border,
  };

  if (!onPress) return <View style={[frame, style]}>{body}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => [frame, { opacity: pressed ? 0.6 : 1 }, style]}
    >
      {body}
    </Pressable>
  );
}
