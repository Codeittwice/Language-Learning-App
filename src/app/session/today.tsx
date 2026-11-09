/**
 * The route a notification taps into.
 *
 * It resolves what "today's session" means right now -- resume the one in progress,
 * or start the next at the learner's default length -- and redirects. Keeping that
 * decision in a route rather than in the notification payload means a reminder
 * scheduled two weeks ago still lands in the right place.
 */
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { getProfile } from '@/db/repo/profile';
import { startOrResume } from '@/session/engine';
import { useTheme } from '@/theme/use-theme';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';

export default function ResolveTodaySession() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const profile = await getProfile(db);
        const session = await startOrResume(db, { mode: profile.defaultDurationMode });
        if (cancelled) return;
        router.replace(`/session/${session.id}`);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'Could not start a session.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, router]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.space.xl,
        gap: theme.space.lg,
      }}
    >
      {error ? (
        <>
          <Text variant="h3" center>
            Could not open your session
          </Text>
          <Text variant="small" tone="muted" center>
            {error}
          </Text>
          <Button title="Back" variant="secondary" onPress={() => router.replace('/')} />
        </>
      ) : (
        <ActivityIndicator color={theme.colors.primary} />
      )}
    </View>
  );
}
