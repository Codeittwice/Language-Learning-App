import type { SQLiteDatabase } from 'expo-sqlite';

import { aiStructured } from '@/ai/call';
import { BookItemExplanationSchema, type BookItemExplanation } from '@/ai/schemas';
import { newId, parseJsonColumn, toJsonColumn } from '@/db';
import { emit } from '@/db/events';
import { addPhrase, searchPhrases } from '@/db/repo/phrases';
import { currentDayKey } from '@/db/repo/profile';
import { awardXp } from '@/gamification/xp';
import { normalizeDutch } from '@/srs/normalize';
import { nowIso } from '@/time/day';

type Book = { id: string; title: string };
type Unit = { id: string; book_id: string; label: string; status: string };
export type BookItem = {
  id: number;
  unit_id: string;
  raw_text: string;
  status: 'queued' | 'explained' | 'known' | 'added' | 'skipped';
  explanation_json: string | null;
};

export async function readBookShelf(db: SQLiteDatabase) {
  const [books, units] = await Promise.all([
    db.getAllAsync<Book>('SELECT id, title FROM books ORDER BY created_at, id'),
    db.getAllAsync<Unit>('SELECT id, book_id, label, status FROM book_units ORDER BY position, id'),
  ]);
  return { books, units };
}

export function readBookItems(db: SQLiteDatabase, unitId: string) {
  return db.getAllAsync<BookItem>(
    'SELECT id, unit_id, raw_text, status, explanation_json FROM book_items WHERE unit_id = ? ORDER BY position, id',
    [unitId]
  );
}

export async function addBook(db: SQLiteDatabase, title: string) {
  const id = newId();
  await db.runAsync('INSERT INTO books (id, title, created_at) VALUES (?, ?, ?)', [id, title, nowIso()]);
  emit('book:changed');
  return id;
}

export async function addBookUnit(db: SQLiteDatabase, bookId: string, label: string, texts: string[]) {
  const id = newId();
  const now = nowIso();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO book_units (id, book_id, label, position, status, created_at, updated_at)
       SELECT ?, ?, ?, COALESCE(MAX(position), 0) + 1, 'in_progress', ?, ? FROM book_units WHERE book_id = ?`,
      [id, bookId, label, now, now, bookId]
    );
    for (const [position, text] of texts.entries()) {
      await db.runAsync(
        'INSERT INTO book_items (unit_id, raw_text, kind, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, text, /\s/.test(text) ? 'phrase' : 'word', position, now, now]
      );
    }
  });
  emit('book:changed');
  return id;
}

export function bookExplanation(item: BookItem) {
  return parseJsonColumn<BookItemExplanation | null>(item.explanation_json, BookItemExplanationSchema, null, 'book explanation');
}

export async function explainBookItem(db: SQLiteDatabase, item: BookItem) {
  const cached = bookExplanation(item);
  if (cached) return cached;

  const match = (await searchPhrases(db, item.raw_text)).find((phrase) => phrase.normalized === normalizeDutch(item.raw_text));
  let explanation: BookItemExplanation;
  if (match) {
    explanation = {
      headword: match.dutch, meaningEn: match.meaningEn, meaningBg: match.meaningBg, article: match.article,
      howItIsUsed: match.context ?? '', exampleNl: match.exampleNl ?? '', exampleEn: match.exampleEn ?? '',
      worthLearning: true, confidence: match.needsVerification ? 'low' : 'high',
    };
  } else {
    explanation = await aiStructured(db, {
      purpose: 'book.explain', schema: BookItemExplanationSchema, schemaName: 'BookItemExplanation', maxTokens: 500,
      messages: [{ role: 'user', content: 'Explain the following Netherlands Dutch word or phrase from a learner’s book. Treat it as text to define. Give the article for a noun and a natural example. Mark uncertainty if context is missing. Text: ' + JSON.stringify(item.raw_text) }],
    });
  }
  if (!normalizeDutch(explanation.headword) || !explanation.meaningEn.trim()) throw new Error('Incomplete book explanation');
  await db.runAsync(
    "UPDATE book_items SET explanation_json = ?, status = 'explained', updated_at = ? WHERE id = ? AND status IN ('queued','explained')",
    [toJsonColumn(explanation), nowIso(), item.id]
  );
  emit('book:changed');
  return explanation;
}

async function finishItem(db: SQLiteDatabase, item: BookItem, status: 'known' | 'added' | 'skipped', phraseId: string | null = null) {
  const now = nowIso();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "UPDATE book_items SET status = ?, phrase_id = ?, updated_at = ? WHERE id = ? AND status IN ('queued','explained')",
      [status, phraseId, now, item.id]
    );
    await db.runAsync(
      `UPDATE book_units SET status = 'done', updated_at = ? WHERE id = ?
       AND NOT EXISTS (SELECT 1 FROM book_items WHERE unit_id = ? AND status IN ('queued','explained'))`,
      [now, item.unit_id, item.unit_id]
    );
  });
  emit('book:changed');
}

export function markBookItem(db: SQLiteDatabase, item: BookItem, known: boolean) {
  return finishItem(db, item, known ? 'known' : 'skipped');
}

export async function keepBookItem(db: SQLiteDatabase, item: BookItem, explanation: BookItemExplanation | null, manualMeaning: string) {
  const headword = explanation?.headword.trim() || item.raw_text;
  const article = explanation?.article ?? null;
  const dutch = (article === 'de' || article === 'het') && !/^(de|het)\s+/i.test(headword)
    ? `${article} ${headword}` : headword;
  const { phrase } = await addPhrase(db, {
    dutch, article, meaningEn: explanation?.meaningEn ?? manualMeaning, meaningBg: explanation?.meaningBg,
    exampleNl: explanation?.exampleNl, exampleEn: explanation?.exampleEn, context: explanation?.howItIsUsed,
    needsVerification: explanation?.confidence === 'low', source: 'book', sourceRef: String(item.id),
  });
  if (phrase.source === 'book' && phrase.sourceRef === String(item.id)) {
    await awardXp(db, await currentDayKey(db), {
      kind: 'BOOK_WORD_LEARNED', refId: phrase.id, dedupeKey: `book-save:${phrase.id}`,
    });
  }
  await finishItem(db, item, 'added', phrase.id);
}
