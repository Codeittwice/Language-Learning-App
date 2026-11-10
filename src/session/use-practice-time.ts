import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback } from 'react';
import { AppState } from 'react-native';

import { getProfile } from '@/db/repo/profile';
import { dayKeyOf, learningDayRangeUtc } from '@/time/day';

const FLUSH_MS = 15_000;
const MAX_SLICE_MS = 30_000;

/** Approximate foreground session time, independent of XP and speaking activity. */
export function usePracticeTime() {
  const db = useSQLiteContext();
  useFocusEffect(useCallback(() => {
    let started = AppState.currentState === 'active' ? Date.now() : null;
    let writes = Promise.resolve();
    const flush = (now: number) => {
      if (started === null) return;
      const from = Math.max(started, now - MAX_SLICE_MS);
      if (now - from < 1000) return;
      started = now;
      writes = writes.then(async () => {
        const profile = await getProfile(db);
        let cursor = from;
        while (cursor < now) {
          const day = dayKeyOf(new Date(cursor), profile.timezone, profile.dayStartHour);
          const { endUtc } = learningDayRangeUtc(day, profile.timezone, profile.dayStartHour);
          const until = Math.min(now, Date.parse(endUtc));
          if (until <= cursor) break;
          const seconds = Math.floor((until - cursor) / 1000);
          if (seconds > 0) {
            await db.runAsync(
              `INSERT INTO daily_activity (day_key, goal_xp, timezone, active_seconds, first_activity_at, last_activity_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(day_key) DO UPDATE SET active_seconds = active_seconds + excluded.active_seconds`,
              [day, profile.dailyGoalXp, profile.timezone, seconds, new Date(cursor).toISOString(), new Date(until).toISOString()]
            );
          }
          cursor = until;
        }
      }).catch(() => undefined);
    };

    const subscription = AppState.addEventListener('change', (state) => {
      const now = Date.now();
      if (state === 'active') started ??= now;
      else { flush(now); started = null; }
    });
    const interval = setInterval(() => flush(Date.now()), FLUSH_MS);
    return () => {
      clearInterval(interval);
      subscription.remove();
      flush(Date.now());
    };
  }, [db]));
}
