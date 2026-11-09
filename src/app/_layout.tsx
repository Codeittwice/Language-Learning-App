/**
 * Root layout.
 *
 * Order matters here:
 *  1. Importing `@/notifications` registers the foreground handler at module scope,
 *     before anything can be delivered.
 *  2. `SQLiteProvider` runs migrations in `onInit` and, with `useSuspense`, suspends
 *     until they finish -- so no screen can query a half-migrated database. That is
 *     the other classic expo-sqlite bug, and it only shows up on a cold start.
 */
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { Suspense, useEffect } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/notifications';
import { DATABASE_NAME } from '@/db';
import { migrate } from '@/db/migrations';
import { Bootstrap } from '@/app/bootstrap';
import { themeFor } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function MigrationFallback() {
  const scheme = useColorScheme();
  const theme = themeFor(scheme === 'dark' ? 'dark' : 'light');
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.bg,
      }}
    >
      <ActivityIndicator color={theme.colors.primary} />
    </View>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  useEffect(() => {
    // The splash stays up until the first frame after migrations have settled.
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
          <Suspense fallback={<MigrationFallback />}>
            <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrate} useSuspense>
              <Bootstrap />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                  name="settings"
                  options={{ presentation: 'card', headerShown: false }}
                />
              </Stack>
            </SQLiteProvider>
          </Suspense>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
