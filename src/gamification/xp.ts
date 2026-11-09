/**
 * XP, the daily goal, and what earns them.
 *
 * Two deliberate choices that go against the usual pattern:
 *
 *  - **A missed phrase still earns XP.** The spec's first teaching principle is
 *    communication before perfection; charging the learner for attempting is the
 *    fastest way to teach them not to attempt.
 *  - **Reporting a real-world challenge pays the same whatever the outcome.** The
 *    spec is explicit that not completing one is not a failure, so "attempted" and
 *    "not attempted" earn exactly what "completed" does.
 *
 * There are no hearts and no lives. They punish risky production, which is the one
 * behaviour the whole app is trying to encourage.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { toDb } from '@/db';
import { emit } from '@/db/events';
import { recomputeStreak, type StreakState } from '@/gamification/streak';
import { getProfile } from '@/db/repo/profile';
import { type DayKey, nowIso } from '@/time/day';

export const XP = {
  RECALL_INDEPENDENT: 10,
  RECALL_PROMPTED: 5,
  RECALL_MISSED: 2,
  ROUND_COMPLETE: 5,
  PERFECT_ROUND_BONUS: 5,
  STAGE_COMPLETE: 15,
  SESSION_COMPLETE: 50,
  FIRST_ACTIVITY_OF_DAY: 10,
  WRITING_REVISED: 10,
  LISTENING_DETAIL_CORRECT: 5,
  DICTIONARY_SAVE: 2,
  BOOK_WORD_LEARNED: 3,
  CHALLENGE_REPORTED: 10,
} as const;

export type XpKind = keyof typeof XP;

export type XpEvent = {
  kind: XpKind;
  /** Overrides the table value; used for variable awards like a round bonus. */
  amount?: number;
  sessionId?: string | null;
  stage?: string | null;
  refId?: string | null;
  /**
   * Makes the award idempotent. A remount, a double tap or a replayed navigation
   * with the same key adds nothing, thanks to the unique partial index.
   */
  dedupeKey?: string;
};

export type AwardResult = {
  awarded: number;
  todayXp: number;
  goalXp: number;
  goalMet: boolean;
  /** True only for the award that crossed the line, so the UI celebrates once. */
  justMetGoal: boolean;
  streak: StreakState;
};

/**
 * Award XP for one event and refresh the day's totals.
 *
 * Everything happens in a transaction, so a crash cannot leave the event recorded
 * without the daily total updated, or the other way round.
 */
