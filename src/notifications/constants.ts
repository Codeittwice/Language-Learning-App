/**
 * Scheduling constants and identifiers.
 *
 * Kept separate from `schedule.ts` so they can be used without importing
 * `expo-notifications`, which has native side effects at module load.
 */
import type { DayKey } from '@/time/day';

/**
 * How many days of reminders are queued at once.
 *
 * Long enough that the app surviving a fortnight unopened still nudges, short enough
 * that a DST shift in an absolute DATE trigger stays bounded.
 */
export const REMINDER_HORIZON_DAYS = 14;

export const DEFAULT_REMINDER_HOUR = 19;
export const DEFAULT_REMINDER_MINUTE = 30;

/** The late streak-rescue nudge. */
export const RESCUE_HOUR = 21;
export const RESCUE_MINUTE = 0;

/** Below this, a broken streak does not justify a second notification. */
export const RESCUE_MIN_STREAK = 3;

/** Per-day identifiers, so today's reminder can be cancelled on its own. */
export function reminderId(dayKey: DayKey): string {
  return `reminder-${dayKey}`;
}

export function rescueId(dayKey: DayKey): string {
  return `rescue-${dayKey}`;
}
