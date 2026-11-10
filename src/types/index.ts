/**
 * Shared domain vocabulary. These literal unions mirror the CHECK constraints in
 * `src/db/migrations.ts` exactly -- if you add a value here, add it there too, or the
 * insert will fail at runtime.
 */

/** The six stages of a practice session, in canonical order. */
export type SessionStage =
  | 'recall'
  | 'listening'
  | 'writing'
  | 'topic_conversation'
  | 'casual_conversation'
  | 'wrap_up';

export const ALL_STAGES: readonly SessionStage[] = [
  'recall',
  'listening',
  'writing',
  'topic_conversation',
  'casual_conversation',
  'wrap_up',
] as const;

export const STAGE_LABELS: Record<SessionStage, string> = {
  recall: 'Recall',
  listening: 'Listening',
  writing: 'Writing',
  topic_conversation: 'Role-play',
  casual_conversation: 'Friend mode',
  wrap_up: 'Wrap-up',
};

/**
 * `quick` is the streak-keeping loop; `short` and `standard` are the spec's 20- and
 * 40-minute plans verbatim. All three are resumable across sittings.
 */
export type DurationMode = 'quick' | 'short' | 'standard';

export const DURATION_LABELS: Record<DurationMode, string> = {
  quick: 'Quick',
  short: 'Short',
  standard: 'Full',
};

/** Rough minutes, shown as "~7 min". Never used as a countdown. */
export const DURATION_MINUTES: Record<DurationMode, number> = {
  quick: 7,
  short: 20,
  standard: 40,
};

export type SessionStatus = 'in_progress' | 'completed' | 'abandoned';
export type SessionKind = 'scheduled' | 'extra';
export type StageStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

/**
 * Spec section 6. `independent` means produced with no hint and no reveal; recognition
 * can never earn it. Enforced in three places: here, `src/srs/grading.ts`, and CHECK
 * constraints on `phrase_reviews`.
 */
export type RecallStatus = 'independent' | 'prompted' | 'missed' | 'not_tested';

/** How a phrase was cued. `recognition` can never yield `independent`. */
export type PromptKind =
  | 'en_to_nl'
  | 'bg_to_nl'
  | 'situation'
  | 'cloze'
  | 'original_sentence'
  | 'spoken_cue'
  | 'recognition';

/** Spec section 8. */
export type CorrectionCategory =
  | 'grammar'
  | 'word_order'
  | 'vocabulary'
  | 'article'
  | 'preposition'
  | 'conjugation'
  | 'spelling'
  | 'naturalness';

export const CORRECTION_LABELS: Record<CorrectionCategory, string> = {
  grammar: 'Grammar',
  word_order: 'Word order',
  vocabulary: 'Word choice',
  article: 'de / het',
  preposition: 'Preposition',
  conjugation: 'Conjugation',
  spelling: 'Spelling',
  naturalness: 'Naturalness',
};

export type Register = 'informal' | 'neutral' | 'formal' | 'slang' | 'vulgar';
export type Article = 'de' | 'het' | 'de/het';
export type VerbAux = 'hebben' | 'zijn' | 'hebben/zijn';

export type PhraseSource = 'seed' | 'session' | 'dictionary' | 'book' | 'real_life' | 'media';

/** How a turn reached us. Dictation never counts as writing (spec section 8). */
export type InputMode = 'typed' | 'dictated' | 'button';

export type AudioSource = 'tts' | 'external' | 'text_only';

export type ChallengeStatus =
  | 'assigned'
  | 'completed'
  | 'attempted'
  | 'not_attempted'
  | 'declined';

export type MediaKind = 'youtube' | 'series' | 'film' | 'podcast' | 'music' | 'news';
export type MediaStatus = 'suggested' | 'saved' | 'opened' | 'watched' | 'dismissed';
export type MediaDifficulty = 'easier' | 'on_level' | 'stretch';

export type BookItemKind = 'word' | 'phrase' | 'sentence' | 'grammar_question';
export type BookItemStatus = 'queued' | 'explained' | 'known' | 'added' | 'skipped';
export type BookUnitStatus = 'not_started' | 'in_progress' | 'done';

export type QueryLang = 'nl' | 'en' | 'bg';

/** FSRS card state, matching ts-fsrs's `State` enum ordinals. */
export type FsrsState = 0 | 1 | 2 | 3;

/**
 * Mastery bands derived from FSRS stability, not from a review counter -- so "words I
 * own" is a real retention estimate rather than a vanity number.
 */
export type MasteryBand = 'new' | 'learning' | 'familiar' | 'solid' | 'mastered';

export const MASTERY_LABELS: Record<MasteryBand, string> = {
  new: 'New',
  learning: 'Learning',
  familiar: 'Familiar',
  solid: 'Solid',
  mastered: 'Mastered',
};

/** Stability thresholds in days. */
export function masteryBandFor(stabilityDays: number, reps: number): MasteryBand {
  if (reps === 0) return 'new';
  if (stabilityDays >= 180) return 'mastered';
  if (stabilityDays >= 60) return 'solid';
  if (stabilityDays >= 21) return 'familiar';
  return 'learning';
}

/**
 * The default daily XP goal.
 *
 * Lives here rather than in `src/gamification/xp.ts` because `src/db/repo/profile.ts`
 * needs it too, and that module is imported BY the XP module -- a constant in either
 * one would close an import cycle.
 *
 * It is 60 because the old 30 was met by three recall cards. See the balance notes in
 * `src/gamification/xp.ts`.
 */
export const DEFAULT_DAILY_GOAL_XP = 60;
