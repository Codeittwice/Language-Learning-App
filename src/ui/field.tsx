import { TextInput, type TextInputProps, View } from 'react-native';

import { useTheme } from '@/theme/use-theme';
import { Text } from '@/ui/text';

export function Field({ label, style, ...props }: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space.xs }}>
      <Text variant="smallStrong">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.colors.textMuted}
        {...props}
        style={[{
          color: theme.colors.text,
          backgroundColor: theme.colors.surfaceAlt,
          fontSize: theme.typography.body.fontSize,
          minHeight: 48,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.space.md,
          paddingVertical: theme.space.sm,
        }, style]}
      />
    </View>
  );
}