export async function awardXp(
  db: SQLiteDatabase,
  dayKey: DayKey,
  event: XpEvent
): Promise<AwardResult> {
  const profile = await getProfile(db);
  const amount = event.amount ?? XP[event.kind];
  const now = nowIso();

  let awarded = 0;
  let wasMet = false;

  await db.withTransactionAsync(async () => {
    // Make sure today's row exists before reading it.
    await db.runAsync(
      `INSERT INTO daily_activity (day_key, xp, goal_xp, timezone, first_activity_at, last_activity_at)
       VALUES (?, 0, ?, ?, ?, ?)
       ON CONFLICT(day_key) DO NOTHING`,
      [dayKey, profile.dailyGoalXp, profile.timezone, now, now]
    );

    const before = await db.getFirstAsync<{ xp: number; goal_met: number }>(
      'SELECT xp, goal_met FROM daily_activity WHERE day_key = ?',
      [dayKey]
    );
    wasMet = before?.goal_met === 1;

    if (event.dedupeKey) {
      const existing = await db.getFirstAsync<{ id: number }>(
        'SELECT id FROM xp_events WHERE dedupe_key = ?',
        [event.dedupeKey]
      );
      if (existing) return; // Already credited; awarded stays 0.
    }

    await db.runAsync(
      `INSERT INTO xp_events (day_key, kind, amount, session_id, stage, ref_id, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dayKey,
        event.kind,
        amount,
        event.sessionId ?? null,
        event.stage ?? null,
        event.refId ?? null,
        event.dedupeKey ?? null,
        now,
      ]
    );
    awarded = amount;

    await db.runAsync(
      `UPDATE daily_activity
          SET xp = xp + ?,
              goal_met = CASE WHEN xp + ? >= goal_xp THEN 1 ELSE goal_met END,
              last_activity_at = ?
        WHERE day_key = ?`,
      [amount, amount, now, dayKey]
    );
  });

  const after = await db.getFirstAsync<{ xp: number; goal_xp: number; goal_met: number }>(
    'SELECT xp, goal_xp, goal_met FROM daily_activity WHERE day_key = ?',
    [dayKey]
  );

  const todayXp = after?.xp ?? 0;
  const goalXp = after?.goal_xp ?? profile.dailyGoalXp;
  const goalMet = after?.goal_met === 1;

  const streak = await recomputeStreak(db, dayKey);
  emit('gamification:changed');

  return { awarded, todayXp, goalXp, goalMet, justMetGoal: goalMet && !wasMet, streak };
}

export type DailyProgress = {
  dayKey: DayKey;
  xp: number;
  goalXp: number;
  goalMet: boolean;
  reviews: number;
  independentReviews: number;
};

export async function getDailyProgress(
  db: SQLiteDatabase,
  dayKey: DayKey
): Promise<DailyProgress> {
  const profile = await getProfile(db);
  const row = await db.getFirstAsync<{
    xp: number;
    goal_xp: number;
    goal_met: number;
    reviews: number;
    independent_reviews: number;
  }>(
    `SELECT xp, goal_xp, goal_met, reviews, independent_reviews
       FROM daily_activity WHERE day_key = ?`,
    [dayKey]
  );

  return {
    dayKey,
    xp: row?.xp ?? 0,
    goalXp: row?.goal_xp ?? profile.dailyGoalXp,
    goalMet: row?.goal_met === 1,
    reviews: row?.reviews ?? 0,
    independentReviews: row?.independent_reviews ?? 0,
  };
}

/** Keep the per-day review tallies in step after a recall attempt. */
export async function tallyReview(
  db: SQLiteDatabase,
  dayKey: DayKey,
  independent: boolean
): Promise<void> {
  const profile = await getProfile(db);
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO daily_activity (day_key, goal_xp, timezone, reviews, independent_reviews, first_activity_at, last_activity_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(day_key) DO UPDATE SET
       reviews = reviews + 1,
       independent_reviews = independent_reviews + ?,
       last_activity_at = excluded.last_activity_at`,
    [dayKey, profile.dailyGoalXp, profile.timezone, toDb(independent), now, now, toDb(independent)]
  );
  emit('gamification:changed');
}

export async function noteSessionCompleted(
  db: SQLiteDatabase,
  dayKey: DayKey
): Promise<void> {
  const profile = await getProfile(db);
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO daily_activity (day_key, goal_xp, timezone, sessions_completed, first_activity_at, last_activity_at)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(day_key) DO UPDATE SET
       sessions_completed = sessions_completed + 1,
       last_activity_at = excluded.last_activity_at`,
    [dayKey, profile.dailyGoalXp, profile.timezone, now, now]
  );
  emit('gamification:changed');
}

/** XP earned per day over a range, for the progress chart. */
export async function xpHistory(
  db: SQLiteDatabase,
  fromDayKey: DayKey,
  toDayKey: DayKey
): Promise<{ dayKey: DayKey; xp: number; goalMet: boolean }[]> {
  const rows = await db.getAllAsync<{ day_key: string; xp: number; goal_met: number }>(
    `SELECT day_key, xp, goal_met FROM daily_activity
      WHERE day_key BETWEEN ? AND ? ORDER BY day_key`,
    [fromDayKey, toDayKey]
  );
  return rows.map((row) => ({
    dayKey: row.day_key,
    xp: row.xp,
    goalMet: row.goal_met === 1,
  }));
}
