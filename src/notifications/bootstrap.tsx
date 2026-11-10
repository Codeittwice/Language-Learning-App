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
import { AppState, Platform } from 'react-native';

import { currentDayKey, ensureProfile, syncTimezone } from '@/db/repo/profile';
import { ensureAndroidChannels } from '@/notifications';
import { cancelToday, healIfCleared, reconcileReminders } from '@/notifications/schedule';
import { on } from '@/db/events';
import { getDailyProgress } from '@/gamification/xp';
import { configureDutchSpeech } from '@/speech/tts';

export function Bootstrap() {
  const db = useSQLiteContext();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const profile = await ensureProfile(db);
        if (cancelled) return;
        configureDutchSpeech(profile.ttsVoiceId, profile.ttsRate);
        // Keep the stored timezone in step with the device; the reminder scheduler
        // uses a change here to force a full reschedule.
        await syncTimezone(db);
        // Channels must exist before any permission prompt can appear on Android 13+.
        await ensureAndroidChannels();
        if (Platform.OS !== 'web' && !(await healIfCleared(db))) await reconcileReminders(db, 'startup');
      } catch (error) {
        console.warn('[bootstrap] startup work failed', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const foreground = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void healIfCleared(db).then((healed) => {
        if (!healed) return reconcileReminders(db, 'foreground');
      }).catch(() => undefined);
    });
    const off = on('gamification:changed', () => {
      void currentDayKey(db).then((day) => getDailyProgress(db, day)).then((progress) => {
        if (progress.goalMet) return cancelToday(db);
      }).catch(() => undefined);
    });
    return () => { foreground.remove(); off(); };
  }, [db]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let lastOpened: string | null = null;
    /** Send a notification tap to the route it names. */
    const go = (response: Notifications.NotificationResponse | null) => {
      const request = response?.notification.request;
      const route = request?.content.data?.route;
      if (!request || request.identifier === lastOpened) return;
      if (route !== '/session/today' && route !== '/session/today?mode=quick') return;
      lastOpened = request.identifier;
      router.push(route);
      Notifications.clearLastNotificationResponse();
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(go);

    // Essential: the listener above does NOT fire for the tap that cold-starts the
    // app, which is exactly the tap that matters for a daily reminder.
    go(Notifications.getLastNotificationResponse());

    return () => subscription.remove();
  }, [router]);

  return null;
}
