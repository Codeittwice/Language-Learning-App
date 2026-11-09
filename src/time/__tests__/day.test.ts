/**
 * Day-boundary tests.
 *
 * A bug in this module silently corrupts streaks, FSRS due dates and daily XP at the
 * same time, and does it quietly -- so these cases are deliberately the awkward ones:
 * either side of the 4am learning-day boundary, both DST transitions, and the
 * UTC-versus-local trap that makes SQLite's `date('now')` unusable here.
 */
import {
  addDays,
  dayKeyOf,
  dayKeysBetween,
  dayKeysFrom,
  diffDayKeys,
  isValidDayKey,
  learningDayRangeUtc,
  localTimeToUtc,
  nextDayKey,
  parseDayKey,
  prevDayKey,
} from '@/time/day';

const AMS = 'Europe/Amsterdam';
const SOFIA = 'Europe/Sofia';
const DAY_START = 4;

const hours = (ms: number) => ms / 3_600_000;

describe('dayKeyOf', () => {
  it('treats a late-night session as belonging to the previous learning day', () => {
    // 01:30 local on 10 July, which a person would call "Thursday night".
    const instant = new Date('2026-07-09T23:30:00Z'); // 01:30 CEST on the 10th
    expect(dayKeyOf(instant, AMS, DAY_START)).toBe('2026-07-09');
  });

  it('rolls over once the day-start hour is reached', () => {
    expect(dayKeyOf(new Date('2026-07-10T01:59:00Z'), AMS, DAY_START)).toBe('2026-07-09'); // 03:59
    expect(dayKeyOf(new Date('2026-07-10T02:00:00Z'), AMS, DAY_START)).toBe('2026-07-10'); // 04:00
  });

  it('disagrees with the UTC calendar date, which is the whole point', () => {
    // 02:30 local on 15 July is still the 14th as a learning day, while UTC already
    // says the 15th. Computing this in SQL would log it under the wrong day.
    const instant = new Date('2026-07-15T00:30:00Z');
    expect(instant.toISOString().slice(0, 10)).toBe('2026-07-15');
    expect(dayKeyOf(instant, AMS, DAY_START)).toBe('2026-07-14');
  });

  it('handles the spring-forward transition', () => {
    // Amsterdam skips 02:00-03:00 on 2026-03-29.
    expect(dayKeyOf(new Date('2026-03-29T00:30:00Z'), AMS, DAY_START)).toBe('2026-03-28'); // 01:30 CET
    expect(dayKeyOf(new Date('2026-03-29T02:30:00Z'), AMS, DAY_START)).toBe('2026-03-29'); // 04:30 CEST
  });

  it('handles the autumn fall-back transition, where 02:30 happens twice', () => {
    // 2026-10-25: 03:00 CEST becomes 02:00 CET.
    expect(dayKeyOf(new Date('2026-10-25T00:30:00Z'), AMS, DAY_START)).toBe('2026-10-24'); // 02:30 CEST
    expect(dayKeyOf(new Date('2026-10-25T01:30:00Z'), AMS, DAY_START)).toBe('2026-10-24'); // 02:30 CET
    expect(dayKeyOf(new Date('2026-10-25T03:30:00Z'), AMS, DAY_START)).toBe('2026-10-25'); // 04:30 CET
  });

  it('follows the learner when they travel', () => {
    // The same instant is a different learning day in Amsterdam and Sofia.
    const instant = new Date('2026-07-15T01:30:00Z'); // 03:30 CEST / 04:30 EEST
    expect(dayKeyOf(instant, AMS, DAY_START)).toBe('2026-07-14');
    expect(dayKeyOf(instant, SOFIA, DAY_START)).toBe('2026-07-15');
  });

  it('crosses month and year boundaries', () => {
    expect(dayKeyOf(new Date('2027-01-01T02:00:00Z'), AMS, DAY_START)).toBe('2026-12-31'); // 03:00 CET
    expect(dayKeyOf(new Date('2026-08-01T01:00:00Z'), AMS, DAY_START)).toBe('2026-07-31'); // 03:00 CEST
  });

  it('respects a day-start hour of 0, where the learning day is the calendar day', () => {
    expect(dayKeyOf(new Date('2026-07-09T23:30:00Z'), AMS, 0)).toBe('2026-07-10');
  });
});

