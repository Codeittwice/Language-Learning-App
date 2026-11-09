/**
 * The phrase bank: the learner's vocabulary and its review schedule.
 *
 * `recordReview` is the most important function in the app. It writes the attempt,
 * advances the FSRS card and updates the counters in one transaction, so a crash
 * mid-review cannot leave a card scheduled from an attempt that was never recorded.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import seedData from '@/assets/seed/phrases.json';
import { count, fromDb, newId, parseStringArray, toDb, toJsonColumn } from '@/db';
import { emit } from '@/db/events';
import {
  applyReview,
  cardFromColumns,
  columnsFromCard,
  type FsrsColumns,
  newCardColumns,
  type ReviewGrade,
} from '@/srs/fsrs';
import { normalizeDutch } from '@/srs/normalize';
import type { DayKey } from '@/time/day';
import type {
  Article,
  PhraseSource,
  PromptKind,
  RecallStatus,
  Register,
  VerbAux,
} from '@/types';

export type Phrase = {
  id: string;
  dutch: string;
  normalized: string;
  meaningEn: string;
  meaningBg: string | null;
  exampleNl: string | null;
  exampleEn: string | null;
  context: string | null;
  register: Register | null;
  wordClass: string | null;
  article: Article | null;
  plural: string | null;
  diminutive: string | null;
  verbInfinitive: string | null;
  verbPresent3sg: string | null;
  verbPastSg: string | null;
  verbPastPl: string | null;
  verbParticiple: string | null;
  verbAux: VerbAux | null;
  verbSeparable: boolean | null;
  prepositions: string[];
  tags: string[];
  source: PhraseSource;
  sourceRef: string | null;
  introducedSessionNumber: number | null;
  introducedAt: string;
  isArchived: boolean;
  relearnNextSession: boolean;
  confidenceSelf: number | null;
  needsVerification: boolean;
  due: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: string | null;
  lastStatus: RecallStatus | null;
  independentCount: number;
  promptedCount: number;
  missedCount: number;
};

type PhraseRow = FsrsColumns & {
  id: string;
  dutch: string;
  normalized: string;
  meaning_en: string;
  meaning_bg: string | null;
  example_nl: string | null;
  example_en: string | null;
  context: string | null;
  register: Register | null;
  word_class: string | null;
  article: Article | null;
  plural: string | null;
  diminutive: string | null;
  verb_infinitive: string | null;
  verb_present_3sg: string | null;
  verb_past_sg: string | null;
  verb_past_pl: string | null;
  verb_participle: string | null;
  verb_aux: VerbAux | null;
  verb_separable: number | null;
  prepositions: string;
  tags: string;
  source: PhraseSource;
  source_ref: string | null;
  introduced_session_number: number | null;
  introduced_at: string;
  is_archived: number;
  relearn_next_session: number;
  confidence_self: number | null;
  needs_verification: number;
  last_status: RecallStatus | null;
  independent_count: number;
  prompted_count: number;
  missed_count: number;
};

const SELECT_COLUMNS = `
  id, dutch, normalized, meaning_en, meaning_bg, example_nl, example_en, context,
  register, word_class, article, plural, diminutive,
  verb_infinitive, verb_present_3sg, verb_past_sg, verb_past_pl, verb_participle,
  verb_aux, verb_separable, prepositions, tags, source, source_ref,
  introduced_session_number, introduced_at, is_archived, relearn_next_session,
  confidence_self, needs_verification,
  fsrs_due, fsrs_stability, fsrs_difficulty, fsrs_scheduled_days, fsrs_learning_steps,
  fsrs_reps, fsrs_lapses, fsrs_state, fsrs_last_review,
  last_status, independent_count, prompted_count, missed_count
`;

function toPhrase(row: PhraseRow): Phrase {
  return {
    id: row.id,
    dutch: row.dutch,
    normalized: row.normalized,
    meaningEn: row.meaning_en,
    meaningBg: row.meaning_bg,
    exampleNl: row.example_nl,
    exampleEn: row.example_en,
    context: row.context,
    register: row.register,
    wordClass: row.word_class,
    article: row.article,
    plural: row.plural,
    diminutive: row.diminutive,
    verbInfinitive: row.verb_infinitive,
    verbPresent3sg: row.verb_present_3sg,
    verbPastSg: row.verb_past_sg,
    verbPastPl: row.verb_past_pl,
    verbParticiple: row.verb_participle,
    verbAux: row.verb_aux,
    verbSeparable: row.verb_separable === null ? null : row.verb_separable === 1,
    prepositions: parseStringArray(row.prepositions),
    tags: parseStringArray(row.tags),
    source: row.source,
    sourceRef: row.source_ref,
    introducedSessionNumber: row.introduced_session_number,
    introducedAt: row.introduced_at,
    isArchived: fromDb(row.is_archived),
    relearnNextSession: fromDb(row.relearn_next_session),
    confidenceSelf: row.confidence_self,
    needsVerification: fromDb(row.needs_verification),
    due: row.fsrs_due,
    stability: row.fsrs_stability,
    difficulty: row.fsrs_difficulty,
    reps: row.fsrs_reps,
    lapses: row.fsrs_lapses,
    state: row.fsrs_state,
    lastReview: row.fsrs_last_review,
    lastStatus: row.last_status,
    independentCount: row.independent_count,
    promptedCount: row.prompted_count,
    missedCount: row.missed_count,
  };
}

export type NewPhrase = {
  dutch: string;
  meaningEn: string;
  meaningBg?: string | null;
  exampleNl?: string | null;
  exampleEn?: string | null;
  context?: string | null;
  register?: Register | null;
  wordClass?: string | null;
  article?: Article | null;
  plural?: string | null;
  diminutive?: string | null;
  verbInfinitive?: string | null;
  verbPresent3sg?: string | null;
  verbPastSg?: string | null;
  verbPastPl?: string | null;
  verbParticiple?: string | null;
  verbAux?: VerbAux | null;
  verbSeparable?: boolean | null;
  prepositions?: string[];
  tags?: string[];
  source: PhraseSource;
  sourceRef?: string | null;
  introducedSessionNumber?: number | null;
  needsVerification?: boolean;
};

/**
 * Add a phrase, or return the existing one if it is already in the bank.
 *
 * Matching is on the normalised form, so "Hoe was je dag?" and "hoe was je dag" are
 * the same entry rather than two cards competing for the same review slot.
 */
