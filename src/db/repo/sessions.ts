/**
 * Sessions, their stages and their checkpoints.
 *
 * The idempotency story, which is what the spec's acceptance tests turn on:
 *
 *  - `completedSessions` is DERIVED (`COUNT(*) WHERE counted = 1`), never stored, so
 *    there is no counter that can drift.
 *  - `completeSession` is an UPDATE guarded on `status = 'in_progress'`, and reports
 *    whether this particular call was the one that counted it. A double tap, a screen
 *    remount or a replayed navigation therefore cannot increment twice.
 *  - `completeStage` relies on `UNIQUE (session_id, stage)` for the same reason.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { count, newId, toJsonColumn } from '@/db';
import { emit } from '@/db/events';
import { type DayKey, nowIso } from '@/time/day';
import type {
  DurationMode,
  SessionKind,
  SessionStage,
  SessionStatus,
  StageStatus,
} from '@/types';

export type Session = {
  id: string;
  sessionNumber: number;
  week: number;
  rotationDay: number;
  topicKey: string;
  durationMode: DurationMode;
  kind: SessionKind;
  status: SessionStatus;
  nextStage: SessionStage | null;
  counted: boolean;
  dayKey: DayKey;
  startedAt: string;
  completedAt: string | null;
};

type SessionRow = {
  id: string;
  session_number: number;
  week: number;
  rotation_day: number;
  topic_key: string;
  duration_mode: DurationMode;
  kind: SessionKind;
  status: SessionStatus;
  next_stage: SessionStage | null;
  counted: number;
  day_key: string;
  started_at: string;
  completed_at: string | null;
};

const SESSION_COLUMNS = `
  id, session_number, week, rotation_day, topic_key, duration_mode, kind, status,
  next_stage, counted, day_key, started_at, completed_at
`;

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    sessionNumber: row.session_number,
    week: row.week,
    rotationDay: row.rotation_day,
    topicKey: row.topic_key,
    durationMode: row.duration_mode,
    kind: row.kind,
    status: row.status,
    nextStage: row.next_stage,
    counted: row.counted === 1,
    dayKey: row.day_key,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

/** Completed scheduled sessions. The single source of the session counter. */
export async function completedSessionCount(db: SQLiteDatabase): Promise<number> {
  return count(
    db,
    "SELECT COUNT(*) AS n FROM sessions WHERE kind = 'scheduled' AND counted = 1"
  );
}

/** The session currently in progress, if any. */
export async function getActiveSession(db: SQLiteDatabase): Promise<Session | null> {
  const row = await db.getFirstAsync<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM sessions
      WHERE status = 'in_progress' ORDER BY started_at DESC LIMIT 1`
  );
  return row ? toSession(row) : null;
}

export async function getSession(db: SQLiteDatabase, id: string): Promise<Session | null> {
  const row = await db.getFirstAsync<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`,
    [id]
  );
  return row ? toSession(row) : null;
}

export type CreateSessionInput = {
  sessionNumber: number;
  week: number;
  rotationDay: number;
  topicKey: string;
  durationMode: DurationMode;
  kind: SessionKind;
  dayKey: DayKey;
  stages: { stage: SessionStage; order: number; rounds: number }[];
};

export async function createSession(
  db: SQLiteDatabase,
  input: CreateSessionInput
): Promise<Session> {
  const id = newId();
  const now = nowIso();
  const firstStage = input.stages[0]?.stage ?? null;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO sessions (
         id, session_number, week, rotation_day, topic_key, duration_mode, kind,
         status, next_stage, counted, day_key, started_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', ?, 0, ?, ?, ?)`,
      [
        id,
        input.sessionNumber,
        input.week,
        input.rotationDay,
        input.topicKey,
        input.durationMode,
        input.kind,
        firstStage,
        input.dayKey,
        now,
        now,
      ]
    );

    for (const stage of input.stages) {
      await db.runAsync(
        `INSERT INTO session_stages (
           id, session_id, stage, stage_order, planned, status, rounds_total, rounds_done
         ) VALUES (?, ?, ?, ?, 1, 'pending', ?, 0)`,
        [newId(), id, stage.stage, stage.order, stage.rounds]
      );
    }
  });

  emit('session:changed');
  const created = await getSession(db, id);
  if (!created) throw new Error('Session insert did not round-trip');
  return created;
}

/* Stages -------------------------------------------------------------------- */

export type StageRecord = {
  stage: SessionStage;
  order: number;
  status: StageStatus;
  roundsTotal: number;
  roundsDone: number;
  resultJson: string | null;
};

type StageRow = {
  stage: SessionStage;
  stage_order: number;
  status: StageStatus;
  rounds_total: number;
  rounds_done: number;
  result_json: string | null;
};

