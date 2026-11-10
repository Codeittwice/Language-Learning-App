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
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { Suspense, useEffect, useSyncExternalStore } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/notifications';
import { DATABASE_NAME } from '@/db';
import { migrate } from '@/db/migrations';
import { importSeedPhrases } from '@/db/repo/phrases';
import { getSoundEnabled, getStringSetting, SETTING_KEYS, setSetting } from '@/db/repo/settings';
import { setSoundEnabled } from '@/audio/sfx';
import { Bootstrap } from '@/notifications/bootstrap';
import { themeFor } from '@/theme/tokens';
import { nowIso } from '@/time/day';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

// SQLite's web worker only exists in the browser. Render the same loading shell
// on the server and during hydration before attempting to open the local database.
const subscribeToClient = () => () => undefined;
const clientSnapshot = () => true;
const serverSnapshot = () => false;

async function prepareDatabase(db: SQLiteDatabase) {
  await migrate(db);
  if (!(await getStringSetting(db, SETTING_KEYS.seedImportedAt))) {
    await importSeedPhrases(db);
    await setSetting(db, SETTING_KEYS.seedImportedAt, nowIso());
  }
  // Mirror the stored sound preference into the audio module once, here, so that
  // every later `play()` is a synchronous flag check rather than a database read.
  setSoundEnabled(await getSoundEnabled(db));
}

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
  const client = useSyncExternalStore(subscribeToClient, clientSnapshot, serverSnapshot);

  useEffect(() => {
    // The splash stays up until the first frame after migrations have settled.
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
          <Suspense fallback={<MigrationFallback />}>
            {client ? (
            <SQLiteProvider databaseName={DATABASE_NAME} onInit={prepareDatabase} useSuspense>
              <Bootstrap />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                  name="settings"
                  options={{ presentation: 'card', headerShown: false }}
                />
              </Stack>
            </SQLiteProvider>
            ) : <MigrationFallback />}
          </Suspense>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
