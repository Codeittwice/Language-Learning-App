/**
 * The FSRS scheduler, and the mapping between its `Card` type and our columns.
 *
 * FSRS rather than the spec's fixed 1-3-7-14-30 ladder, which the spec itself calls
 * "not claimed uniquely optimal": FSRS tracks difficulty per item instead of applying
 * one ease factor to everything, and reaches the same retention with fewer reviews.
 *
 * The `fsrs_*` columns mirror ts-fsrs's `Card` field for field so there is no
 * translation layer to drift.
 */
import {
  type Card,
  createEmptyCard,
  FSRS,
  generatorParameters,
  Rating,
  type ReviewLog,
  State,
} from 'ts-fsrs';

/**
 * 0.9 is the FSRS default: aim to recall 90% of items at review time. Lower means
 * fewer reviews and more forgetting; higher means the opposite. Left at the default
 * until there is real review history to tune against.
 */
export const REQUEST_RETENTION = 0.9;

const parameters = generatorParameters({
  request_retention: REQUEST_RETENTION,
  // Fuzz spreads due dates so a big day of new phrases does not come back as one
  // enormous day of reviews weeks later.
  enable_fuzz: true,
});

const scheduler = new FSRS(parameters);

/** The FSRS card columns as stored on a `phrases` row. */
export type FsrsColumns = {
  fsrs_due: string;
  fsrs_stability: number;
  fsrs_difficulty: number;
  fsrs_scheduled_days: number;
  fsrs_learning_steps: number;
  fsrs_reps: number;
  fsrs_lapses: number;
  fsrs_state: number;
  fsrs_last_review: string | null;
};

export function cardFromColumns(row: FsrsColumns): Card {
  return {
    due: new Date(row.fsrs_due),
    stability: row.fsrs_stability,
    difficulty: row.fsrs_difficulty,
    scheduled_days: row.fsrs_scheduled_days,
    learning_steps: row.fsrs_learning_steps,
    reps: row.fsrs_reps,
    lapses: row.fsrs_lapses,
    state: row.fsrs_state as State,
    last_review: row.fsrs_last_review ? new Date(row.fsrs_last_review) : undefined,
  };
}

export function columnsFromCard(card: Card): FsrsColumns {
  return {
    fsrs_due: card.due.toISOString(),
    fsrs_stability: card.stability,
    fsrs_difficulty: card.difficulty,
    fsrs_scheduled_days: card.scheduled_days,
    fsrs_learning_steps: card.learning_steps,
    fsrs_reps: card.reps,
    fsrs_lapses: card.lapses,
    fsrs_state: card.state,
    fsrs_last_review: card.last_review ? card.last_review.toISOString() : null,
  };
}

/** A brand-new card, due immediately. */
export function newCard(now: Date): Card {
  return createEmptyCard(now);
}

export function newCardColumns(now: Date): FsrsColumns {
  return columnsFromCard(newCard(now));
}

/**
 * A rating our grading can actually produce.
 *
 * `Rating.Manual` exists in ts-fsrs for operator overrides and is rejected by the
 * scheduler, so excluding it here makes it unrepresentable rather than a runtime
 * surprise.
 */
export type ReviewGrade = Exclude<Rating, typeof Rating.Manual>;

/**
 * Apply a review.
 *
 * `now` must be captured once per round and threaded through every item in it;
 * calling `new Date()` per item makes scheduling within a single round
 * non-deterministic and impossible to test.
 */
export function applyReview(
  card: Card,
  rating: ReviewGrade,
  now: Date
): { card: Card; log: ReviewLog } {
  const result = scheduler.next(card, now, rating);
  return { card: result.card, log: result.log };
}

/** Human phrasing for a due date, e.g. "in 3 days". */
export function describeInterval(from: Date, due: Date): string {
  const ms = due.getTime() - from.getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `in ${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(days / 30);
  if (months < 12) return `in ${months} month${months === 1 ? '' : 's'}`;
  return `in ${Math.round(days / 365)} year${days < 730 ? '' : 's'}`;
}

export { Rating, State } from 'ts-fsrs';
export type { Card, ReviewLog } from 'ts-fsrs';
