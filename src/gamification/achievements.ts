import type { SQLiteDatabase } from 'expo-sqlite';

import { masteryCounts } from '@/db/repo/phrases';
import { completedSessionCount } from '@/db/repo/sessions';
import { currentDayKey } from '@/db/repo/profile';
import { readStreak } from '@/gamification/streak';
import { nowIso } from '@/time/day';

export const ACHIEVEMENTS = {
  first_review: 'First Day 7 review',
  week_four: 'Four weeks of sessions',
  streak_30: '30-day streak',
  words_100: '100 mastered phrases',
} as const;

export async function refreshAchievements(db: SQLiteDatabase) {
  const [sessions, mastery, day, firstReview] = await Promise.all([
    completedSessionCount(db), masteryCounts(db), currentDayKey(db),
    db.getFirstAsync<{ found: number }>(
      "SELECT 1 AS found FROM sessions WHERE kind = 'scheduled' AND status = 'completed' AND rotation_day = 7 LIMIT 1"
    ),
  ]);
  const streak = await readStreak(db, day);
  const reached = {
    first_review: Boolean(firstReview),
    week_four: sessions >= 28,
    streak_30: streak.longest >= 30,
    words_100: mastery.mastered >= 100,
  };
  const now = nowIso();
  for (const key of Object.keys(ACHIEVEMENTS) as (keyof typeof ACHIEVEMENTS)[]) {
    if (reached[key]) await db.runAsync(
      'INSERT INTO achievements (key, unlocked_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', [key, now]
    );
  }
  return db.getAllAsync<{ key: keyof typeof ACHIEVEMENTS; unlocked_at: string }>(
    'SELECT key, unlocked_at FROM achievements ORDER BY unlocked_at, key'
  );
}
