import type { SQLiteDatabase } from 'expo-sqlite';

import { type DictionaryEntry, DictionaryEntrySchema } from '@/ai/schemas';
import { parseJsonColumn, toJsonColumn } from '@/db';
import { addPhrase } from '@/db/repo/phrases';
import { currentDayKey } from '@/db/repo/profile';
import { awardXp } from '@/gamification/xp';
import { nowIso } from '@/time/day';

export type QueryLanguage = 'nl' | 'en' | 'bg';

export type CachedEntry = {
  id: number;
  entry: DictionaryEntry;
  savedPhraseId: string | null;
};

type EntryRow = { id: number; entry_json: string; saved_phrase_id: string | null };

function toEntry(row: EntryRow | null): CachedEntry | null {
  if (!row) return null;
  const entry = parseJsonColumn<DictionaryEntry | null>(
    row.entry_json, DictionaryEntrySchema, null, 'dictionary entry'
  );
  return entry ? { id: row.id, entry, savedPhraseId: row.saved_phrase_id } : null;
}

export function normalizeQuery(query: string): string {
  // Keep accents and leading pronouns. For example, "een" and "één" can be distinct lookups.
  return query.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function dictionaryHeadword(entry: DictionaryEntry): string {
  const dutch = entry.dutch.trim();
  if (entry.article !== 'de' && entry.article !== 'het') return dutch;
  // Models sometimes repeat the article in the headword despite the prompt.
  return `${entry.article} ${dutch.replace(/^(de|het)\s+/i, '')}`;
}

export async function readCachedEntry(
  db: SQLiteDatabase,
  normalized: string,
  language: QueryLanguage
): Promise<CachedEntry | null> {
  const row = await db.getFirstAsync<EntryRow>(
    `SELECT id, entry_json, saved_phrase_id FROM dictionary_entries
      WHERE normalized_query = ? AND query_lang = ?`,
    [normalized, language]
  );
  const cached = toEntry(row);
  if (cached) {
    // Lookup statistics are best-effort. An offline read can still succeed if this write fails.
    void db.runAsync(
      `UPDATE dictionary_entries SET lookup_count = lookup_count + 1, last_looked_up_at = ?
        WHERE id = ?`,
      [nowIso(), cached.id]
    ).catch(() => undefined);
  }
  return cached;
}

export async function cacheEntry(
  db: SQLiteDatabase,
  query: string,
  language: QueryLanguage,
  entry: DictionaryEntry
): Promise<CachedEntry> {
  const now = nowIso();
  const row = await db.getFirstAsync<EntryRow>(
    `INSERT INTO dictionary_entries (
       query, normalized_query, query_lang, entry_json, confidence, created_at, last_looked_up_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(normalized_query, query_lang) DO UPDATE SET
       entry_json = excluded.entry_json, confidence = excluded.confidence,
       lookup_count = lookup_count + 1, last_looked_up_at = excluded.last_looked_up_at
     RETURNING id, entry_json, saved_phrase_id`,
    [query, normalizeQuery(query), language, toJsonColumn(entry), entry.confidence, now, now]
  );
  const cached = toEntry(row);
  if (!cached) throw new Error('Dictionary entry did not round-trip');
  return cached;
}

/** Edit an uncertain lookup before adding it to the bank. Other details may still need checking. */
export async function correctEntry(
  db: SQLiteDatabase,
  cached: CachedEntry,
  fields: Pick<DictionaryEntry, 'article' | 'meaningEn' | 'plural' | 'verbPastSg' | 'verbParticiple'>
): Promise<CachedEntry> {
  const entry = DictionaryEntrySchema.parse({ ...cached.entry, ...fields });
  const result = await db.runAsync(
    `UPDATE dictionary_entries SET entry_json = ?
      WHERE id = ? AND saved_phrase_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM phrases WHERE source = 'dictionary' AND source_ref = ?)`,
    [toJsonColumn(entry), cached.id, String(cached.id)]
  );
  if (result.changes === 0) throw new Error('Dictionary entry was already saved');
  return { ...cached, entry };
}

export async function saveEntry(db: SQLiteDatabase, cached: CachedEntry): Promise<CachedEntry> {
  if (cached.savedPhraseId) return cached;

  const { entry } = cached;
  const sourceRef = String(cached.id);
  const { phrase } = await addPhrase(db, {
    ...entry,
    dutch: dictionaryHeadword(entry),
    context: entry.notes || null,
    source: 'dictionary',
    sourceRef,
    needsVerification: entry.confidence === 'low',
  });

  // Award only for a new card. Its source reference lets a retry finish the award if
  // the app closed after the insert. The XP key also covers retries after the award.
  if (phrase.source === 'dictionary' && phrase.sourceRef === sourceRef) {
    await awardXp(db, await currentDayKey(db), {
      kind: 'DICTIONARY_SAVE',
      refId: phrase.id,
      dedupeKey: `dictionary-save:${phrase.id}`,
    });
  }

  const result = await db.runAsync('UPDATE dictionary_entries SET saved_phrase_id = ? WHERE id = ?', [
    phrase.id, cached.id,
  ]);
  if (result.changes === 0) throw new Error('Dictionary entry was not linked');
  return { ...cached, savedPhraseId: phrase.id };
}
