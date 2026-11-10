import type { SQLiteDatabase } from 'expo-sqlite';

import { aiStructured } from '@/ai/call';
import { MediaSuggestionsSchema } from '@/ai/schemas';
import { toJsonColumn } from '@/db';
import { emit } from '@/db/events';
import { topicFor } from '@/session/rotation';
import { nowIso } from '@/time/day';

export type MediaIdea = {
  id: number;
  title: string;
  why: string;
  search_query: string;
  status: 'suggested' | 'saved' | 'opened' | 'watched' | 'dismissed';
};

export function readMediaIdeas(db: SQLiteDatabase, limit = 20) {
  return db.getAllAsync<MediaIdea>(
    `SELECT id, title, why, search_query, status FROM media_recommendations
      WHERE status <> 'dismissed' ORDER BY (status = 'saved') DESC, id DESC LIMIT ?`,
    [limit]
  );
}

export function youtubeSearch(query: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export async function generateMediaIdeas(db: SQLiteDatabase) {
  const session = await db.getFirstAsync<{ id: string; session_number: number }>(
    "SELECT id, session_number FROM sessions WHERE status = 'completed' AND kind = 'scheduled' ORDER BY session_number DESC LIMIT 1"
  );
  if (!session) return false;
  const existing = await db.getFirstAsync<{ found: number }>(
    'SELECT 1 AS found FROM media_recommendations WHERE generated_from_session = ? LIMIT 1',
    [session.id]
  );
  if (existing) return true;

  const phrases = await db.getAllAsync<{ id: string; dutch: string }>(
    `SELECT p.id, p.dutch FROM phrases p JOIN phrase_reviews r ON r.phrase_id = p.id
      WHERE r.session_id = ? AND r.status <> 'not_tested' GROUP BY p.id
      ORDER BY MAX(r.id) DESC LIMIT 8`, [session.id]
  );
  const topic = topicFor(session.session_number);
  const searches = ['aankomen bij sporttraining', 'teamsport training', 'weekend plannen maken',
    'grappig verhaal vertellen', 'mening geven over een film', 'gesprek in een groepsapp', 'informeel gesprek'];
  const fallback = [`Nederlands gesprek ${searches[topic.day - 1]}`];
  if (phrases[0]) fallback.push(`Nederlands in gesprek "${phrases[0].dutch}"`);
  let queries = fallback;
  try {
    const output = await aiStructured(db, {
      purpose: 'media.search', sessionId: session.id, schema: MediaSuggestionsSchema,
      schemaName: 'MediaSuggestions', maxTokens: 700,
      messages: [{ role: 'user', content: [
        'Suggest up to four Dutch YouTube search queries for a short authentic listening clip. No URLs, video ids, specific video titles or claims that a clip exists. Use general search phrases in searchQuery. Set kind to youtube and use the query as title.',
        `Covered topic: ${topic.conversation}`,
        `Actually reviewed phrases: ${JSON.stringify(phrases.map((phrase) => phrase.dutch))}`,
      ].join('\n') }],
    });
    const usable = output.suggestions.map((item) => item.searchQuery.trim())
      .filter((query) => query.length >= 5 && !/https?:|www\.|youtu\.be|watch\?v=/i.test(query));
    if (usable.length) queries = usable;
  } catch {
    // The local searches refer to the saved session and require no provider.
  }

  const now = nowIso();
  await db.withTransactionAsync(async () => {
    for (const query of new Set(queries)) {
      await db.runAsync(
        `INSERT INTO media_recommendations
         (kind, title, why, search_query, phrase_ids, topic_tags, generated_from_session, created_at, updated_at)
         SELECT 'youtube', ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM media_recommendations WHERE generated_from_session = ? AND search_query = ?)`,
        [query, `Listen for language from ${topic.label.toLowerCase()}.`, query,
          toJsonColumn(phrases.map((phrase) => phrase.id)), toJsonColumn(topic.tags), session.id, now, now, session.id, query]
      );
    }
  });
  emit('media:changed');
  return true;
}

export async function setMediaStatus(db: SQLiteDatabase, id: number, status: MediaIdea['status']) {
  await db.runAsync(
    `UPDATE media_recommendations SET status = CASE
       WHEN ? = 'opened' AND status IN ('saved','watched') THEN status ELSE ? END, updated_at = ? WHERE id = ?`,
    [status, status, nowIso(), id]
  );
  emit('media:changed');
}
