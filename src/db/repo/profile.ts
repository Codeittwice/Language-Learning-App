/**
 * The single-row learner profile, and the day-key helper everything else calls.
 *
 * `currentDayKey` is here rather than in `src/time/day.ts` because it needs the
 * profile's timezone and day-start hour; `day.ts` stays pure and unit-testable.
 */
import * as Localization from 'expo-localization';
import type { SQLiteDatabase } from 'expo-sqlite';

import { parseStringArray, toJsonColumn } from '@/db';
import { emit } from '@/db/events';
import { type DayKey, dayKeyOf, nowIso } from '@/time/day';
import { DEFAULT_DAILY_GOAL_XP, type DurationMode } from '@/types';

export type LearnerProfile = {
  nativeLanguage: string;
  explanationLanguage: string;
  targetVariety: string;
  defaultRegister: string;
  sport: string | null;
  interests: string[];
  goals: string | null;
  defaultDurationMode: DurationMode;
  dayStartHour: number;
  timezone: string;
  ttsVoiceId: string | null;
  ttsRate: number;
  dailyGoalXp: number;
  onboardedAt: string | null;
};

type ProfileRow = {
  native_language: string;
  explanation_language: string;
  target_variety: string;
  default_register: string;
  sport: string | null;
  interests: string;
  goals: string | null;
  default_duration_mode: DurationMode;
  day_start_hour: number;
  timezone: string;
  tts_voice_id: string | null;
  tts_rate: number;
  daily_goal_xp: number;
  onboarded_at: string | null;
};

/** The device's IANA timezone. Read live, never cached -- the learner travels. */
export function deviceTimezone(): string {
  const calendars = Localization.getCalendars();
  return calendars[0]?.timeZone ?? 'Europe/Amsterdam';
}

function toProfile(row: ProfileRow): LearnerProfile {
  return {
    nativeLanguage: row.native_language,
    explanationLanguage: row.explanation_language,
    targetVariety: row.target_variety,
    defaultRegister: row.default_register,
    sport: row.sport,
    interests: parseStringArray(row.interests),
    goals: row.goals,
    defaultDurationMode: row.default_duration_mode,
    dayStartHour: row.day_start_hour,
    timezone: row.timezone,
    ttsVoiceId: row.tts_voice_id,
    ttsRate: row.tts_rate,
    dailyGoalXp: row.daily_goal_xp,
    onboardedAt: row.onboarded_at,
  };
}

/** Create the profile row on first launch. Safe to call on every launch. */
export async function ensureProfile(db: SQLiteDatabase): Promise<LearnerProfile> {
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO learner_profile (id, timezone, created_at, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [deviceTimezone(), now, now]
  );
  return getProfile(db);
}

export async function getProfile(db: SQLiteDatabase): Promise<LearnerProfile> {
  const row = await db.getFirstAsync<ProfileRow>(
    `SELECT native_language, explanation_language, target_variety, default_register,
            sport, interests, goals, default_duration_mode, day_start_hour, timezone,
            tts_voice_id, tts_rate, daily_goal_xp, onboarded_at
       FROM learner_profile WHERE id = 1`
  );
  if (!row) {
    // Only reachable if ensureProfile has not run; the caller gets usable defaults
    // rather than a crash.
    return {
      nativeLanguage: 'bg',
      explanationLanguage: 'en',
      targetVariety: 'nl-NL',
      defaultRegister: 'informal',
      sport: null,
      interests: [],
      goals: null,
      defaultDurationMode: 'standard',
      dayStartHour: 4,
      timezone: deviceTimezone(),
      ttsVoiceId: null,
      ttsRate: 1,
      dailyGoalXp: DEFAULT_DAILY_GOAL_XP,
      onboardedAt: null,
    };
  }
  return toProfile(row);
}

const COLUMN_OF: Record<keyof LearnerProfile, string> = {
  nativeLanguage: 'native_language',
  explanationLanguage: 'explanation_language',
  targetVariety: 'target_variety',
  defaultRegister: 'default_register',
  sport: 'sport',
  interests: 'interests',
  goals: 'goals',
  defaultDurationMode: 'default_duration_mode',
  dayStartHour: 'day_start_hour',
  timezone: 'timezone',
  ttsVoiceId: 'tts_voice_id',
  ttsRate: 'tts_rate',
  dailyGoalXp: 'daily_goal_xp',
  onboardedAt: 'onboarded_at',
};

export async function updateProfile(
  db: SQLiteDatabase,
  patch: Partial<LearnerProfile>
): Promise<void> {
  const assignments: string[] = [];
  const args: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(patch) as [keyof LearnerProfile, unknown][]) {
    const column = COLUMN_OF[key];
    if (!column) continue;
    assignments.push(`${column} = ?`);
    if (key === 'interests') args.push(toJsonColumn(value ?? []));
    else if (typeof value === 'number' || typeof value === 'string' || value === null) {
      args.push(value);
    } else args.push(String(value));
  }
  if (assignments.length === 0) return;

  assignments.push('updated_at = ?');
  args.push(nowIso());

  await db.runAsync(`UPDATE learner_profile SET ${assignments.join(', ')} WHERE id = 1`, args);
  emit('settings:changed');
}

/**
 * The learning day we are currently in. Every `day_key` written anywhere in the app
 * comes from this or from `dayKeyOf` with the same profile values.
 */
export async function currentDayKey(db: SQLiteDatabase, at: Date = new Date()): Promise<DayKey> {
  const profile = await getProfile(db);
  return dayKeyOf(at, profile.timezone, profile.dayStartHour);
}

/**
 * Keep the stored timezone in sync with the device. Returns the previous value when
 * it changed, which the reminder scheduler uses to force a full reschedule.
 */
export async function syncTimezone(db: SQLiteDatabase): Promise<string | null> {
  const profile = await getProfile(db);
  const live = deviceTimezone();
  if (live === profile.timezone) return null;
  await updateProfile(db, { timezone: live });
  return profile.timezone;
}
