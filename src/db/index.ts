/**
 * Shared helpers for the repository layer.
 *
 * SQLite has no boolean and no JSON type, so every repository converts at the
 * boundary. Doing it through these helpers rather than inline keeps the conversions
 * consistent and makes a malformed JSON column a logged warning instead of a crash
 * that takes a screen down.
 */
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { ZodType } from 'zod';

export { DATABASE_NAME } from '@/db/backup';

/** A fresh identifier for a row we create. */
export function newId(): string {
  return Crypto.randomUUID();
}

/** SQLite stores booleans as 0/1. */
export function toDb(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

/** Read a 0/1 column, tolerating null. */
export function fromDb(value: number | null | undefined): boolean {
  return value === 1;
}

/**
 * Parse a JSON text column against a schema, falling back rather than throwing.
 * A corrupt column should degrade one row, not break a list.
 */
export function parseJsonColumn<T>(
  raw: string | null | undefined,
  schema: ZodType<T>,
  fallback: T,
  context: string
): T {
  if (raw == null || raw === '') return fallback;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    console.warn(`[db] ${context}: column is not valid JSON, using fallback`);
    return fallback;
  }
  const result = schema.safeParse(decoded);
  if (!result.success) {
    console.warn(`[db] ${context}: JSON did not match schema, using fallback`);
    return fallback;
  }
  return result.data;
}

/** Serialise for a JSON text column. */
export function toJsonColumn(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** A string array column, the most common JSON shape in this schema. */
export function parseStringArray(raw: string | null | undefined): string[] {
  if (raw == null || raw === '') return [];
  try {
    const decoded: unknown = JSON.parse(raw);
    if (!Array.isArray(decoded)) return [];
    return decoded.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

/** `COUNT(*)`-style scalar query. */
export async function count(
  db: SQLiteDatabase,
  sql: string,
  args: readonly (string | number | null)[] = []
): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(sql, args as (string | number | null)[]);
  return row?.n ?? 0;
}

/**
 * Build a `?, ?, ?` placeholder list for an IN clause.
 * Never interpolate values into SQL; interpolate only the placeholders.
 */
export function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

/** True when an error is SQLite rejecting a UNIQUE or CHECK constraint. */
export function isConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /constraint|UNIQUE|CHECK/i.test(message);
}
