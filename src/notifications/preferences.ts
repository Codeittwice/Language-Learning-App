import type { SQLiteDatabase } from 'expo-sqlite';
import { z } from 'zod';

import { emit } from '@/db/events';
import { getSetting, SETTING_KEYS } from '@/db/repo/settings';
import { DEFAULT_REMINDER_HOUR, DEFAULT_REMINDER_MINUTE } from '@/notifications/constants';
import { nowIso } from '@/time/day';

const hourSchema = z.number().int().min(0).max(23);
const minuteSchema = z.number().int().min(0).max(59);

export async function readReminderTime(db: SQLiteDatabase) {
  const [hour, minute] = await Promise.all([
    getSetting(db, SETTING_KEYS.reminderHour, hourSchema, DEFAULT_REMINDER_HOUR),
    getSetting(db, SETTING_KEYS.reminderMinute, minuteSchema, DEFAULT_REMINDER_MINUTE),
  ]);
  return { hour, minute };
}

export function reminderTimeLabel(hour: number, minute: number): string {
  return [hour, minute].map((value) => String(value).padStart(2, '0')).join(':');
}

export function parseReminderTime(value: string) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

export async function writeReminderTime(db: SQLiteDatabase, hour: number, minute: number) {
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?), (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [SETTING_KEYS.reminderHour, String(hourSchema.parse(hour)), now,
      SETTING_KEYS.reminderMinute, String(minuteSchema.parse(minute)), now]
  );
  emit('settings:changed');
}
