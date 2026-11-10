/**
 * XP, the daily goal, and what earns them.
 *
 * Three deliberate choices that go against the usual pattern:
 *
 *  - **A missed phrase still earns XP.** The spec's first teaching principle is
 *    communication before perfection; charging the learner for attempting is the
 *    fastest way to teach them not to attempt.
 *  - **Reporting a real-world challenge pays the same whatever the outcome.** The
 *    spec is explicit that not completing one is not a failure, so "attempted" and
 *    "not attempted" earn exactly what "completed" does.
 *  - **XP is never taken away.** There are no hearts and no lives. They punish risky
 *    production, which is the one behaviour the whole app is trying to encourage.
 *
 * ## Why the values changed
 *
 * The first balance had a hole in it: the daily goal was 30 XP and one unprompted
 * recall paid 10, so three cards -- under a minute -- met the goal and banked the
 * streak. The goal measured nothing.
 *
 * The fix is not bigger numbers, it is **per-activity daily caps**. Volume is capped
 * so the goal cannot be farmed by tapping through flashcards; finishing things
 * (rounds, stages, a session) is uncapped, because that is the behaviour worth
 * rewarding. Grinding recall and nothing else now tops out below the daily goal on
 * purpose: you have to complete something.
 *
 * The one exception to the caps is the combo bonus, which has a cap of its own. It
 * rewards *quality* -- a run of answers produced with no help -- and putting it inside
 * the recall cap would mean the volume ceiling swallowed it and the mechanic never
 * fired at all.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { toDb } from '@/db';
import { emit } from '@/db/events';
import { type LevelState, levelStateFromXp } from '@/gamification/levels';
import { recomputeStreak, type StreakState } from '@/gamification/streak';
import { getProfile } from '@/db/repo/profile';
import { type DayKey, learningDayRangeUtc, nowIso } from '@/time/day';

export const XP = {
  RECALL_INDEPENDENT: 6,
  RECALL_PROMPTED: 3,
  RECALL_MISSED: 1,
  /** Extra for a run of unprompted answers. Amount is always passed explicitly. */
  COMBO_BONUS: 2,
  ROUND_COMPLETE: 5,
  PERFECT_ROUND_BONUS: 5,
  STAGE_COMPLETE: 10,
  SESSION_COMPLETE: 40,
  FIRST_ACTIVITY_OF_DAY: 5,
  WRITING_REVISED: 10,
  LISTENING_DETAIL_CORRECT: 4,
  DICTIONARY_SAVE: 1,
  BOOK_WORD_LEARNED: 2,
  CHALLENGE_REPORTED: 15,
} as const;

export type XpKind = keyof typeof XP;

/**
 * The default daily goal. A 7-minute Quick session clears it; flashcards alone do not.
 * Defined in `@/types` so `db/repo/profile.ts` can read it without an import cycle.
 */
export { DEFAULT_DAILY_GOAL_XP } from '@/types';

/**
 * Daily ceilings, by group of kinds.
 *
 * A kind absent from this table is uncapped: rounds, stages, the session, the first
 * activity of the day and the real-world challenge. Those are all either
 * once-per-day or gated behind actually finishing something.
 */
type CapGroup = {
  /** Shown to the learner when the ceiling is reached. */
  label: string;
  limit: number;
  kinds: readonly XpKind[];
};

export const DAILY_CAPS: readonly CapGroup[] = [
  { label: 'recall', limit: 30, kinds: ['RECALL_INDEPENDENT', 'RECALL_PROMPTED', 'RECALL_MISSED'] },
  { label: 'combo bonus', limit: 12, kinds: ['COMBO_BONUS'] },
  { label: 'writing', limit: 20, kinds: ['WRITING_REVISED'] },
  { label: 'listening', limit: 20, kinds: ['LISTENING_DETAIL_CORRECT'] },
  { label: 'dictionary', limit: 10, kinds: ['DICTIONARY_SAVE'] },
  { label: 'book', limit: 20, kinds: ['BOOK_WORD_LEARNED'] },
];

function capGroupFor(kind: XpKind): CapGroup | null {
  return DAILY_CAPS.find((group) => group.kinds.includes(kind)) ?? null;
}

/* The combo ---------------------------------------------------------------- */

/** Unprompted answers in a row needed for each multiplier, highest first. */
export const COMBO_TIERS: readonly { run: number; multiplier: number }[] = [
  { run: 6, multiplier: 1.5 },
  { run: 3, multiplier: 1.25 },
];

/**
 * The multiplier for a run of `run` unprompted answers.
 *
 * A hint or a miss resets the run but never costs XP: the bonus exists to reward the
 * brave answer, not to punish the careful one. That asymmetry is the whole reason
 * this is safe to add to an app whose first principle is communication over
 * correctness.
 */
export function comboMultiplier(run: number): number {
  for (const tier of COMBO_TIERS) {
    if (run >= tier.run) return tier.multiplier;
  }
  return 1;
}

