/**
 * The `settings` key/value table.
 *
 * Values are JSON-encoded and validated with a Zod schema on read, so a setting
 * written by an older build can never crash a screen -- it falls back to the default
 * and logs. API keys are NOT stored here; they live in SecureStore (`src/ai/keys.ts`).
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { z, type ZodType } from 'zod';

import { emit } from '@/db/events';
import { nowIso } from '@/time/day';

export const SETTING_KEYS = {
  aiProvider: 'ai.provider',
  aiChatModel: 'ai.chatModel',
  aiStructuredModel: 'ai.structuredModel',
  aiDailyCapUsd: 'ai.dailyCapUsd',

  remindersEnabled: 'reminders.enabled',
  reminderHour: 'reminders.hour',
  reminderMinute: 'reminders.minute',
  rescueEnabled: 'reminders.rescueEnabled',
  lastReconcileAt: 'reminders.lastReconcileAt',
  lastReconcileReason: 'reminders.lastReconcileReason',
  pendingCount: 'reminders.pendingCount',
  scheduledTimezone: 'reminders.scheduledTimezone',
  reminderResetCount: 'reminders.resetCount',
  ignoredStreak: 'reminders.ignoredStreak',

  fts5Available: 'db.fts5Available',
  seedImportedAt: 'db.seedImportedAt',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export async function getSetting<T>(
  db: SQLiteDatabase,
  key: SettingKey,
  schema: ZodType<T>,
  fallback: T
): Promise<T> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [key]
  );
  if (!row) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(row.value));
    if (parsed.success) return parsed.data;
    console.warn(`[settings] "${key}" failed validation; using default`);
  } catch {
    console.warn(`[settings] "${key}" is not valid JSON; using default`);
  }
  return fallback;
}

export async function setSetting(
  db: SQLiteDatabase,
  key: SettingKey,
  value: unknown
): Promise<void> {
  await db.runAsync(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value ?? null), nowIso()]
  );
  emit('settings:changed');
}

export async function deleteSetting(db: SQLiteDatabase, key: SettingKey): Promise<void> {
  await db.runAsync('DELETE FROM settings WHERE key = ?', [key]);
  emit('settings:changed');
}

/* Commonly used typed accessors ------------------------------------------- */

export const ProviderIdSchema = z.enum(['openai', 'anthropic', 'gemini', 'openrouter']);

export async function getStringSetting(
  db: SQLiteDatabase,
  key: SettingKey,
  fallback: string | null = null
): Promise<string | null> {
  return getSetting(db, key, z.string().nullable(), fallback);
}

export async function getBoolSetting(
  db: SQLiteDatabase,
  key: SettingKey,
  fallback: boolean
): Promise<boolean> {
  return getSetting(db, key, z.boolean(), fallback);
}

export async function getNumberSetting(
  db: SQLiteDatabase,
  key: SettingKey,
  fallback: number
): Promise<number> {
  return getSetting(db, key, z.number(), fallback);
}
