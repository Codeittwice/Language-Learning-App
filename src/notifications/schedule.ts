/**
 * Scheduling the daily reminder.
 *
 * A rolling fourteen-day window of individual DATE triggers, rebuilt from scratch on
 * every reconcile. That shape is chosen for four reasons:
 *
 *  - Each day can carry different copy (a single DAILY trigger cannot).
 *  - Each day has its own identifier, so today's can be cancelled the moment the goal
 *    is met, instead of nagging someone who has already practised.
 *  - Cancel-all-then-rebuild cannot drift. Incremental scheduling accumulates
 *    orphans and duplicates over months.
 *  - A DATE trigger is an absolute instant, so DST would shift it; a fourteen-day
 *    horizon rebuilt on every app open bounds that error to the next time the app is
 *    opened, which in practice is daily.
 */
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';

import { countDue } from '@/db/repo/phrases';
import { currentDayKey, deviceTimezone, getProfile, syncTimezone } from '@/db/repo/profile';
import { completedSessionCount, openChallenge } from '@/db/repo/sessions';
import {
  getBoolSetting,
  getNumberSetting,
  getStringSetting,
  SETTING_KEYS,
  setSetting,
} from '@/db/repo/settings';
import { readStreak } from '@/gamification/streak';
import { getDailyProgress } from '@/gamification/xp';
import {
  cancelAll,
  cancelById,
  DAILY_CHANNEL_ID,
  getPermissionState,
  pendingCount,
  RESCUE_CHANNEL_ID,
} from '@/notifications';
import { type CopyContext, pickCopy, rescueCopy } from '@/notifications/copy';
import {
  DEFAULT_REMINDER_HOUR,
  DEFAULT_REMINDER_MINUTE,
  REMINDER_HORIZON_DAYS,
  reminderId,
  RESCUE_HOUR,
  RESCUE_MIN_STREAK,
  RESCUE_MINUTE,
  rescueId,
} from '@/notifications/constants';
import { topicFor } from '@/session/rotation';
import { type DayKey, dayKeysFrom, localTimeToUtc, nowIso } from '@/time/day';

export {
  DEFAULT_REMINDER_HOUR,
  DEFAULT_REMINDER_MINUTE,
  REMINDER_HORIZON_DAYS,
  reminderId,
  rescueId,
} from '@/notifications/constants';

export type ReconcileReason =
  | 'startup'
  | 'foreground'
  | 'settings-changed'
  | 'permission-granted'
  | 'goal-met'
  | 'session-progress'
  | 'timezone-changed';

export type ReconcileReport = {
  scheduled: number;
  skippedToday: boolean;
  rescueScheduled: boolean;
  permissionGranted: boolean;
  timezone: string;
  timezoneChanged: boolean;
};

/**
 * The only scheduling entry point. Idempotent and total: it always describes the
 * complete desired state, so calling it twice in a row changes nothing.
 */
export async function reconcileReminders(
  db: SQLiteDatabase,
  reason: ReconcileReason
): Promise<ReconcileReport> {
  const previousTimezone = await syncTimezone(db);
  const timezone = deviceTimezone();

  const permission = await getPermissionState();
  if (!permission.granted) {
    await cancelAll();
    await recordState(db, reason, 0, timezone);
    return {
      scheduled: 0,
      skippedToday: false,
      rescueScheduled: false,
      permissionGranted: false,
      timezone,
      timezoneChanged: previousTimezone !== null,
    };
  }

  const enabled = await getBoolSetting(db, SETTING_KEYS.remindersEnabled, true);
  if (!enabled) {
    await cancelAll();
    await recordState(db, reason, 0, timezone);
    return {
      scheduled: 0,
      skippedToday: false,
      rescueScheduled: false,
      permissionGranted: true,
      timezone,
      timezoneChanged: previousTimezone !== null,
    };
  }

  const [hour, minute, rescueEnabled, todayKey] = await Promise.all([
    getNumberSetting(db, SETTING_KEYS.reminderHour, DEFAULT_REMINDER_HOUR),
    getNumberSetting(db, SETTING_KEYS.reminderMinute, DEFAULT_REMINDER_MINUTE),
    getBoolSetting(db, SETTING_KEYS.rescueEnabled, true),
    currentDayKey(db),
  ]);

  const context = await buildContext(db, todayKey);
  const progress = await getDailyProgress(db, todayKey);
  const streak = await readStreak(db, todayKey);

  // Rebuild from nothing. This is the only approach that cannot accumulate orphans.
  await cancelAll();

  const now = Date.now();
  let scheduled = 0;
  let skippedToday = false;

  for (const dayKey of dayKeysFrom(todayKey, REMINDER_HORIZON_DAYS)) {
    // Nothing should nag someone who has already done the work today.
    if (dayKey === todayKey && progress.goalMet) {
      skippedToday = true;
      continue;
    }

    const fireAt = localTimeToUtc(dayKey, hour, minute, timezone);
    if (fireAt.getTime() <= now) {
      if (dayKey === todayKey) skippedToday = true;
      continue;
    }

    const copy = pickCopy({ ...context, dayKey });
    await Notifications.scheduleNotificationAsync({
      identifier: reminderId(dayKey),
      content: {
        title: copy.title,
        body: copy.body,
        data: copy.data,
        sound: true,
      },
      trigger: {
        type: SchedulableTriggerInputTypes.DATE,
        date: fireAt,
        channelId: DAILY_CHANNEL_ID,
      },
    });
    scheduled += 1;
  }

  // A second notification is only justified when a real run is about to end.
  let rescueScheduled = false;
  if (rescueEnabled && !progress.goalMet && streak.current >= RESCUE_MIN_STREAK) {
    const fireAt = localTimeToUtc(todayKey, RESCUE_HOUR, RESCUE_MINUTE, timezone);
    if (fireAt.getTime() > now) {
      const copy = rescueCopy({ ...context, streak: streak.current });
      await Notifications.scheduleNotificationAsync({
        identifier: rescueId(todayKey),
        content: { title: copy.title, body: copy.body, data: copy.data, sound: true },
        trigger: {
          type: SchedulableTriggerInputTypes.DATE,
          date: fireAt,
          channelId: RESCUE_CHANNEL_ID,
        },
      });
      rescueScheduled = true;
    }
  }

  await recordState(db, reason, scheduled + (rescueScheduled ? 1 : 0), timezone);

  return {
    scheduled,
    skippedToday,
    rescueScheduled,
    permissionGranted: true,
    timezone,
    timezoneChanged: previousTimezone !== null,
  };
}

