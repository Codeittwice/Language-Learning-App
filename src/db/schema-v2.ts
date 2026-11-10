import type { SQLiteDatabase } from 'expo-sqlite';

import { SETTING_KEYS } from '@/db/repo/settings';
import { nowIso } from '@/time/day';

export async function enablePhraseIndex(db: SQLiteDatabase) {
  const fts = await db.getFirstAsync<{ enabled: number }>(
    "SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled"
  );
  let available = false;
  if (fts?.enabled === 1) {
    // Some SQLite builds include FTS5 but lack the trigram tokenizer.
    try {
      await db.execAsync(`CREATE VIRTUAL TABLE IF NOT EXISTS phrases_fts USING fts5(
        normalized, meaning_en, meaning_bg, content='phrases', content_rowid='rowid', tokenize='trigram'
      );`);
      available = true;
    } catch (error) {
      if (!/no such (module|tokenizer)|unknown tokenizer/i.test(String(error))) throw error;
    }
  }
  if (available) {
    await db.execAsync(`
      CREATE TRIGGER IF NOT EXISTS phrases_fts_insert AFTER INSERT ON phrases BEGIN
        INSERT INTO phrases_fts (rowid, normalized, meaning_en, meaning_bg)
        VALUES (new.rowid, new.normalized, new.meaning_en, new.meaning_bg);
      END;
      CREATE TRIGGER IF NOT EXISTS phrases_fts_delete AFTER DELETE ON phrases BEGIN
        INSERT INTO phrases_fts (phrases_fts, rowid, normalized, meaning_en, meaning_bg)
        VALUES ('delete', old.rowid, old.normalized, old.meaning_en, old.meaning_bg);
      END;
      CREATE TRIGGER IF NOT EXISTS phrases_fts_update AFTER UPDATE OF normalized, meaning_en, meaning_bg ON phrases BEGIN
        INSERT INTO phrases_fts (phrases_fts, rowid, normalized, meaning_en, meaning_bg)
        VALUES ('delete', old.rowid, old.normalized, old.meaning_en, old.meaning_bg);
        INSERT INTO phrases_fts (rowid, normalized, meaning_en, meaning_bg)
        VALUES (new.rowid, new.normalized, new.meaning_en, new.meaning_bg);
      END;
      INSERT INTO phrases_fts (phrases_fts) VALUES ('rebuild');
    `);
  }
  await db.runAsync(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [SETTING_KEYS.fts5Available, JSON.stringify(available), nowIso()]
  );
}
