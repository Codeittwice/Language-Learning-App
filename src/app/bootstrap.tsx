/**
 * One-time startup work that needs a migrated database.
 *
 * Renders nothing. It lives inside `SQLiteProvider` so it is guaranteed to run after
 * migrations, and it is deliberately tolerant: a failure here degrades a feature, it
 * does not stop the app launching.
 */
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';

import { ensureProfile, syncTimezone } from '@/db/repo/profile';
import { ensureAndroidChannels } from '@/notifications';

export function Bootstrap() {
  const db = useSQLiteContext();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await ensureProfile(db);
        if (cancelled) return;
        // Keep the stored timezone in step with the device; the reminder scheduler
        // uses a change here to force a full reschedule.
        await syncTimezone(db);
        // Channels must exist before any permission prompt can appear on Android 13+.
        await ensureAndroidChannels();
      } catch (error) {
        console.warn('[bootstrap] startup work failed', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db]);

  useEffect(() => {
    /** Send a notification tap to the route it names. */
    const go = (response: Notifications.NotificationResponse | null) => {
      const route = response?.notification.request.content.data?.route;
      if (typeof route === 'string' && route.startsWith('/')) {
        router.push(route as Parameters<typeof router.push>[0]);
      }
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(go);

    // Essential: the listener above does NOT fire for the tap that cold-starts the
    // app, which is exactly the tap that matters for a daily reminder.
    Notifications.getLastNotificationResponseAsync().then(go).catch(() => undefined);

    return () => subscription.remove();
  }, [router]);

  return null;
}
