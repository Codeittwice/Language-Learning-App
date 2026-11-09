/**
 * The streak.
 *
 * Always recomputed from the ordered set of days whose goal was met, never
 * incremented in place. A stored counter mutated at midnight is how every streak bug
 * in every app happens; a pure function over a date set is travel-proof, DST-proof
 * and reproducible in a test.
 *
 * Freezes are borrowed from Duolingo because they work: they stop one bad Tuesday
 * ending a three-month habit, which is the exact failure this app exists to prevent.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { emit } from '@/db/events';
import { type DayKey, diffDayKeys, nowIso, prevDayKey } from '@/time/day';

/** One freeze granted per this many days of streak. */
export const DAYS_PER_FREEZE = 10;
export const MAX_FREEZES = 2;

export type StreakState = {
  current: number;
  longest: number;
  lastGoalDay: DayKey | null;
  freezesAvailable: number;
  /** True when today still needs practice to keep the run going. */
  atRisk: boolean;
};

export type StreakComputation = StreakState & {
  /** Days bridged by a freeze in the current run, for an honest UI. */
  frozenDays: DayKey[];
};

/**
 * Compute a streak from the days whose goal was met.
 *
 * Exported separately from the database so it can be tested exhaustively against
 * gaps, travel and midnight edges without a SQLite instance.
 */
export function computeStreak(
  goalDays: readonly DayKey[],
  todayKey: DayKey,
  freezesAvailable: number
): StreakComputation {
  const met = new Set(goalDays);
  const sorted = [...met].sort();
  const lastGoalDay = sorted.length > 0 ? sorted[sorted.length - 1]! : null;

  // Longest run ever, ignoring freezes: a historical fact, not a live state.
  let longest = 0;
  let run = 0;
  let previous: DayKey | null = null;
  for (const day of sorted) {
    run = previous !== null && diffDayKeys(previous, day) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    previous = day;
  }

  // The current run walks back from today, or from yesterday when today is not done
  // yet -- not practising *so far today* must not read as a broken streak.
  let cursor = met.has(todayKey) ? todayKey : prevDayKey(todayKey);
  if (!met.has(cursor) && freezesAvailable <= 0) {
    return {
      current: 0,
      longest,
      lastGoalDay,
      freezesAvailable,
      atRisk: !met.has(todayKey),
      frozenDays: [],
    };
  }

  let current = 0;
  let freezesLeft = freezesAvailable;
  const frozenDays: DayKey[] = [];

  for (;;) {
    if (met.has(cursor)) {
      current += 1;
      cursor = prevDayKey(cursor);
      continue;
    }
    // A single missed day can be bridged by a freeze; two in a row cannot.
    if (freezesLeft > 0 && current > 0 && met.has(prevDayKey(cursor))) {
      freezesLeft -= 1;
      frozenDays.push(cursor);
      cursor = prevDayKey(cursor);
      continue;
    }
    break;
  }

  return {
    current,
    longest: Math.max(longest, current),
    lastGoalDay,
    freezesAvailable: freezesLeft,
    atRisk: !met.has(todayKey),
    frozenDays,
  };
}

/** How many freezes a streak of this length has earned, capped. */
export function earnedFreezes(currentStreak: number): number {
  return Math.min(MAX_FREEZES, Math.floor(currentStreak / DAYS_PER_FREEZE));
}

/**
 * Recompute from the database and cache the result.
 *
 * The `streak_state` row is a cache for fast rendering; this function is the source
 * of truth, and it reads `daily_activity` every time.
 */
export async function recomputeStreak(
  db: SQLiteDatabase,
  todayKey: DayKey
): Promise<StreakState> {
  const rows = await db.getAllAsync<{ day_key: string }>(
    'SELECT day_key FROM daily_activity WHERE goal_met = 1 ORDER BY day_key'
  );
  const goalDays = rows.map((row) => row.day_key);

  const stored = await db.getFirstAsync<{ freezes_available: number; longest_streak: number }>(
    'SELECT freezes_available, longest_streak FROM streak_state WHERE id = 1'
  );

  const computed = computeStreak(goalDays, todayKey, stored?.freezes_available ?? 0);

  // Earning a freeze never removes one already banked.
  const freezes = Math.max(computed.freezesAvailable, earnedFreezes(computed.current));
  const longest = Math.max(computed.longest, stored?.longest_streak ?? 0);

  await db.runAsync(
    `INSERT INTO streak_state (id, current_streak, longest_streak, last_goal_day, freezes_available, computed_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       current_streak = excluded.current_streak,
       longest_streak = excluded.longest_streak,
       last_goal_day = excluded.last_goal_day,
       freezes_available = excluded.freezes_available,
       computed_at = excluded.computed_at`,
    [computed.current, longest, computed.lastGoalDay, freezes, nowIso()]
  );

  emit('gamification:changed');
  return {
    current: computed.current,
    longest,
    lastGoalDay: computed.lastGoalDay,
    freezesAvailable: freezes,
    atRisk: computed.atRisk,
  };
}

/** Read the cached streak without recomputing, for a fast first paint. */
export async function readStreak(
  db: SQLiteDatabase,
  todayKey: DayKey
): Promise<StreakState> {
  const row = await db.getFirstAsync<{
    current_streak: number;
    longest_streak: number;
    last_goal_day: string | null;
    freezes_available: number;
  }>(
    'SELECT current_streak, longest_streak, last_goal_day, freezes_available FROM streak_state WHERE id = 1'
  );
  if (!row) return recomputeStreak(db, todayKey);

  return {
    current: row.current_streak,
    longest: row.longest_streak,
    lastGoalDay: row.last_goal_day,
    freezesAvailable: row.freezes_available,
    atRisk: row.last_goal_day !== todayKey,
  };
}