export async function getStages(
  db: SQLiteDatabase,
  sessionId: string
): Promise<StageRecord[]> {
  const rows = await db.getAllAsync<StageRow>(
    `SELECT stage, stage_order, status, rounds_total, rounds_done, result_json
       FROM session_stages WHERE session_id = ? ORDER BY stage_order`,
    [sessionId]
  );
  return rows.map((row) => ({
    stage: row.stage,
    order: row.stage_order,
    status: row.status,
    roundsTotal: row.rounds_total,
    roundsDone: row.rounds_done,
    resultJson: row.result_json,
  }));
}

export async function startStage(
  db: SQLiteDatabase,
  sessionId: string,
  stage: SessionStage
): Promise<void> {
  await db.runAsync(
    `UPDATE session_stages SET status = 'in_progress', started_at = COALESCE(started_at, ?)
      WHERE session_id = ? AND stage = ? AND status = 'pending'`,
    [nowIso(), sessionId, stage]
  );
  emit('session:changed');
}

/** Mark one round done. Clamped so a replayed call cannot exceed the plan. */
export async function completeRound(
  db: SQLiteDatabase,
  sessionId: string,
  stage: SessionStage,
  roundIndex: number
): Promise<void> {
  await db.runAsync(
    `UPDATE session_stages
        SET rounds_done = MIN(rounds_total, MAX(rounds_done, ?)),
            status = CASE WHEN status = 'pending' THEN 'in_progress' ELSE status END
      WHERE session_id = ? AND stage = ?`,
    [roundIndex + 1, sessionId, stage]
  );
  emit('session:changed');
}

/**
 * Finish a stage and point the session at the next one.
 * Returns true when this call is the one that completed it.
 */
export async function completeStage(
  db: SQLiteDatabase,
  sessionId: string,
  stage: SessionStage,
  nextStage: SessionStage | null,
  result: unknown
): Promise<boolean> {
  const now = nowIso();
  let firstTime = false;

  await db.withTransactionAsync(async () => {
    const changed = await db.runAsync(
      `UPDATE session_stages
          SET status = 'completed', rounds_done = rounds_total,
              completed_at = ?, result_json = ?
        WHERE session_id = ? AND stage = ? AND status <> 'completed'`,
      [now, result === undefined ? null : toJsonColumn(result), sessionId, stage]
    );
    firstTime = changed.changes === 1;

    await db.runAsync('UPDATE sessions SET next_stage = ?, updated_at = ? WHERE id = ?', [
      nextStage,
      now,
      sessionId,
    ]);
  });

  emit('session:changed');
  return firstTime;
}

export async function skipStage(
  db: SQLiteDatabase,
  sessionId: string,
  stage: SessionStage,
  nextStage: SessionStage | null
): Promise<void> {
  const now = nowIso();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE session_stages SET status = 'skipped', completed_at = ?
        WHERE session_id = ? AND stage = ? AND status NOT IN ('completed','skipped')`,
      [now, sessionId, stage]
    );
    await db.runAsync('UPDATE sessions SET next_stage = ?, updated_at = ? WHERE id = ?', [
      nextStage,
      now,
      sessionId,
    ]);
  });
  emit('session:changed');
}

/* Completion ---------------------------------------------------------------- */

export type CompletionResult = {
  /** True only for the call that actually completed it. */
  counted: boolean;
  completedSessions: number;
};

/**
 * Complete a session exactly once.
 *
 * The guard on `status = 'in_progress'` is what makes this idempotent: a second call
 * matches no rows, reports `counted: false`, and leaves the derived counter alone.
 */
export async function completeSession(
  db: SQLiteDatabase,
  sessionId: string
): Promise<CompletionResult> {
  const now = nowIso();

  const result = await db.runAsync(
    `UPDATE sessions
        SET status = 'completed',
            counted = CASE WHEN kind = 'scheduled' THEN 1 ELSE 0 END,
            next_stage = NULL, completed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'in_progress'`,
    [now, now, sessionId]
  );

  emit('session:changed', 'gamification:changed');
  return {
    counted: result.changes === 1,
    completedSessions: await completedSessionCount(db),
  };
}

/** Leave a session behind without counting it, e.g. when starting a different mode. */
export async function abandonSession(db: SQLiteDatabase, sessionId: string): Promise<void> {
  await db.runAsync(
    `UPDATE sessions SET status = 'abandoned', updated_at = ?
      WHERE id = ? AND status = 'in_progress'`,
    [nowIso(), sessionId]
  );
  emit('session:changed');
}

/* Checkpoints --------------------------------------------------------------- */

export type Checkpoint = {
  seq: number;
  stage: SessionStage;
  nextStage: SessionStage | null;
  state: unknown;
  createdAt: string;
};

/**
 * Append a checkpoint. `seq` is monotonic per session, so recovery is always
 * `MAX(seq)` and there is no ambiguity to resolve by timestamp.
 */
export async function saveCheckpoint(
  db: SQLiteDatabase,
  sessionId: string,
  stage: SessionStage,
  nextStage: SessionStage | null,
  state: unknown
): Promise<number> {
  let seq = 0;
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ max_seq: number | null }>(
      'SELECT MAX(seq) AS max_seq FROM session_checkpoints WHERE session_id = ?',
      [sessionId]
    );
    seq = (row?.max_seq ?? 0) + 1;
    await db.runAsync(
      `INSERT INTO session_checkpoints (session_id, seq, stage, next_stage, state_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionId, seq, stage, nextStage, toJsonColumn(state), nowIso()]
    );
  });
  return seq;
}

