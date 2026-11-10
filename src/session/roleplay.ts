import type { SQLiteDatabase } from 'expo-sqlite';

import { aiChat, aiStructured } from '@/ai/call';
import { tutorSystemPrompt } from '@/ai/prompts';
import { WritingFeedbackSchema, type WritingCorrection } from '@/ai/schemas';
import type { ConversationTurn } from '@/db/repo/messages';
import { currentDayKey, getProfile } from '@/db/repo/profile';
import type { Session } from '@/db/repo/sessions';
import { topicFor } from '@/session/rotation';
import { nowIso } from '@/time/day';

export const ROLEPLAY = 'topic_conversation';

const scenarios: Record<string, [string, string, string]> = {
  arrival: ['Hé, hoe laat ben je bij de training? Ik ben er om zeven uur.', 'De zaal gaat pas om half acht open. Wat spreken we af?', 'Volgende week begint de training een uur eerder. Hoe pak je het aan?'],
  training: ['Wat vond je van de training vandaag?', 'Ik vond die laatste oefening juist lastig. Wat zouden we kunnen veranderen?', 'We hebben volgende week een nieuwe speler. Wat zou jij voorstellen?'],
  plans: ['Zullen we zaterdag ergens wat eten?', 'Zaterdag lukt me toch niet. Heb je zondag tijd?', 'Ik kan zondag alleen in de ochtend. Wat spreken we af?'],
  stories: ['Hé, wat is het gekste dat je deze week is overkomen?', 'Wacht, ik snap het niet helemaal. Wat gebeurde er precies daarna?', 'Stel dat je dit in de groepsapp vertelt. Hoe begin je?'],
  opinions: ['Heb je nog een goede film gezien die je zou aanraden?', 'Ik hou eigenlijk helemaal niet van dat genre. Kun je me overtuigen?', 'We zijn met vier mensen en iedereen wil iets anders zien. Wat stel je voor?'],
  group_chat: ['Wie heeft er zin om na de training wat te drinken?', 'Ik bedoelde na de training van donderdag, niet vandaag. Lukt dat?', 'Iemand in de groep kent de plek nog niet. Hoe leg je het uit?'],
  review: ['Hé, ik ken je nog niet. Hoe heet je en wat doe je graag?', 'Gisteren liep mijn planning helemaal anders. Wat gebeurde er bij jou gisteren?', 'We wilden morgen afspreken, maar de plek is dicht. Wat stel je voor?'],
};

export function roleplayPrompt(session: Session, round: number): string {
  if (session.sessionNumber === 1) {
    const baseline = [
      'Hoi! Ik ben Noor. Hoe heet jij en wat doe je graag in je vrije tijd?',
      'Ik had gisteren een drukke dag. Wat heb jij gisteren gedaan?',
      'Heb je dit weekend tijd om iets samen te doen?',
    ];
    return baseline[round] ?? baseline[2]!;
  }
  const prompts = scenarios[topicFor(session.sessionNumber).key] ?? scenarios.arrival!;
  return prompts[round] ?? prompts[2];
}

export async function peerReply(db: SQLiteDatabase, session: Session, turns: ConversationTurn[], round: number,
  signal: AbortSignal, onCallLogged: (id: number) => void): Promise<string> {
  const topic = topicFor(session.sessionNumber);
  const profile = await getProfile(db);
  try {
    const reply = await aiChat(db, {
      purpose: 'roleplay.reply', stage: ROLEPLAY, sessionId: session.id, maxTokens: 120, signal, onCallLogged,
      messages: [
        { role: 'system', content: tutorSystemPrompt(profile, topic) },
        { role: 'system', content: 'You are a fictional peer in a role-play. React to the latest response in one short Dutch sentence. Do not correct, start another scenario, or ask a new question.' },
        ...turns.slice(-5, -1).map(({ role, text }) => ({ role, content: text })),
        { role: 'assistant', content: roleplayPrompt(session, round) },
        { role: 'user', content: turns.at(-1)?.text ?? '' },
      ],
    });
    if (reply.trim()) return reply.trim();
  } catch {
    signal.throwIfAborted();
  }
  return 'Oké, duidelijk!';
}

type CorrectionRow = WritingCorrection & { id: number; retryText: string | null };

export function readRoleplayCorrections(db: SQLiteDatabase, sessionId: string) {
  return db.getAllAsync<CorrectionRow>(
    `SELECT id, original, corrected, category, explanation, is_required AS isRequired, retry_text AS retryText
       FROM corrections WHERE session_id = ? AND stage = ? ORDER BY id LIMIT 2`, [sessionId, ROLEPLAY]
  );
}

export async function createRoleplayCorrections(db: SQLiteDatabase, session: Session, turns: ConversationTurn[], signal: AbortSignal) {
  const previous = await readRoleplayCorrections(db, session.id);
  if (previous.length) return previous;
  let corrections: WritingCorrection[];
  try {
    const feedback = await aiStructured(db, {
      purpose: 'roleplay.corrections', stage: ROLEPLAY, sessionId: session.id, maxTokens: 450, signal,
      schema: WritingFeedbackSchema, schemaName: 'RoleplayFeedback',
      messages: [{ role: 'user', content: 'Offer up to two concise, actionable corrections for these typed Dutch replies. Quote the learner exactly, preserve their meaning and mark optional improvements. Return zero when none are useful. Replies: ' + JSON.stringify(turns.filter((turn) => turn.role === 'user').map((turn) => turn.text)) }],
    });
    corrections = feedback.corrections.filter((correction) => correction.original.trim() && correction.corrected.trim()
      && turns.some((turn) => turn.role === 'user' && turn.text.includes(correction.original))).slice(0, 2);
  } catch {
    signal.throwIfAborted();
    return [];
  }
  const day = await currentDayKey(db);
  signal.throwIfAborted();
  await db.withTransactionAsync(async () => {
    for (const correction of corrections) {
      await db.runAsync(
        `INSERT INTO corrections (session_id, stage, original, corrected, category, explanation, is_required, day_key, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM corrections WHERE session_id = ? AND stage = ? AND original = ? AND corrected = ?)`,
        [session.id, ROLEPLAY, correction.original, correction.corrected, correction.category, correction.explanation,
          correction.isRequired ? 1 : 0, day, nowIso(), session.id, ROLEPLAY, correction.original, correction.corrected]
      );
    }
  });
  return readRoleplayCorrections(db, session.id);
}
