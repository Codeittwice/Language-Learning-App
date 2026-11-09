/**
 * Streak tests.
 *
 * `computeStreak` is pure over a set of day keys, which is the whole point: the
 * awkward cases here -- a gap, a freeze, travel, a day not yet practised -- are all
 * expressible without a database or a clock.
 */
import { computeStreak, earnedFreezes } from '@/gamification/streak';

const days = (...keys: string[]) => keys;

describe('computeStreak', () => {
  it('is zero with no history', () => {
    const result = computeStreak([], '2026-11-09', 0);
    expect(result.current).toBe(0);
    expect(result.longest).toBe(0);
    expect(result.lastGoalDay).toBeNull();
  });

  it('counts a run ending today', () => {
    const result = computeStreak(days('2026-11-07', '2026-11-08', '2026-11-09'), '2026-11-09', 0);
    expect(result.current).toBe(3);
    expect(result.atRisk).toBe(false);
  });

  it('keeps the streak alive on a day not yet practised', () => {
    // Mid-morning, before today's session: yesterday's run must still stand.
    const result = computeStreak(days('2026-11-07', '2026-11-08'), '2026-11-09', 0);
    expect(result.current).toBe(2);
    expect(result.atRisk).toBe(true);
  });

  it('breaks after a full day missed with no freeze', () => {
    // Practised up to the 7th, nothing on the 8th, now the 9th.
    const result = computeStreak(days('2026-11-06', '2026-11-07'), '2026-11-09', 0);
    expect(result.current).toBe(0);
  });

  it('bridges a single missed day with a freeze', () => {
    const result = computeStreak(
      days('2026-11-06', '2026-11-07', '2026-11-09'),
      '2026-11-09',
      1
    );
    expect(result.current).toBe(3);
    expect(result.frozenDays).toEqual(['2026-11-08']);
    expect(result.freezesAvailable).toBe(0);
  });

  it('does not bridge two consecutive missed days', () => {
    const result = computeStreak(days('2026-11-05', '2026-11-06', '2026-11-09'), '2026-11-09', 2);
    expect(result.current).toBe(1);
  });

  it('reports the longest run even when the current one is broken', () => {
    const result = computeStreak(
      days(
        '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
        '2026-11-09'
      ),
      '2026-11-09',
      0
    );
    expect(result.current).toBe(1);
    expect(result.longest).toBe(5);
  });

  it('counts a run that spans a month boundary', () => {
    const result = computeStreak(
      days('2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'),
      '2026-11-02',
      0
    );
    expect(result.current).toBe(4);
  });

  it('counts a run that spans a year boundary', () => {
    const result = computeStreak(
      days('2026-12-30', '2026-12-31', '2027-01-01'),
      '2027-01-01',
      0
    );
    expect(result.current).toBe(3);
  });

  it('is unaffected by duplicate or unordered input', () => {
    const result = computeStreak(
      days('2026-11-09', '2026-11-07', '2026-11-08', '2026-11-08'),
      '2026-11-09',
      0
    );
    expect(result.current).toBe(3);
  });

  it('ignores future days rather than counting them', () => {
    // Travelling east can leave a day key ahead of "today" in the old zone.
    const result = computeStreak(days('2026-11-08', '2026-11-09', '2026-11-10'), '2026-11-09', 0);
    expect(result.current).toBe(2);
  });

  it('does not spend a freeze to start a run from nothing', () => {
    // A freeze bridges a gap inside a run; it does not invent one.
    const result = computeStreak(days('2026-11-01'), '2026-11-09', 2);
    expect(result.current).toBe(0);
  });

  it('never reports longest below current', () => {
    const result = computeStreak(days('2026-11-08', '2026-11-09'), '2026-11-09', 0);
    expect(result.longest).toBeGreaterThanOrEqual(result.current);
  });
});

describe('earnedFreezes', () => {
  it('grants one per ten days, capped at two', () => {
    expect(earnedFreezes(0)).toBe(0);
    expect(earnedFreezes(9)).toBe(0);
    expect(earnedFreezes(10)).toBe(1);
    expect(earnedFreezes(25)).toBe(2);
    expect(earnedFreezes(300)).toBe(2);
  });
});
