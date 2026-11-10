import type { SQLiteDatabase } from 'expo-sqlite';
import { z } from 'zod';

import { parseJsonColumn } from '@/db';
import { masteryCounts } from '@/db/repo/phrases';
import { currentDayKey } from '@/db/repo/profile';
import { challengeHistory, completedSessionCount } from '@/db/repo/sessions';
import { refreshAchievements } from '@/gamification/achievements';
import { readStreak } from '@/gamification/streak';
import { getDailyProgress, readLevel, xpHistory } from '@/gamification/xp';
import { addDays, dayKeysBetween } from '@/time/day';
import type { RecallStatus } from '@/types';

const selfRating = z.object({ confidence: z.number().int().min(1).max(5).nullable() });

export async function readProgress(db: SQLiteDatabase) {
  const today = await currentDayKey(db);
  const since = addDays(today, -13);
  const [mastery, sessions, activity, ratings, corrections, challenges, achievements, recall, listening, level, daily, streak] = await Promise.all([
    masteryCounts(db), completedSessionCount(db), xpHistory(db, since, today),
    db.getAllAsync<{ session_number: number; result_json: string | null }>(
      `SELECT s.session_number, st.result_json FROM session_stages st JOIN sessions s ON s.id = st.session_id
        WHERE s.kind = 'scheduled' AND s.status = 'completed' AND st.stage = 'wrap_up'
          AND st.status = 'completed' AND st.result_json IS NOT NULL
        ORDER BY s.session_number DESC`
    ),
    db.getAllAsync<{ category: string; count: number }>(
      'SELECT category, COUNT(*) AS count FROM corrections WHERE is_required = 1 GROUP BY category ORDER BY count DESC, category'
    ),
    challengeHistory(db, 8),
    refreshAchievements(db),
    db.getAllAsync<{ status: RecallStatus; count: number }>(
      'SELECT status, COUNT(*) AS count FROM phrase_reviews GROUP BY status'
    ),
    db.getAllAsync<{ id: number; audio_source: string; gist_answer: string }>(
      'SELECT id, audio_source, gist_answer FROM listening_exercises WHERE gist_answer IS NOT NULL ORDER BY id DESC LIMIT 3'
    ),
    readLevel(db),
    getDailyProgress(db, today),
    readStreak(db, today),
  ]);
  const byDay = new Map(activity.map((entry) => [entry.dayKey, entry]));

  // Share of tested attempts produced with no help. Skipped items are excluded: they
  // were never attempted, and counting them would make skipping look like failing.
  const tested = recall
    .filter((row) => row.status !== 'not_tested')
    .reduce((sum, row) => sum + row.count, 0);
  const independent = recall.find((row) => row.status === 'independent')?.count ?? 0;

  return {
    mastery, sessions, corrections, challenges, achievements, recall, listening,
    level, streak, todayKey: today, goalXp: daily.goalXp,
    independentRate: tested > 0 ? independent / tested : null,
    xp: dayKeysBetween(since, today).map((dayKey) => ({
      dayKey,
      xp: byDay.get(dayKey)?.xp ?? 0,
      goalMet: byDay.get(dayKey)?.goalMet ?? false,
    })),
    confidence: ratings.flatMap((row) => {
      const rating = parseJsonColumn(row.result_json, selfRating, { confidence: null }, 'wrap-up confidence');
      return rating.confidence === null ? [] : [{ session: row.session_number, value: rating.confidence }];
    }).slice(0, 14).reverse(),
  };
}

export async function readReviewExamples(db: SQLiteDatabase, sessionId: string) {
  const baseline = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM sessions WHERE session_number = 1 AND status = 'completed' AND kind = 'scheduled' ORDER BY started_at LIMIT 1"
  );
  async function sample(id: string) {
    return db.getFirstAsync<{ recall: string | null; writing: string | null; roleplay: string | null; gist: string | null }>(
      `SELECT
        (SELECT r.learner_answer FROM phrase_reviews r
          WHERE r.session_id = ? AND r.learner_answer IS NOT NULL AND r.learner_answer <> '' ORDER BY r.id LIMIT 1) AS recall,
        (SELECT COALESCE(NULLIF(revision_text, ''), original_text) FROM writing_exercises WHERE session_id = ? ORDER BY id LIMIT 1) AS writing,
        (SELECT content FROM messages WHERE session_id = ? AND thread = 'roleplay' AND role = 'user' ORDER BY seq LIMIT 1) AS roleplay,
        (SELECT gist_answer FROM listening_exercises WHERE session_id = ? AND gist_answer IS NOT NULL ORDER BY id LIMIT 1) AS gist`,
      [id, id, id, id]
    );
  }
  const [earlier, current] = await Promise.all([baseline ? sample(baseline.id) : null, sample(sessionId)]);
  return { earlier, current };
}
