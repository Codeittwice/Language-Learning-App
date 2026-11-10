import { Stack } from 'expo-router';

import { useTheme } from '@/theme/use-theme';

export default function SettingsLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: theme.colors.bg },
        headerTintColor: theme.colors.text,
        headerTitleStyle: { color: theme.colors.text, fontWeight: '700' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.bg },
      }}
    >
      <Stack.Screen name="ai" options={{ title: 'AI provider' }} />
      <Stack.Screen name="reminders" options={{ title: 'Reminders' }} />
      <Stack.Screen name="data" options={{ title: 'Learning data' }} />
      <Stack.Screen name="profile" options={{ title: 'Practice preferences' }} />
    </Stack>
  );
}
