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
  const unlocked = (Object.keys(ACHIEVEMENTS) as (keyof typeof ACHIEVEMENTS)[]).filter(
    (key) => reached[key]
  );

  // One statement rather than one per achievement. This used to be four sequential
  // awaited INSERTs on a path that a read was calling.
  if (unlocked.length > 0) {
    await db.runAsync(
      `INSERT INTO achievements (key, unlocked_at)
       VALUES ${unlocked.map(() => '(?, ?)').join(', ')}
       ON CONFLICT(key) DO NOTHING`,
      unlocked.flatMap((key) => [key, now])
    );
  }

  return readAchievements(db);
}

/**
 * What has been unlocked, computing and writing nothing.
 *
 * `refreshAchievements` writes, so it does not belong behind a screen read. It already
 * runs where unlocks can actually happen -- `finishSession` in `src/session/engine.ts`
 * -- and the Progress screen only needs to display the result.
 */
export async function readAchievements(db: SQLiteDatabase) {
  return db.getAllAsync<{ key: keyof typeof ACHIEVEMENTS; unlocked_at: string }>(
    'SELECT key, unlocked_at FROM achievements ORDER BY unlocked_at, key'
  );
}