export async function addPhrase(
  db: SQLiteDatabase,
  input: NewPhrase,
  now: Date = new Date()
): Promise<{ phrase: Phrase; created: boolean }> {
  const normalized = normalizeDutch(input.dutch);

  const existing = await db.getFirstAsync<PhraseRow>(
    `SELECT ${SELECT_COLUMNS} FROM phrases WHERE normalized = ?`,
    [normalized]
  );
  if (existing) return { phrase: toPhrase(existing), created: false };

  const id = newId();
  const timestamp = now.toISOString();
  const card = newCardColumns(now);

  await db.runAsync(
    `INSERT INTO phrases (
       id, dutch, normalized, meaning_en, meaning_bg, example_nl, example_en, context,
       register, word_class, article, plural, diminutive,
       verb_infinitive, verb_present_3sg, verb_past_sg, verb_past_pl, verb_participle,
       verb_aux, verb_separable, prepositions, tags, source, source_ref,
       introduced_session_number, introduced_at, needs_verification,
       fsrs_due, fsrs_stability, fsrs_difficulty, fsrs_scheduled_days,
       fsrs_learning_steps, fsrs_reps, fsrs_lapses, fsrs_state, fsrs_last_review,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.dutch.trim(),
      normalized,
      input.meaningEn.trim(),
      input.meaningBg ?? null,
      input.exampleNl ?? null,
      input.exampleEn ?? null,
      input.context ?? null,
      input.register ?? null,
      input.wordClass ?? null,
      input.article ?? null,
      input.plural ?? null,
      input.diminutive ?? null,
      input.verbInfinitive ?? null,
      input.verbPresent3sg ?? null,
      input.verbPastSg ?? null,
      input.verbPastPl ?? null,
      input.verbParticiple ?? null,
      input.verbAux ?? null,
      input.verbSeparable === null || input.verbSeparable === undefined
        ? null
        : toDb(input.verbSeparable),
      toJsonColumn(input.prepositions ?? []),
      toJsonColumn(input.tags ?? []),
      input.source,
      input.sourceRef ?? null,
      input.introducedSessionNumber ?? null,
      timestamp,
      toDb(input.needsVerification ?? false),
      card.fsrs_due,
      card.fsrs_stability,
      card.fsrs_difficulty,
      card.fsrs_scheduled_days,
      card.fsrs_learning_steps,
      card.fsrs_reps,
      card.fsrs_lapses,
      card.fsrs_state,
      card.fsrs_last_review,
      timestamp,
      timestamp,
    ]
  );

  emit('phrases:changed');
  const created = await getPhrase(db, id);
  if (!created) throw new Error('Phrase insert did not round-trip');
  return { phrase: created, created: true };
}

export async function getPhrase(db: SQLiteDatabase, id: string): Promise<Phrase | null> {
  const row = await db.getFirstAsync<PhraseRow>(
    `SELECT ${SELECT_COLUMNS} FROM phrases WHERE id = ?`,
    [id]
  );
  return row ? toPhrase(row) : null;
}

/* Seed ---------------------------------------------------------------------- */

type SeedPhrase = Omit<NewPhrase, 'source'>;

/**
 * Load the bundled starter phrases. Idempotent -- `addPhrase` matches on the
 * normalised form, so re-running adds nothing and never duplicates.
 */
export async function importSeedPhrases(
  db: SQLiteDatabase,
  now: Date = new Date()
): Promise<number> {
  const phrases = (seedData as { phrases: SeedPhrase[] }).phrases ?? [];
  let added = 0;

  await db.withTransactionAsync(async () => {
    for (const entry of phrases) {
      const result = await addPhrase(db, { ...entry, source: 'seed' }, now);
      if (result.created) added += 1;
    }
  });

  if (added > 0) emit('phrases:changed');
  return added;
}

/* Selection ----------------------------------------------------------------- */

export type SelectionOptions = {
  limit: number;
  now: Date;
  /** Prefer phrases carrying one of these tags, without excluding the rest. */
  preferTags?: readonly string[];
};

/**
 * Choose what to drill this round.
 *
 * Priority order, which encodes the spec's rules:
 *  1. Items flagged to relearn, regardless of their due date -- a missed phrase must
 *     return next session even if FSRS has pushed its date out.
 *  2. Overdue items, most overdue first.
 *  3. Brand-new items, so the bank keeps moving.
 *  4. Anything else, to pad a short round rather than show three cards.
 */
export async function selectForRecall(
  db: SQLiteDatabase,
  options: SelectionOptions
): Promise<Phrase[]> {
  const nowIsoString = options.now.toISOString();
  const picked: PhraseRow[] = [];
  const seen = new Set<string>();

  const take = async (sql: string, args: (string | number)[]) => {
    if (picked.length >= options.limit) return;
    const rows = await db.getAllAsync<PhraseRow>(sql, [...args, options.limit - picked.length]);
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      picked.push(row);
    }
  };

  await take(
    `SELECT ${SELECT_COLUMNS} FROM phrases
      WHERE is_archived = 0 AND relearn_next_session = 1
      ORDER BY missed_count DESC, fsrs_due ASC LIMIT ?`,
    []
  );

  await take(
    `SELECT ${SELECT_COLUMNS} FROM phrases
      WHERE is_archived = 0 AND fsrs_due <= ? AND fsrs_reps > 0
      ORDER BY fsrs_due ASC LIMIT ?`,
    [nowIsoString]
  );

  await take(
    `SELECT ${SELECT_COLUMNS} FROM phrases
      WHERE is_archived = 0 AND fsrs_reps = 0
      ORDER BY introduced_at ASC LIMIT ?`,
    []
  );

  await take(
    `SELECT ${SELECT_COLUMNS} FROM phrases
      WHERE is_archived = 0
      ORDER BY fsrs_due ASC LIMIT ?`,
    []
  );

  const phrases = picked.map(toPhrase);

  // The spec asks for today's topic mixed with older material, so bias towards the
  // preferred tags without filtering anything out.
  if (options.preferTags?.length) {
    const wanted = new Set(options.preferTags);
    phrases.sort((a, b) => {
      const aMatch = a.tags.some((tag) => wanted.has(tag)) ? 0 : 1;
      const bMatch = b.tags.some((tag) => wanted.has(tag)) ? 0 : 1;
      return aMatch - bMatch;
    });
  }

  return phrases;
}

export async function countDue(db: SQLiteDatabase, now: Date): Promise<number> {
  return count(
    db,
    `SELECT COUNT(*) AS n FROM phrases
      WHERE is_archived = 0 AND (relearn_next_session = 1 OR fsrs_due <= ?)`,
    [now.toISOString()]
  );
}

export async function countPhrases(db: SQLiteDatabase): Promise<number> {
  return count(db, 'SELECT COUNT(*) AS n FROM phrases WHERE is_archived = 0');
}

/** Mastery buckets, derived from FSRS stability rather than a review counter. */
export async function masteryCounts(
  db: SQLiteDatabase
): Promise<{ new: number; learning: number; familiar: number; solid: number; mastered: number }> {
  const rows = await db.getAllAsync<{ reps: number; stability: number }>(
    'SELECT fsrs_reps AS reps, fsrs_stability AS stability FROM phrases WHERE is_archived = 0'
  );
  const out = { new: 0, learning: 0, familiar: 0, solid: 0, mastered: 0 };
  for (const row of rows) {
    if (row.reps === 0) out.new += 1;
    else if (row.stability >= 180) out.mastered += 1;
    else if (row.stability >= 60) out.solid += 1;
    else if (row.stability >= 21) out.familiar += 1;
    else out.learning += 1;
  }
  return out;
}

export async function searchPhrases(
  db: SQLiteDatabase,
  query: string,
  limit = 100
): Promise<Phrase[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    const rows = await db.getAllAsync<PhraseRow>(
      `SELECT ${SELECT_COLUMNS} FROM phrases WHERE is_archived = 0
        ORDER BY introduced_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map(toPhrase);
  }

  // FTS5 is a later migration; at a few hundred phrases LIKE is instant and cannot
  // fail on a build without the extension compiled in.
  const needle = `%${normalizeDutch(trimmed)}%`;
  const english = `%${trimmed.toLowerCase()}%`;
  const rows = await db.getAllAsync<PhraseRow>(
    `SELECT ${SELECT_COLUMNS} FROM phrases
      WHERE is_archived = 0
        AND (normalized LIKE ? OR LOWER(meaning_en) LIKE ? OR LOWER(COALESCE(meaning_bg, '')) LIKE ?)
      ORDER BY introduced_at DESC LIMIT ?`,
    [needle, english, english, limit]
  );
  return rows.map(toPhrase);
}