export async function getLatestCheckpoint(
  db: SQLiteDatabase,
  sessionId: string
): Promise<Checkpoint | null> {
  const row = await db.getFirstAsync<{
    seq: number;
    stage: SessionStage;
    next_stage: SessionStage | null;
    state_json: string;
    created_at: string;
  }>(
    `SELECT seq, stage, next_stage, state_json, created_at
       FROM session_checkpoints WHERE session_id = ? ORDER BY seq DESC LIMIT 1`,
    [sessionId]
  );
  if (!row) return null;

  let state: unknown = null;
  try {
    state = JSON.parse(row.state_json);
  } catch {
    console.warn('[sessions] checkpoint state was not valid JSON');
  }
  return {
    seq: row.seq,
    stage: row.stage,
    nextStage: row.next_stage,
    state,
    createdAt: row.created_at,
  };
}

/* History ------------------------------------------------------------------- */

export async function recentSessions(
  db: SQLiteDatabase,
  limit = 20
): Promise<Session[]> {
  const rows = await db.getAllAsync<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM sessions ORDER BY started_at DESC LIMIT ?`,
    [limit]
  );
  return rows.map(toSession);
}

export async function countSessionsOnDay(
  db: SQLiteDatabase,
  dayKey: DayKey
): Promise<number> {
  return count(db, "SELECT COUNT(*) AS n FROM sessions WHERE day_key = ? AND counted = 1", [
    dayKey,
  ]);
}

/* Real-world challenges ----------------------------------------------------- */

export type Challenge = {
  id: number;
  action: string;
  status: 'assigned' | 'completed' | 'attempted' | 'not_attempted' | 'declined';
  learnerNote: string | null;
  createdAt: string;
};

export async function assignChallenge(
  db: SQLiteDatabase,
  sessionId: string,
  rotationDay: number,
  action: string
): Promise<void> {
  await db.runAsync(
    `INSERT INTO real_world_challenges (assigned_session_id, rotation_day, action, created_at)
     VALUES (?, ?, ?, ?)`,
    [sessionId, rotationDay, action, nowIso()]
  );
  emit('challenges:changed');
}

export async function openChallenge(db: SQLiteDatabase): Promise<Challenge | null> {
  const row = await db.getFirstAsync<{
    id: number;
    action: string;
    status: Challenge['status'];
    learner_note: string | null;
    created_at: string;
  }>(
    `SELECT id, action, status, learner_note, created_at
       FROM real_world_challenges WHERE status = 'assigned'
      ORDER BY created_at DESC LIMIT 1`
  );
  return row
    ? {
        id: row.id,
        action: row.action,
        status: row.status,
        learnerNote: row.learner_note,
        createdAt: row.created_at,
      }
    : null;
}

/**
 * Record how a challenge went. Every outcome is equally acceptable -- the spec is
 * explicit that not completing one is not a failure.
 */
export async function reportChallenge(
  db: SQLiteDatabase,
  id: number,
  status: Exclude<Challenge['status'], 'assigned'>,
  note: string | null = null
): Promise<void> {
  await db.runAsync(
    `UPDATE real_world_challenges SET status = ?, learner_note = ?, answered_at = ?
      WHERE id = ?`,
    [status, note, nowIso(), id]
  );
  emit('challenges:changed');
}

export async function challengeHistory(
  db: SQLiteDatabase,
  limit = 20
): Promise<Challenge[]> {
  const rows = await db.getAllAsync<{
    id: number;
    action: string;
    status: Challenge['status'];
    learner_note: string | null;
    created_at: string;
  }>(
    `SELECT id, action, status, learner_note, created_at
       FROM real_world_challenges ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    status: row.status,
    learnerNote: row.learner_note,
    createdAt: row.created_at,
  }));
}