/** The extra XP a run earns on top of the base award. Zero below the first tier. */
export function comboBonus(baseAmount: number, run: number): number {
  const multiplier = comboMultiplier(run);
  if (multiplier <= 1) return 0;
  return Math.round(baseAmount * (multiplier - 1));
}

/* Awarding ----------------------------------------------------------------- */

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
  /** Where the lifetime total has got to, after this award. */
  level: LevelState;
  /** True only for the award that crossed a level, so the UI celebrates once. */
  justLeveled: boolean;
  /**
   * Set when the award was reduced or refused by a daily ceiling, naming the group.
   * The UI can say "recall is capped for today" instead of silently paying nothing.
   */
  cappedBy: string | null;
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
  const requested = event.amount ?? XP[event.kind];
  const now = nowIso();

  // Read before the transaction so the level comparison has a baseline. Single
  // writer, so nothing else can move this between here and the insert.
  const lifetimeBefore = await lifetimeXp(db);

  let awarded = 0;
  let wasMet = false;
  let cappedBy: string | null = null;

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

    // Clamp to whatever headroom the day's ceiling leaves, which may be nothing.
    let amount = requested;
    const cap = capGroupFor(event.kind);
    if (cap) {
      const placeholders = cap.kinds.map(() => '?').join(', ');
      const spent = await db.getFirstAsync<{ total: number }>(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM xp_events
          WHERE day_key = ? AND kind IN (${placeholders})`,
        [dayKey, ...cap.kinds]
      );
      const headroom = Math.max(0, cap.limit - (spent?.total ?? 0));
      if (amount > headroom) {
        amount = headroom;
        cappedBy = cap.label;
      }
    }

    // A zero award records nothing: a table full of 0 XP rows would make the history
    // unreadable, and the dedupe key stays free in case the cap is ever raised.
    if (amount <= 0) return;

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

  const levelBefore = levelStateFromXp(lifetimeBefore);
  const level = levelStateFromXp(lifetimeBefore + awarded);

  const streak = await recomputeStreak(db, dayKey);
  emit('gamification:changed');

  return {
    awarded,
    todayXp,
    goalXp,
    goalMet,
    justMetGoal: goalMet && !wasMet,
    streak,
    level,
    justLeveled: level.level > levelBefore.level,
    cappedBy,
  };
}

/* Reading ------------------------------------------------------------------ */

/**
 * Lifetime XP: the sum of every event ever recorded.
 *
 * Summed rather than cached. `xp_events` is append-only and small -- a year of hard
 * use is a few thousand rows -- and a cached total is one more thing that can drift
 * away from the events that justify it.
 */
export async function lifetimeXp(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ total: number }>(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM xp_events'
  );
  return row?.total ?? 0;
}

/** The level, tier and progress for the lifetime total. */
export async function readLevel(db: SQLiteDatabase): Promise<LevelState> {
  return levelStateFromXp(await lifetimeXp(db));
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
  const { startUtc, endUtc } = learningDayRangeUtc(dayKey, profile.timezone, profile.dayStartHour);
  await db.runAsync(
    `INSERT INTO daily_activity (day_key, goal_xp, timezone, sessions_completed, first_activity_at, last_activity_at)
     SELECT ?, ?, ?, COUNT(*), ?, ? FROM sessions
      WHERE counted = 1 AND completed_at >= ? AND completed_at < ?
     ON CONFLICT(day_key) DO UPDATE SET
       sessions_completed = excluded.sessions_completed,
       last_activity_at = excluded.last_activity_at`,
    [dayKey, profile.dailyGoalXp, profile.timezone, now, now, startUtc, endUtc]
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

/* The adaptive goal -------------------------------------------------------- */

/** Lowest and highest the adaptive goal will ever suggest. */
export const GOAL_FLOOR = 40;
export const GOAL_CEILING = 150;

/**
 * The goal this learner's recent history justifies.
 *
 * Three quarters of the median of the last seven days, rounded to ten, clamped. The
 * median rather than the mean so one heroic Sunday cannot raise the bar for the
 * month; three quarters so the goal sits a little under a typical day, because a goal
 * you meet is a streak you keep. It moves by at most one step of 10 per call, so the
 * bar never jumps.
 *
 * Pure, so the whole policy is testable without a database.
 */
export function adaptiveGoal(recentXp: readonly number[], currentGoal: number): number {
  if (recentXp.length < 7) return currentGoal;

  const sorted = [...recentXp].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);

  const target = Math.round((median * 0.75) / 10) * 10;
  const clamped = Math.min(GOAL_CEILING, Math.max(GOAL_FLOOR, target));

  // One step at a time, in either direction.
  if (clamped > currentGoal) return Math.min(clamped, currentGoal + 10);
  if (clamped < currentGoal) return Math.max(clamped, currentGoal - 10);
  return currentGoal;
}
