/**
 * A segmented control: one choice from three or four, laid out as a single track.
 *
 * Replaces the row of chips the duration picker used to be. Chips read as filters --
 * independently toggleable, any number on at once -- and session length is neither of
 * those things. A segmented track says "exactly one of these" before anything is read.
 */
import * as Haptics from 'expo-haptics';
import { Pressable, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/use-theme';
import { tapFeedback } from '@/ui/button';
import { Text } from '@/ui/text';

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
};

export type SegmentedControlProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  style?: ViewStyle;
  /** Describes the whole group for a screen reader, e.g. "Session length". */
  accessibilityLabel?: string;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  style,
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          flexDirection: 'row',
          padding: 3,
          gap: 3,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surfaceAlt,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => {
              tapFeedback(Haptics.ImpactFeedbackStyle.Soft);
              onChange(option.value);
            }}
            style={({ pressed }) => ({
              flex: 1,
              height: 40,
              borderRadius: theme.radius.sm,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? theme.colors.surface : 'transparent',
              opacity: pressed && !selected ? 0.6 : 1,
              // Only the selected segment is raised, which is what makes the track
              // read as one control rather than three buttons.
              ...(selected ? theme.shadow.card : null),
            })}
          >
            <Text
              variant="smallStrong"
              style={{
                color: selected ? theme.colors.text : theme.colors.textMuted,
                fontWeight: selected ? '700' : '600',
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
