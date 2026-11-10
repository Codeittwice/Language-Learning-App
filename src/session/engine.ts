/**
 * Starting, resuming and finishing a practice session.
 *
 * The rules this encodes, all from the spec:
 *  - Missed calendar days do not advance the session number, and never create a
 *    backlog to catch up on.
 *  - A session completes exactly once, however many times the button is pressed.
 *  - Returning the same day after finishing offers extra practice, which does not
 *    advance the schedule.
 *  - Resuming goes to the stage that is actually next, from the database, so it works
 *    identically from the Today button, a notification tap and a cold start.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { awardXp, noteSessionCompleted } from '@/gamification/xp';
import { refreshAchievements } from '@/gamification/achievements';
import { countDue } from '@/db/repo/phrases';
import { currentDayKey, getProfile } from '@/db/repo/profile';
import { learningDayRangeUtc } from '@/time/day';
import {
  abandonSession,
  completedSessionCount,
  completeSession,
  completeStage,
  createSession,
  getActiveSession,
  getLatestCheckpoint,
  getSession,
  getStages,
  openChallenge,
  type Session,
  skipStage,
  startStage,
} from '@/db/repo/sessions';
import { firstStage, planFor, stagesFor } from '@/session/plan';
import { rotationDayFor, topicFor, weekFocusFor, weekFor } from '@/session/rotation';
import type { DurationMode, SessionStage } from '@/types';

export type TodayState = {
  completedSessions: number;
  /** The session that will run next, whether or not one is in progress. */
  sessionNumber: number;
  week: number;
  rotationDay: number;
  topicLabel: string;
  topicKey: string;
  weekFocus: string;
  dueCount: number;
  active: Session | null;
  /** Stage progress for the in-progress session, if there is one. */
  progress: { completed: number; total: number; nextStage: SessionStage | null } | null;
  /** True when today's scheduled session has already been completed. */
  finishedToday: boolean;
  challenge: { id: number; action: string } | null;
};

export async function getTodayState(db: SQLiteDatabase): Promise<TodayState> {
  const [completed, active, dayKey, challenge] = await Promise.all([
    completedSessionCount(db),
    getActiveSession(db),
    currentDayKey(db),
    openChallenge(db),
  ]);

  const dueCount = await countDue(db, new Date());

  // An in-progress session keeps its own number; otherwise the next one is simply
  // one past however many have been completed. Calendar days never enter into it.
  const sessionNumber = active ? active.sessionNumber : completed + 1;
  const topic = topicFor(sessionNumber);

  let progress: TodayState['progress'] = null;
  if (active) {
    const stages = await getStages(db, active.id);
    const done = stages.filter(
      (stage) => stage.status === 'completed' || stage.status === 'skipped'
    ).length;
    progress = { completed: done, total: stages.length, nextStage: active.nextStage };
  }

  const finishedToday = await hasCompletedScheduledSessionOn(db, dayKey);

  return {
    completedSessions: completed,
    sessionNumber,
    week: weekFor(sessionNumber),
    rotationDay: rotationDayFor(sessionNumber),
    topicLabel: topic.label,
    topicKey: topic.key,
    weekFocus: weekFocusFor(sessionNumber),
    dueCount,
    active,
    progress,
    finishedToday,
    challenge: challenge ? { id: challenge.id, action: challenge.action } : null,
  };
}