/** Build the copy context from real data only. */
async function buildContext(db: SQLiteDatabase, todayKey: DayKey): Promise<CopyContext> {
  const [profile, completed, due, challenge, streak] = await Promise.all([
    getProfile(db),
    completedSessionCount(db),
    countDue(db, new Date()),
    openChallenge(db),
    readStreak(db, todayKey),
  ]);

  // A phrase actually in the bank, preferring one that is due.
  const sample = await db.getFirstAsync<{ dutch: string; meaning_en: string }>(
    `SELECT dutch, meaning_en FROM phrases
      WHERE is_archived = 0
      ORDER BY (fsrs_due <= ?) DESC, fsrs_due ASC LIMIT 1`,
    [new Date().toISOString()]
  );

  const sessionNumber = completed + 1;

  return {
    dayKey: todayKey,
    streak: streak.current,
    longestStreak: streak.longest,
    dueCount: due,
    sessionNumber,
    topic: topicFor(sessionNumber),
    samplePhrase: sample ? { dutch: sample.dutch, meaningEn: sample.meaning_en } : null,
    challenge: challenge?.action ?? null,
    sport: profile.sport,
  };
}

async function recordState(
  db: SQLiteDatabase,
  reason: ReconcileReason,
  count: number,
  timezone: string
): Promise<void> {
  await setSetting(db, SETTING_KEYS.lastReconcileAt, nowIso());
  await setSetting(db, SETTING_KEYS.lastReconcileReason, reason);
  await setSetting(db, SETTING_KEYS.pendingCount, count);
  await setSetting(db, SETTING_KEYS.scheduledTimezone, timezone);
}

/**
 * Drop today's reminder the moment the goal is met.
 *
 * The addressable per-day identifier is exactly why individual DATE triggers beat one
 * repeating DAILY trigger: a DAILY trigger could not be cancelled for today only.
 */
export async function cancelToday(db: SQLiteDatabase): Promise<void> {
  const todayKey = await currentDayKey(db);
  await cancelById(reminderId(todayKey));
  await cancelById(rescueId(todayKey));
}

export type ReminderHealth = {
  permissionGranted: boolean;
  canAskAgain: boolean;
  enabled: boolean;
  pending: number;
  lastReconcileAt: string | null;
  scheduledTimezone: string | null;
  liveTimezone: string;
  /** Set when the OS has no queued notifications despite permission being granted. */
  looksCleared: boolean;
};

/**
 * Detect the Android force-stop case by its consequence.
 *
 * There is no API that reports "the user force-stopped the app", and doing so wipes
 * every scheduled notification silently. Permission granted plus an empty queue is
 * the observable signature, so the UI can say so plainly and reschedule.
 */
export async function checkReminderHealth(db: SQLiteDatabase): Promise<ReminderHealth> {
  const permission = await getPermissionState();
  const enabled = await getBoolSetting(db, SETTING_KEYS.remindersEnabled, true);
  const pending = await pendingCount();

  return {
    permissionGranted: permission.granted,
    canAskAgain: permission.canAskAgain,
    enabled,
    pending,
    lastReconcileAt: await getStringSetting(db, SETTING_KEYS.lastReconcileAt),
    scheduledTimezone: await getStringSetting(db, SETTING_KEYS.scheduledTimezone),
    liveTimezone: deviceTimezone(),
    looksCleared: permission.granted && enabled && pending === 0,
  };
}

/** Called on foreground: repairs the schedule if something wiped it. */
export async function healIfCleared(db: SQLiteDatabase): Promise<boolean> {
  const health = await checkReminderHealth(db);
  if (!health.looksCleared) return false;

  const resets = await getNumberSetting(db, SETTING_KEYS.reminderResetCount, 0);
  await setSetting(db, SETTING_KEYS.reminderResetCount, resets + 1);
  await reconcileReminders(db, 'foreground');
  return true;
}
