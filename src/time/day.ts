/**
 * Learning-day arithmetic. The single source of truth for what "today" means.
 *
 * Two rules the rest of the app depends on:
 *
 * 1. A `dayKey` is a 'YYYY-MM-DD' string naming a LEARNING day, which runs from
 *    `dayStartHour` local time until the same hour the next calendar day. With the
 *    default of 4am, practising at 00:40 counts toward the previous day -- which is
 *    what a person means by "I practised tonight", and it stops a late session from
 *    both breaking yesterday's streak and consuming today's.
 *
 * 2. Day keys are NEVER computed in SQL. SQLite's `date('now')` is UTC, so at 01:00
 *    Amsterdam time in summer it returns yesterday. Every day key in the database
 *    comes from this module.
 */
import { TZDate } from '@date-fns/tz';

/** A 'YYYY-MM-DD' string identifying one learning day. */
export type DayKey = string;

const MS_PER_DAY = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Format wall-clock calendar parts as a day key. `month` is 0-indexed, as in `Date`. */
function partsToDayKey(year: number, month: number, day: number): DayKey {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

/** Parse a day key into 0-indexed calendar parts. Throws on malformed input. */
export function parseDayKey(dayKey: DayKey): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) throw new Error(`Malformed dayKey: ${JSON.stringify(dayKey)}`);
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  // Round-trip to reject impossible dates like 2026-02-30.
  const probe = new Date(Date.UTC(year, month, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`Impossible date in dayKey: ${dayKey}`);
  }
  return { year, month, day };
}

export function isValidDayKey(value: unknown): value is DayKey {
  if (typeof value !== 'string') return false;
  try {
    parseDayKey(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * The learning day an instant falls in.
 *
 * Works on wall-clock parts rather than epoch arithmetic, so DST transitions cannot
 * shift the answer: we ask "what does the clock on the wall in `tz` say", then shift
 * the calendar date back by one if we are before the day boundary.
 */
export function dayKeyOf(instant: Date, tz: string, dayStartHour: number): DayKey {
  const local = new TZDate(instant.getTime(), tz);
  const year = local.getFullYear();
  const month = local.getMonth();
  const day = local.getDate();

  if (local.getHours() >= dayStartHour) {
    return partsToDayKey(year, month, day);
  }
  // Before the boundary: this instant belongs to the previous learning day. Pure
  // calendar arithmetic via UTC so month and year rollovers are handled for us.
  const shifted = new Date(Date.UTC(year, month, day) - MS_PER_DAY);
  return partsToDayKey(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/**
 * The UTC instant range `[startUtc, endUtc)` covered by a learning day.
 * Use this for every "did this happen today" query instead of comparing against
 * local midnight, which silently hides or reveals cards a day early.
 */
export function learningDayRangeUtc(
  dayKey: DayKey,
  tz: string,
  dayStartHour: number
): { startUtc: string; endUtc: string } {
  const { year, month, day } = parseDayKey(dayKey);
  const start = new TZDate(year, month, day, dayStartHour, 0, 0, 0, tz);
  const next = parseDayKey(addDays(dayKey, 1));
  const end = new TZDate(next.year, next.month, next.day, dayStartHour, 0, 0, 0, tz);
  return { startUtc: new Date(start.getTime()).toISOString(), endUtc: new Date(end.getTime()).toISOString() };
}

/**
 * The UTC instant of a wall-clock time on a given learning day -- used to schedule
 * reminders at "19:30 local" regardless of DST.
 *
 * If the requested time does not exist (the spring-forward gap), the platform
 * normalises it forward; we return whatever instant that is rather than failing,
 * since a reminder an hour late once a year is better than no reminder.
 */
export function localTimeToUtc(
  dayKey: DayKey,
  hour: number,
  minute: number,
  tz: string
): Date {
  const { year, month, day } = parseDayKey(dayKey);
  return new Date(new TZDate(year, month, day, hour, minute, 0, 0, tz).getTime());
}

/** Shift a day key by whole days. Negative `delta` goes backwards. */
export function addDays(dayKey: DayKey, delta: number): DayKey {
  const { year, month, day } = parseDayKey(dayKey);
  const shifted = new Date(Date.UTC(year, month, day) + delta * MS_PER_DAY);
  return partsToDayKey(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

export function nextDayKey(dayKey: DayKey): DayKey {
  return addDays(dayKey, 1);
}

export function prevDayKey(dayKey: DayKey): DayKey {
  return addDays(dayKey, -1);
}

/** Whole days from `from` to `to`. Positive when `to` is later. */
export function diffDayKeys(from: DayKey, to: DayKey): number {
  const a = parseDayKey(from);
  const b = parseDayKey(to);
  const ms = Date.UTC(b.year, b.month, b.day) - Date.UTC(a.year, a.month, a.day);
  return Math.round(ms / MS_PER_DAY);
}

/** Inclusive list of day keys from `from` to `to`. Empty when `to` precedes `from`. */
export function dayKeysBetween(from: DayKey, to: DayKey): DayKey[] {
  const span = diffDayKeys(from, to);
  if (span < 0) return [];
  const out: DayKey[] = [];
  for (let i = 0; i <= span; i += 1) out.push(addDays(from, i));
  return out;
}

/** The next `count` day keys starting at `from` inclusive. */
export function dayKeysFrom(from: DayKey, count: number): DayKey[] {
  const out: DayKey[] = [];
  for (let i = 0; i < count; i += 1) out.push(addDays(from, i));
  return out;
}

/** Current timestamp in the one format the database stores. */
export function nowIso(): string {
  return new Date().toISOString();
}
