/**
 * Layout primitives: screens, cards, rows and separators.
 */
import type { ReactNode } from 'react';
import {
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  View,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/use-theme';

/** A full screen with the themed background and safe-area padding. */
export function Screen({ children, style, ...rest }: ViewProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        { flex: 1, backgroundColor: theme.colors.bg, paddingTop: insets.top },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

/** A scrolling screen body. `bottomInset` keeps content clear of the tab bar. */
export function ScreenScroll({
  children,
  contentContainerStyle,
  bottomInset = 24,
  ...rest
}: ScrollViewProps & { children?: ReactNode; bottomInset?: number }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.bg }}
      contentContainerStyle={[
        {
          padding: theme.space.lg,
          gap: theme.space.lg,
          paddingBottom: insets.bottom + bottomInset,
        },
        contentContainerStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      {...rest}
    >
      {children}
    </ScrollView>
  );
}

export type CardProps = ViewProps & {
  /** `flat` drops the shadow, for cards inside an already-raised surface. */
  variant?: 'raised' | 'flat';
  padded?: boolean;
};

export function Card({
  variant = 'raised',
  padded = true,
  style,
  children,
  ...rest
}: CardProps) {
  const theme = useTheme();
  const base: ViewStyle = {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    padding: padded ? theme.space.lg : 0,
    gap: theme.space.md,
  };
  return (
    <View style={[base, variant === 'raised' ? theme.shadow.card : null, style]} {...rest}>
      {children}
    </View>
  );
}

export function Row({ style, children, gap, ...rest }: ViewProps & { gap?: number }) {
  const theme = useTheme();
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: gap ?? theme.space.md },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

export function Separator({ style }: { style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <View
      style={[
        { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border },
        style,
      ]}
    />
  );
}

/** Pushes siblings apart in a row, or adds fixed vertical space. */
export function Spacer({ size }: { size?: number }) {
  return size === undefined ? <View style={{ flex: 1 }} /> : <View style={{ height: size }} />;
}