async function hasCompletedScheduledSessionOn(
  db: SQLiteDatabase,
  dayKey: string
): Promise<boolean> {
  const profile = await getProfile(db);
  const { startUtc, endUtc } = learningDayRangeUtc(dayKey, profile.timezone, profile.dayStartHour);
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sessions
      WHERE completed_at >= ? AND completed_at < ? AND counted = 1`,
    [startUtc, endUtc]
  );
  return (row?.n ?? 0) > 0;
}

export type StartOptions = {
  mode: DurationMode;
  /**
   * Extra practice after today's session is done. It never advances the schedule and
   * never increments the counter (spec section 2).
   */
  extra?: boolean;
};

/**
 * Resume the session in progress, or start the next one.
 *
 * If a session is already running in a different mode, the caller has asked to change
 * duration: the old one is abandoned rather than silently reshaped, so its recorded
 * stages stay truthful about what was actually practised.
 */
export async function startOrResume(
  db: SQLiteDatabase,
  options: StartOptions
): Promise<Session> {
  const active = await getActiveSession(db);

  if (active) {
    if (active.durationMode === options.mode) return active;
    await abandonSession(db, active.id);
  }

  const completed = await completedSessionCount(db);
  const dayKey = await currentDayKey(db);

  // Extra practice reuses the current topic but is not part of the schedule.
  const sessionNumber = options.extra ? completed : completed + 1;
  const effectiveNumber = Math.max(1, sessionNumber);
  const topic = topicFor(effectiveNumber);

  const stages = planFor(options.mode).map((plan) => ({
    stage: plan.stage,
    order: plan.order,
    rounds: plan.rounds.length,
  }));

  const session = await createSession(db, {
    sessionNumber: effectiveNumber,
    week: weekFor(effectiveNumber),
    rotationDay: rotationDayFor(effectiveNumber),
    topicKey: topic.key,
    durationMode: options.mode,
    kind: options.extra ? 'extra' : 'scheduled',
    dayKey,
    stages,
  });

  await startStage(db, session.id, firstStage(options.mode));
  return session;
}

/** Where a resume should land. Falls back to the first stage if nothing is recorded. */
export async function resumeStage(
  db: SQLiteDatabase,
  session: Session
): Promise<SessionStage> {
  if (session.nextStage) return session.nextStage;

  const stages = await getStages(db, session.id);
  const pending = stages.find((stage) => stage.status !== 'completed' && stage.status !== 'skipped');
  return pending?.stage ?? (stages.length ? 'wrap_up' : firstStage(session.durationMode));
}

/**
 * Report whether the stored stage records and the latest checkpoint disagree.
 *
 * The spec asks for uncertainty to be stated rather than guessed at, so the UI shows
 * this rather than silently picking one.
 */
export async function checkpointConflict(
  db: SQLiteDatabase,
  session: Session
): Promise<{ conflicted: boolean; checkpointStage: SessionStage | null }> {
  const checkpoint = await getLatestCheckpoint(db, session.id);
  if (!checkpoint) return { conflicted: false, checkpointStage: null };

  const expected = await resumeStage(db, session);
  const fromCheckpoint = checkpoint.nextStage ?? checkpoint.stage;
  const records = await getStages(db, session.id);
  const checkpointRecord = records.find((record) => record.stage === checkpoint.stage);
  if (!checkpoint.nextStage && (checkpointRecord?.status === 'completed' || checkpointRecord?.status === 'skipped')) {
    return { conflicted: false, checkpointStage: fromCheckpoint };
  }
  return {
    conflicted: fromCheckpoint !== expected,
    checkpointStage: fromCheckpoint,
  };
}

export type StageOutcome = {
  stage: SessionStage;
  result?: unknown;
  /** Skipped via the Next control rather than worked through. */
  skipped?: boolean;
};

/**
 * Finish a stage and move on, awarding stage XP exactly once.
 * Returns the next stage, or null when the session is over.
 */
export async function advanceStage(
  db: SQLiteDatabase,
  session: Session,
  outcome: StageOutcome
): Promise<SessionStage | null> {
  // Existing sessions keep the plan recorded when they were created.
  const records = await getStages(db, session.id);
  const index = records.findIndex((record) => record.stage === outcome.stage);
  if (index < 0) throw new Error('Stage is outside this session plan');
  const next = records[index + 1]?.stage ?? null;
  if (records[index]?.status === 'completed' || records[index]?.status === 'skipped') {
    return (await getSession(db, session.id))?.nextStage ?? null;
  }

  if (outcome.skipped) {
    await skipStage(db, session.id, outcome.stage, next);
  } else {
    const firstTime = await completeStage(db, session.id, outcome.stage, next, outcome.result);
    if (firstTime) {
      const dayKey = await currentDayKey(db);
      await awardXp(db, dayKey, {
        kind: 'STAGE_COMPLETE',
        sessionId: session.id,
        stage: outcome.stage,
        // Keyed on the stage, so a remount cannot award it twice.
        dedupeKey: `stage:${session.id}:${outcome.stage}`,
      });
    }
  }

  if (next) await startStage(db, session.id, next);
  return next;
}

export type FinishResult = {
  counted: boolean;
  completedSessions: number;
  xpAwarded: number;
};

/**
 * Complete the session.
 *
 * Safe to call more than once: `completeSession` is guarded on the status, and the
 * XP award is deduped on the session id, so a replayed navigation changes nothing.
 */
export async function finishSession(
  db: SQLiteDatabase,
  session: Session
): Promise<FinishResult> {
  const result = await completeSession(db, session.id);
  const saved = await getSession(db, session.id);
  if (saved?.status !== 'completed') throw new Error('This session still has unfinished stages');

  let xpAwarded = 0;
  if (saved.counted && saved.completedAt) {
    const dayKey = await currentDayKey(db, new Date(saved.completedAt));
    await noteSessionCompleted(db, dayKey);
    const award = await awardXp(db, dayKey, {
      kind: 'SESSION_COMPLETE',
      sessionId: session.id,
      dedupeKey: `session:${session.id}`,
    });
    xpAwarded = award.awarded;
    await refreshAchievements(db).catch(() => undefined);
  }

  return {
    counted: result.counted,
    completedSessions: result.completedSessions,
    xpAwarded,
  };
}

/** The stages this session actually contains, for honest progress display. */
export function stageListFor(mode: DurationMode): SessionStage[] {
  return stagesFor(mode);
}

export async function sessionById(
  db: SQLiteDatabase,
  id: string
): Promise<Session | null> {
  return getSession(db, id);
}
