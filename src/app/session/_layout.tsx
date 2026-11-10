/**
 * The session stack.
 *
 * A full-screen presentation with no tab bar and no swipe-back: during practice there
 * is exactly one thing on screen to do. Leaving happens through the explicit close
 * control, which saves a checkpoint first.
 */
import { Stack } from 'expo-router';

import { useTheme } from '@/theme/use-theme';
import { usePracticeTime } from '@/session/use-practice-time';

export default function SessionLayout() {
  const theme = useTheme();
  usePracticeTime();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: theme.colors.bg },
      }}
    />
  );
}
