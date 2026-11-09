/**
 * Turning an attempt into a recall status and an FSRS grade.
 *
 * This module is where the spec's hardest rules are enforced in TypeScript. They are
 * also CHECK constraints on `phrase_reviews`, deliberately: this layer gives a clear
 * error at the point of the mistake, and the database is the backstop if a future
 * refactor finds a way around it.
 *
 * The AI never writes a status directly. It reports whether an answer was acceptable;
 * everything else is decided here.
 */
import { Rating } from 'ts-fsrs';

import type { ReviewGrade } from '@/srs/fsrs';
import type { PromptKind, RecallStatus } from '@/types';

/** Answering fast with no help suggests the phrase is easier than FSRS assumes. */
const EASY_LATENCY_MS = 4000;

export type AttemptSignals = {
  /** The model's verdict, or null when it was unavailable and we graded locally. */
  aiAccepted: boolean | null;
  /** What the learner said when asked to grade themselves. */
  selfRated: 'got_it' | 'needed_help' | 'missed' | null;
  /** Accepted by local string comparison. */
  localAccepted?: boolean;
  hintCount: number;
  /** True if the answer was shown before they committed. */
  revealed: boolean;
  promptKind: PromptKind;
  /** True when the item was presented but never answered. */
  skipped?: boolean;
};

/**
 * Decide the recall status for an attempt.
 *
 * The two invariants, applied last so nothing upstream can route around them:
 *  - a hint or a reveal can never yield `independent`
 *  - recognition is never production, so it can never yield `independent` either
 */
export function deriveStatus(signals: AttemptSignals): RecallStatus {
  if (signals.skipped) return 'not_tested';

  const correct =
    signals.selfRated !== null
      ? signals.selfRated !== 'missed'
      : (signals.aiAccepted ?? signals.localAccepted ?? false);

  if (!correct) return 'missed';

  // Correct, but with help of some kind.
  if (signals.selfRated === 'needed_help') return 'prompted';
  if (signals.hintCount > 0 || signals.revealed) return 'prompted';
  if (signals.promptKind === 'recognition') return 'prompted';

  return 'independent';
}

/**
 * Map a status onto an FSRS rating.
 *
 * Returns null for `not_tested`, and the null is load-bearing: callers must branch
 * on it rather than defaulting, so an untested item can never be scheduled as though
 * it had been reviewed.
 */
export function gradeFromStatus(
  status: RecallStatus,
  hintCount: number,
  latencyMs: number | null
): ReviewGrade | null {
  switch (status) {
    case 'independent':
      return hintCount === 0 && latencyMs !== null && latencyMs < EASY_LATENCY_MS
        ? Rating.Easy
        : Rating.Good;
    case 'prompted':
      return Rating.Hard;
    case 'missed':
      return Rating.Again;
    case 'not_tested':
      return null;
  }
}

/**
 * The spec requires a missed item to come back twice: later in this session, and in
 * the next one. FSRS `Again` handles the first; this flag handles the second, and the
 * scheduler reads it regardless of the due date.
 */
export function shouldRelearnNextSession(status: RecallStatus): boolean {
  return status === 'missed';
}

/** Whether to put the item back in the queue before this round ends. */
export function shouldRequeueInRound(status: RecallStatus): boolean {
  return status === 'missed';
}

/** A human-readable reason, shown when the app explains why something was graded. */
export function explainStatus(status: RecallStatus, signals: AttemptSignals): string {
  switch (status) {
    case 'independent':
      return 'Produced it on your own.';
    case 'prompted':
      if (signals.revealed) return 'Counted as prompted, because the answer was shown.';
      if (signals.hintCount > 0) {
        return `Counted as prompted, because you used ${signals.hintCount === 1 ? 'a hint' : `${signals.hintCount} hints`}.`;
      }
      if (signals.promptKind === 'recognition') {
        return 'Counted as prompted: recognising a phrase is not the same as producing it.';
      }
      return 'Counted as prompted.';
    case 'missed':
      return 'Not this time. It will come back shortly and again next session.';
    case 'not_tested':
      return 'Skipped, so nothing was recorded against it.';
  }
}