/* Reviews ------------------------------------------------------------------- */

export type ReviewInput = {
  phraseId: string;
  sessionId: string | null;
  stage: string | null;
  promptKind: PromptKind;
  promptText: string;
  learnerAnswer: string | null;
  hintCount: number;
  revealed: boolean;
  status: RecallStatus;
  /** Null for `not_tested`, where no FSRS update happens. */
  grade: ReviewGrade | null;
  gradedBy: 'ai' | 'self' | 'local';
  aiAccepted: boolean | null;
  aiExplanation: string | null;
  suggestedAnswer: string | null;
  alternatives: string[];
  latencyMs: number | null;
  dayKey: DayKey;
};

/**
 * Record one attempt and advance its schedule, atomically.
 *
 * `now` should be captured once per round and reused for every item, so scheduling
 * inside a round is deterministic and reproducible in a test.
 */
export async function recordReview(
  db: SQLiteDatabase,
  input: ReviewInput,
  now: Date = new Date()
): Promise<void> {
  const row = await db.getFirstAsync<PhraseRow>(
    `SELECT ${SELECT_COLUMNS} FROM phrases WHERE id = ?`,
    [input.phraseId]
  );
  if (!row) throw new Error(`No phrase ${input.phraseId}`);

  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      `INSERT INTO phrase_reviews (
         phrase_id, session_id, stage, prompt_kind, prompt_text, learner_answer,
         hint_count, revealed, status, grade, graded_by, ai_accepted, ai_explanation,
         suggested_answer, alternatives, latency_ms, day_key, reviewed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.phraseId,
        input.sessionId,
        input.stage,
        input.promptKind,
        input.promptText,
        input.learnerAnswer,
        input.hintCount,
        toDb(input.revealed),
        input.status,
        input.grade,
        input.gradedBy,
        input.aiAccepted === null ? null : toDb(input.aiAccepted),
        input.aiExplanation,
        input.suggestedAnswer,
        toJsonColumn(input.alternatives),
        input.latencyMs,
        input.dayKey,
        now.toISOString(),
      ]
    );
    const reviewId = result.lastInsertRowId;

    // A skipped item is recorded but never scheduled: no grade, no FSRS update.
    if (input.grade === null) {
      await db.runAsync('UPDATE phrases SET last_status = ?, updated_at = ? WHERE id = ?', [
        input.status,
        now.toISOString(),
        input.phraseId,
      ]);
      return;
    }

    const { card, log } = applyReview(cardFromColumns(row), input.grade, now);
    const columns = columnsFromCard(card);

    const counterColumn =
      input.status === 'independent'
        ? 'independent_count'
        : input.status === 'prompted'
          ? 'prompted_count'
          : 'missed_count';

    await db.runAsync(
      `UPDATE phrases SET
         fsrs_due = ?, fsrs_stability = ?, fsrs_difficulty = ?, fsrs_scheduled_days = ?,
         fsrs_learning_steps = ?, fsrs_reps = ?, fsrs_lapses = ?, fsrs_state = ?,
         fsrs_last_review = ?,
         last_status = ?, ${counterColumn} = ${counterColumn} + 1,
         relearn_next_session = ?, updated_at = ?
       WHERE id = ?`,
      [
        columns.fsrs_due,
        columns.fsrs_stability,
        columns.fsrs_difficulty,
        columns.fsrs_scheduled_days,
        columns.fsrs_learning_steps,
        columns.fsrs_reps,
        columns.fsrs_lapses,
        columns.fsrs_state,
        columns.fsrs_last_review,
        input.status,
        // Spec: a missed item returns later in this session AND next session. FSRS
        // handles the first; this flag is what the scheduler reads for the second.
        toDb(input.status === 'missed'),
        now.toISOString(),
        input.phraseId,
      ]
    );

    await db.runAsync(
      `INSERT INTO fsrs_review_logs (
         phrase_id, phrase_review_id, rating, state, due, stability, difficulty,
         scheduled_days, learning_steps, review
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.phraseId,
        reviewId,
        log.rating,
        log.state,
        log.due instanceof Date ? log.due.toISOString() : String(log.due),
        log.stability,
        log.difficulty,
        log.scheduled_days,
        log.learning_steps,
        log.review instanceof Date ? log.review.toISOString() : String(log.review),
      ]
    );
  });

  emit('phrases:changed', 'reviews:changed');
}

/** Clear the relearn flags once a session has drilled them. */
export async function clearRelearnFlags(
  db: SQLiteDatabase,
  phraseIds: readonly string[]
): Promise<void> {
  if (phraseIds.length === 0) return;
  const placeholders = phraseIds.map(() => '?').join(', ');
  await db.runAsync(
    `UPDATE phrases SET relearn_next_session = 0 WHERE id IN (${placeholders})`,
    [...phraseIds]
  );
  emit('phrases:changed');
}
