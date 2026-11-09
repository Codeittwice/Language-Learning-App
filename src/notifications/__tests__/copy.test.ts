/**
 * Reminder copy tests.
 *
 * The property that matters is non-repetition across the scheduling horizon: if the
 * fourteen notifications queued at once all say the same thing, the whole reason for
 * scheduling them individually disappears.
 */
import { type CopyContext, pickCopy, TEMPLATE_COUNT } from '@/notifications/copy';
import { REMINDER_HORIZON_DAYS } from '@/notifications/constants';
import { topicFor } from '@/session/rotation';
import { dayKeysFrom } from '@/time/day';

function context(overrides: Partial<CopyContext> = {}): CopyContext {
  return {
    dayKey: '2026-11-09',
    streak: 4,
    longestStreak: 9,
    dueCount: 7,
    sessionNumber: 12,
    topic: topicFor(12),
    samplePhrase: { dutch: 'geen zin hebben in', meaningEn: "not to fancy something" },
    challenge: 'Ask a teammate how their day was.',
    sport: 'volleyball',
    ...overrides,
  };
}

describe('pickCopy', () => {
  it('is deterministic for a given day', () => {
    const a = pickCopy(context());
    const b = pickCopy(context());
    expect(a).toEqual(b);
  });

  it('does not repeat across the scheduling horizon', () => {
    const titles = dayKeysFrom('2026-11-09', REMINDER_HORIZON_DAYS).map(
      (dayKey) => pickCopy(context({ dayKey })).title
    );
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('never says "time to practice"', () => {
    for (const dayKey of dayKeysFrom('2026-01-01', 400)) {
      const copy = pickCopy(context({ dayKey }));
      expect(`${copy.title} ${copy.body}`.toLowerCase()).not.toContain('time to practice');
      expect(`${copy.title} ${copy.body}`.toLowerCase()).not.toContain('time to practise');
    }
  });

  it('always routes somewhere real', () => {
    for (const dayKey of dayKeysFrom('2026-01-01', 120)) {
      const copy = pickCopy(context({ dayKey }));
      expect(copy.data.route.startsWith('/')).toBe(true);
    }
  });

  it('never claims a streak when there is none', () => {
    for (const dayKey of dayKeysFrom('2026-01-01', 200)) {
      const copy = pickCopy(context({ dayKey, streak: 0, longestStreak: 0 }));
      const text = `${copy.title} ${copy.body}`;
      expect(text).not.toMatch(/\bDay \d+/);
      expect(text).not.toMatch(/days on the line/);
      expect(text).not.toMatch(/longest run/);
    }
  });

  it('never quotes a phrase when the bank is empty', () => {
    for (const dayKey of dayKeysFrom('2026-01-01', 200)) {
      const copy = pickCopy(context({ dayKey, samplePhrase: null }));
      expect(copy.title).not.toContain('Weet je nog?');
      expect(copy.title).not.toContain('undefined');
      expect(copy.body).not.toContain('undefined');
    }
  });

  it('never states a due count when nothing is due', () => {
    for (const dayKey of dayKeysFrom('2026-01-01', 200)) {
      const copy = pickCopy(context({ dayKey, dueCount: 0 }));
      expect(`${copy.title} ${copy.body}`).not.toMatch(/\d+ phrases are due/);
      expect(copy.title).not.toMatch(/^Only 0 due/);
    }
  });

  it('never mentions a challenge when none is open', () => {
    for (const dayKey of dayKeysFrom('2026-01-01', 200)) {
      const copy = pickCopy(context({ dayKey, challenge: null }));
      expect(copy.body).not.toContain('null');
      expect(copy.title).not.toBe('Still got a challenge open');
    }
  });

  it('survives a completely empty profile', () => {
    const copy = pickCopy(
      context({
        streak: 0,
        longestStreak: 0,
        dueCount: 0,
        sessionNumber: 1,
        samplePhrase: null,
        challenge: null,
        sport: null,
      })
    );
    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.body.length).toBeGreaterThan(0);
  });

  it('has a pool large enough that the horizon cannot exhaust it', () => {
    expect(TEMPLATE_COUNT).toBeGreaterThanOrEqual(REMINDER_HORIZON_DAYS);
  });
});

describe('reminder routes', () => {
  it('only ever points at routes that exist', () => {
    // A notification that cannot navigate is worse than no notification: the one
    // feature the whole app rests on silently does nothing when tapped.
    const KNOWN_ROUTES = ['/session/today'];
    for (const dayKey of dayKeysFrom('2026-01-01', 200)) {
      const { route } = pickCopy(context({ dayKey })).data;
      const path = route.split('?')[0] ?? route;
      expect(KNOWN_ROUTES).toContain(path);
    }
  });
});
