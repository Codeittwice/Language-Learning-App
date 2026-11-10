import type { SQLiteDatabase } from 'expo-sqlite';

import { newId } from '@/db';
import { nowIso } from '@/time/day';
import type { SessionStage } from '@/types';

export type ConversationTurn = { id: string; role: 'user' | 'assistant'; text: string };
type Thread = 'casual' | 'roleplay' | 'roleplay-retry';

export function readConversation(db: SQLiteDatabase, sessionId: string, thread: Thread) {
  return db.getAllAsync<ConversationTurn>(
    "SELECT id, role, content AS text FROM messages WHERE session_id = ? AND thread = ? AND role IN ('user','assistant') ORDER BY seq",
    [sessionId, thread]
  );
}

export async function appendTurn(db: SQLiteDatabase, sessionId: string, thread: Thread, stage: SessionStage,
  role: ConversationTurn['role'], text: string, callId: number | null = null): Promise<ConversationTurn> {
  const id = newId();
  await db.runAsync(
    `INSERT INTO messages (id, session_id, thread, stage, role, content, lang, input_mode, ai_call_id, seq, created_at)
     SELECT ?, ?, ?, ?, ?, ?, 'nl', ?, ?, COALESCE(MAX(seq), 0) + 1, ?
       FROM messages WHERE session_id = ? AND thread = ?`,
    [id, sessionId, thread, stage, role, text, role === 'user' ? 'typed' : null, callId, nowIso(), sessionId, thread]
  );
  return { id, role, text };
}
