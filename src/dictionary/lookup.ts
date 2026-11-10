import type { SQLiteDatabase } from 'expo-sqlite';

import { aiStructured } from '@/ai/call';
import { dictionaryPrompt } from '@/ai/prompts';
import { DictionaryEntrySchema } from '@/ai/schemas';
import { cacheEntry, normalizeQuery, type QueryLanguage, readCachedEntry } from '@/db/repo/dictionary';
import { getProfile } from '@/db/repo/profile';
import { normalizeDutch } from '@/srs/normalize';

/** Read from SQLite before touching provider settings, keys or the network. */
export async function lookupDictionary(db: SQLiteDatabase, query: string, language: QueryLanguage) {
  const normalized = normalizeQuery(query);
  if (!normalized) throw new Error('A dictionary query is required');

  const cached = await readCachedEntry(db, normalized, language);
  if (cached) return cached;

  const { explanationLanguage } = await getProfile(db);
  const entry = await aiStructured(db, {
    purpose: 'dictionary',
    schema: DictionaryEntrySchema,
    schemaName: 'dictionary_entry',
    messages: [{ role: 'user', content: dictionaryPrompt(query.trim(), language, explanationLanguage) }],
  });
  if (!normalizeDutch(entry.dutch) || !entry.meaningEn.trim()) {
    throw new Error('The provider returned an incomplete dictionary entry');
  }
  return cacheEntry(db, query.trim(), language, entry);
}
