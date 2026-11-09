/**
 * Grading tests.
 *
 * The spec's two strictest rules get exhaustive coverage here, because a bug would
 * not surface as a crash -- it would quietly record that the learner can produce
 * something they cannot, and the review schedule would drift from reality.
 */
import { Rating } from 'ts-fsrs';

import {
  type AttemptSignals,
  deriveStatus,
  gradeFromStatus,
  shouldRelearnNextSession,
  shouldRequeueInRound,
} from '@/srs/grading';
import type { PromptKind } from '@/types';

const PRODUCTION_KINDS: PromptKind[] = [
  'en_to_nl',
  'bg_to_nl',
  'situation',
  'cloze',
  'original_sentence',
  'spoken_cue',
];

function signals(overrides: Partial<AttemptSignals> = {}): AttemptSignals {
  return {
    aiAccepted: true,
    selfRated: null,
    hintCount: 0,
    revealed: false,
    promptKind: 'en_to_nl',
    ...overrides,
  };
}

describe('deriveStatus', () => {
  it('awards independent for a clean correct answer', () => {
    expect(deriveStatus(signals())).toBe('independent');
  });

  it('never awards independent when a hint was used', () => {
    for (const hintCount of [1, 2, 5]) {
      for (const promptKind of PRODUCTION_KINDS) {
        expect(deriveStatus(signals({ hintCount, promptKind }))).toBe('prompted');
      }
    }
  });

  it('never awards independent when the answer was revealed', () => {
    expect(deriveStatus(signals({ revealed: true }))).toBe('prompted');
  });

  it('never awards independent for recognition, however clean the answer', () => {
    expect(deriveStatus(signals({ promptKind: 'recognition' }))).toBe('prompted');
  });

  it('records a wrong answer as missed regardless of hints', () => {
    expect(deriveStatus(signals({ aiAccepted: false }))).toBe('missed');
    expect(deriveStatus(signals({ aiAccepted: false, hintCount: 3 }))).toBe('missed');
    expect(deriveStatus(signals({ aiAccepted: false, revealed: true }))).toBe('missed');
  });

  it('records a skipped item as not_tested, whatever else is set', () => {
    expect(deriveStatus(signals({ skipped: true }))).toBe('not_tested');
    expect(deriveStatus(signals({ skipped: true, aiAccepted: false, hintCount: 2 }))).toBe(
      'not_tested'
    );
  });

  it('falls back to the local match when the model was unavailable', () => {
    expect(deriveStatus(signals({ aiAccepted: null, localAccepted: true }))).toBe('independent');
    expect(deriveStatus(signals({ aiAccepted: null, localAccepted: false }))).toBe('missed');
  });

  it('treats an absent verdict with no local match as missed, never as correct', () => {
    expect(deriveStatus(signals({ aiAccepted: null }))).toBe('missed');
  });

  it('lets a self-rating override the model, since the learner knows if they peeked', () => {
    expect(deriveStatus(signals({ aiAccepted: true, selfRated: 'missed' }))).toBe('missed');
    expect(deriveStatus(signals({ aiAccepted: false, selfRated: 'got_it' }))).toBe('independent');
    expect(deriveStatus(signals({ aiAccepted: true, selfRated: 'needed_help' }))).toBe('prompted');
  });

  it('still refuses independent after a self-rating of got_it with a hint used', () => {
    expect(deriveStatus(signals({ selfRated: 'got_it', hintCount: 1 }))).toBe('prompted');
    expect(deriveStatus(signals({ selfRated: 'got_it', revealed: true }))).toBe('prompted');
  });

  it('is exhaustive: no combination with help yields independent', () => {
    const results: string[] = [];
    for (const hintCount of [0, 1]) {
      for (const revealed of [false, true]) {
        for (const promptKind of [...PRODUCTION_KINDS, 'recognition' as PromptKind]) {
          for (const selfRated of [null, 'got_it', 'needed_help'] as const) {
            const status = deriveStatus(
              signals({ hintCount, revealed, promptKind, selfRated })
            );
            if (status === 'independent') {
              results.push(`${hintCount}/${revealed}/${promptKind}/${selfRated}`);
            }
          }
        }
      }
    }
    // Only the no-hint, not-revealed, production-kind combinations may appear.
    expect(results.every((key) => key.startsWith('0/false/'))).toBe(true);
    expect(results.some((key) => key.includes('recognition'))).toBe(false);
  });
});

describe('gradeFromStatus', () => {
  it('returns null for not_tested so the caller must handle it', () => {
    expect(gradeFromStatus('not_tested', 0, 1000)).toBeNull();
  });

  it('upgrades a fast unaided answer to Easy', () => {
    expect(gradeFromStatus('independent', 0, 1500)).toBe(Rating.Easy);
  });

  it('keeps a slow unaided answer at Good', () => {
    expect(gradeFromStatus('independent', 0, 9000)).toBe(Rating.Good);
  });

  it('does not upgrade to Easy when latency is unknown', () => {
    expect(gradeFromStatus('independent', 0, null)).toBe(Rating.Good);
  });

  it('maps prompted to Hard and missed to Again', () => {
    expect(gradeFromStatus('prompted', 1, 1000)).toBe(Rating.Hard);
    expect(gradeFromStatus('missed', 0, 1000)).toBe(Rating.Again);
  });
});

describe('requeue rules', () => {
  it('brings a missed item back in this round and the next session', () => {
    expect(shouldRequeueInRound('missed')).toBe(true);
    expect(shouldRelearnNextSession('missed')).toBe(true);
  });

  it('leaves everything else to the normal schedule', () => {
    for (const status of ['independent', 'prompted', 'not_tested'] as const) {
      expect(shouldRequeueInRound(status)).toBe(false);
      expect(shouldRelearnNextSession(status)).toBe(false);
    }
  });
});