describe('learningDayRangeUtc', () => {
  it('spans exactly 24 hours on an ordinary day', () => {
    const { startUtc, endUtc } = learningDayRangeUtc('2026-07-09', AMS, DAY_START);
    expect(startUtc).toBe('2026-07-09T02:00:00.000Z'); // 04:00 CEST
    expect(hours(Date.parse(endUtc) - Date.parse(startUtc))).toBe(24);
  });

  it('spans 23 hours across spring-forward when the boundary is inside the gap window', () => {
    const { startUtc, endUtc } = learningDayRangeUtc('2026-03-29', AMS, 1);
    expect(hours(Date.parse(endUtc) - Date.parse(startUtc))).toBe(23);
  });

  it('spans 25 hours across fall-back when the boundary is inside the repeated hour', () => {
    const { startUtc, endUtc } = learningDayRangeUtc('2026-10-25', AMS, 1);
    expect(hours(Date.parse(endUtc) - Date.parse(startUtc))).toBe(25);
  });

  it('contains every instant that maps to its day key, and no others', () => {
    const dayKey = '2026-10-25';
    const { startUtc, endUtc } = learningDayRangeUtc(dayKey, AMS, DAY_START);
    const inside = new Date(Date.parse(startUtc) + 60_000);
    const before = new Date(Date.parse(startUtc) - 60_000);
    const after = new Date(Date.parse(endUtc) + 60_000);

    expect(dayKeyOf(inside, AMS, DAY_START)).toBe(dayKey);
    expect(dayKeyOf(before, AMS, DAY_START)).toBe(prevDayKey(dayKey));
    expect(dayKeyOf(after, AMS, DAY_START)).toBe(nextDayKey(dayKey));
  });
});

describe('localTimeToUtc', () => {
  it('keeps a wall-clock reminder time stable across a DST change', () => {
    // 19:30 local before and after fall-back: one hour apart in UTC, same on the clock.
    const before = localTimeToUtc('2026-10-24', 19, 30, AMS);
    const after = localTimeToUtc('2026-10-26', 19, 30, AMS);
    expect(before.toISOString()).toBe('2026-10-24T17:30:00.000Z'); // CEST
    expect(after.toISOString()).toBe('2026-10-26T18:30:00.000Z'); // CET
  });

  it('returns a usable instant for a time that does not exist', () => {
    // 02:30 is skipped on 2026-03-29; we normalise rather than throw, because a
    // reminder an hour off once a year beats no reminder.
    const instant = localTimeToUtc('2026-03-29', 2, 30, AMS);
    expect(Number.isFinite(instant.getTime())).toBe(true);
  });
});

describe('day key arithmetic', () => {
  it('adds and subtracts across month and leap-year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // 2028 is a leap year
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-07-09', 14)).toBe('2026-07-23');
  });

  it('measures signed differences in whole days', () => {
    expect(diffDayKeys('2026-07-09', '2026-07-10')).toBe(1);
    expect(diffDayKeys('2026-07-10', '2026-07-09')).toBe(-1);
    expect(diffDayKeys('2026-07-09', '2026-07-09')).toBe(0);
    // Spanning a DST change must still be whole days, not 29.96.
    expect(diffDayKeys('2026-03-01', '2026-03-31')).toBe(30);
    expect(diffDayKeys('2026-10-01', '2026-10-31')).toBe(30);
  });

  it('lists inclusive ranges and fixed-length windows', () => {
    expect(dayKeysBetween('2026-07-09', '2026-07-11')).toEqual([
      '2026-07-09',
      '2026-07-10',
      '2026-07-11',
    ]);
    expect(dayKeysBetween('2026-07-11', '2026-07-09')).toEqual([]);
    expect(dayKeysFrom('2026-12-30', 3)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
    expect(dayKeysFrom('2026-07-09', 14)).toHaveLength(14);
  });
});

describe('day key validation', () => {
  it('accepts well-formed keys and rejects everything else', () => {
    expect(isValidDayKey('2026-07-09')).toBe(true);
    expect(isValidDayKey('2026-7-9')).toBe(false);
    expect(isValidDayKey('2026-02-30')).toBe(false);
    expect(isValidDayKey('2026-13-01')).toBe(false);
    expect(isValidDayKey('')).toBe(false);
    expect(isValidDayKey(20260709)).toBe(false);
    expect(isValidDayKey(null)).toBe(false);
  });

  it('throws on malformed input rather than returning a plausible wrong date', () => {
    expect(() => parseDayKey('2026-02-30')).toThrow(/Impossible date/);
    expect(() => parseDayKey('nonsense')).toThrow(/Malformed/);
  });
});
