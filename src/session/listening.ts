import type { SQLiteDatabase } from 'expo-sqlite';
import { z } from 'zod';

import { aiStructured } from '@/ai/call';
import { tutorSystemPrompt } from '@/ai/prompts';
import { ListeningExerciseSchema, type ListeningExerciseOutput } from '@/ai/schemas';
import { parseJsonColumn, toJsonColumn } from '@/db';
import { currentDayKey, getProfile } from '@/db/repo/profile';
import type { Session } from '@/db/repo/sessions';
import { topicFor } from '@/session/rotation';
import { checkDutchVoice } from '@/speech/tts';
import { nowIso } from '@/time/day';

const savedSchema = z.object({
  exercise: ListeningExerciseSchema,
  step: z.number().int().min(0).max(6),
  answers: z.array(z.string()).max(3),
});

type AudioSource = 'tts' | 'text_only';
export type Listening = z.infer<typeof savedSchema> & { id: number; source: AudioSource };
type Row = { id: number; questions_json: string; audio_source: AudioSource };

const fallback: ListeningExerciseOutput = {
  passageNl: 'Gisteren was ik wat later bij de training. Mijn fiets had een lekke band, dus ik ben uiteindelijk met de bus gegaan. Toen ik aankwam, waren de anderen al aan het opwarmen. Ik dacht dat ik de eerste oefening had gemist, maar ze waren pas net begonnen. Na afloop vroeg Noor of ik zaterdag ook mee kon doen. Zaterdag lukt niet, want dan werk ik. We hebben afgesproken om zondag om drie uur bij de sporthal af te spreken. Noor zet het nog even in de groepsapp.',
  estSeconds: 45,
  gistAnswerEn: 'Someone arrives late to training and makes a plan with a teammate for Sunday.',
  questions: ['Waarom kwam de verteller later aan?', 'Wanneer en waar spreken ze af?'],
  questionAnswers: ['De fiets had een lekke band.', 'Zondag om drie uur bij de sporthal.'],
  hardChunks: ['een lekke band · a flat tyre', 'pas net begonnen · only just started', 'na afloop · afterwards'],
  shadowLines: ['Zaterdag lukt niet, want dan werk ik.', 'Noor zet het nog even in de groepsapp.'],
};

const localPassages: Record<number, ListeningExerciseOutput> = {
  2: {
    passageNl: 'Bij de training ging de eerste oefening helemaal niet goed. We riepen te weinig naar elkaar, waardoor twee spelers steeds naar dezelfde bal liepen. Onze trainer legde het spel even stil. Hij vroeg ons om duidelijk af te spreken wie de korte ballen pakt. De volgende ronde liep het meteen beter. We verloren nog steeds met twee punten verschil, maar iedereen bleef elkaar aanmoedigen. Volgende week willen we aan het begin dezelfde oefening nog eens doen, zodat we zien of de afspraak blijft werken.',
    estSeconds: 42, gistAnswerEn: 'A team improves by talking more clearly about who takes each ball.',
    questions: ['Waarom liepen twee spelers steeds naar dezelfde bal?', 'Wat wil het team volgende week opnieuw doen?'],
    questionAnswers: ['Ze riepen te weinig naar elkaar.', 'Dezelfde oefening aan het begin van de training.'],
    hardChunks: ['het spel stilleggen · to stop play', 'met twee punten verschil · by two points'],
    shadowLines: ['De volgende ronde liep het meteen beter.', 'Iedereen bleef elkaar aanmoedigen.'],
  },
  3: {
    passageNl: 'Zaterdag wilden we eigenlijk in het park afspreken, maar het gaat de hele middag regenen. Ik heb daarom in de groepsapp gevraagd of iedereen liever zondag komt. Mila moet zondag werken en stelt voor om zaterdag bij haar thuis te eten. Dat lijkt mij een goed idee. Ik kan brood en soep meenemen, en Sam regelt iets te drinken. We spreken rond zes uur af. Als het na het eten droog is, kunnen we alsnog even naar buiten. Anders blijven we gewoon binnen en spelen we een spelletje.',
    estSeconds: 45, gistAnswerEn: 'Friends change their outdoor plan because of rain and arrange dinner instead.',
    questions: ['Waarom komt zondag voor Mila niet uit?', 'Wie regelt iets te drinken?'],
    questionAnswers: ['Ze moet zondag werken.', 'Sam regelt iets te drinken.'],
    hardChunks: ['eigenlijk · originally, in this context', 'alsnog · after all'],
    shadowLines: ['Dat lijkt mij een goed idee.', 'Anders blijven we gewoon binnen.'],
  },
  4: {
    passageNl: 'Vanmorgen stond ik op het station met twee koffies. Eén was voor mij en één voor mijn collega. Toen de trein kwam, hield ik de deur open voor iemand die met een grote tas liep. Daarbij morste ik een halve beker over mijn mouw. Ik dacht dat mijn collega zou lachen, maar zij haalde meteen een doekje uit haar tas. Even later bleek dat ik ook nog op het verkeerde perron stond. Gelukkig vertrok onze trein pas vijf minuten later. We hebben het uiteindelijk allebei gehaald.',
    estSeconds: 44, gistAnswerEn: 'A small coffee accident and a wrong platform make for a chaotic morning.',
    questions: ['Hoe kwam de koffie op de mouw terecht?', 'Waarom konden ze hun trein toch nog halen?'],
    questionAnswers: ['De verteller hield de deur open en morste koffie.', 'Hun trein vertrok pas vijf minuten later.'],
    hardChunks: ['iets morsen · to spill something', 'even later bleek dat · a little later it turned out that'],
    shadowLines: ['Daarbij morste ik een halve beker over mijn mouw.', 'We hebben het uiteindelijk allebei gehaald.'],
  },
  5: {
    passageNl: 'Een vriend raadde me vorige week een film aan. Hij vond vooral het einde heel sterk. Ik vond het begin juist leuker, omdat je de personages daar rustig leert kennen. Tegen het einde gebeurde er voor mijn gevoel te veel tegelijk. Toen ik dat zei, vertelde mijn vriend dat hij precies van dat tempo houdt. We waren het dus niet met elkaar eens, maar ik begreep zijn punt wel. Voor onze volgende filmavond kiest hij een korte film, en daarna mag ik iets kiezen. Zo proberen we allebei eens iets anders.',
    estSeconds: 45, gistAnswerEn: 'Two friends like different parts of a film and agree to take turns choosing.',
    questions: ['Waarom vond de verteller het begin leuker?', 'Wie kiest de eerstvolgende film?'],
    questionAnswers: ['Je leert de personages daar rustig kennen.', 'De vriend kiest de volgende film.'],
    hardChunks: ['voor mijn gevoel · to me', 'het niet eens zijn · to disagree'],
    shadowLines: ['Ik begreep zijn punt wel.', 'Zo proberen we allebei eens iets anders.'],
  },
  6: {
    passageNl: 'In onze groepsapp vroeg iemand wie er na de training nog bleef hangen. Ik dacht eerst dat iedereen naar huis ging, want een paar mensen reageerden alleen met een duimpje. Toen vroeg ik of ze nou wel of niet meegingen. Noor stuurde terug dat ze al een tafel had gereserveerd. De duimpjes betekenden dus dat de anderen akkoord waren. Ik heb nog gevraagd of iemand met mij mee wilde fietsen. Uiteindelijk stonden we met z’n vieren bij de uitgang te wachten op de rest.',
    estSeconds: 41, gistAnswerEn: 'A group-chat reaction is ambiguous until someone checks what it means.',
    questions: ['Wat betekenden de duimpjes?', 'Wat had Noor al geregeld?'],
    questionAnswers: ['De anderen waren akkoord en gingen mee.', 'Ze had een tafel gereserveerd.'],
    hardChunks: ['blijven hangen · to stay around', 'met z’n vieren · as a group of four'],
    shadowLines: ['Ik dacht eerst dat iedereen naar huis ging.', 'Noor stuurde terug dat ze al een tafel had gereserveerd.'],
  },
  7: {
    passageNl: 'Ik kwam laatst iemand uit mijn oude team tegen bij de bakker. We hadden elkaar maanden niet gezien. Hij vroeg hoe het ging en ik vertelde over mijn nieuwe werk. Daarna vroeg hij of ik vrijdag mee wilde naar een wedstrijd. Ik hoorde eerst dinsdag, dus ik vroeg hem het nog eens te zeggen. Vrijdag kon ik wel, maar pas na zeven uur. We spraken af dat hij de kaartjes zou halen en mij later de precieze tijd zou sturen. Zo hadden we ineens weer iets leuks om samen te doen.',
    estSeconds: 45, gistAnswerEn: 'Two former teammates reconnect and clear up a misunderstanding while making plans.',
    questions: ['Welke dag dacht de verteller eerst te horen?', 'Wat zou de oud-teamgenoot nog sturen?'],
    questionAnswers: ['Dinsdag.', 'De precieze tijd van de wedstrijd.'],
    hardChunks: ['iemand tegenkomen · to run into someone', 'pas na zeven uur · only after seven'],
    shadowLines: ['Ik hoorde eerst dinsdag.', 'Vrijdag kon ik wel, maar pas na zeven uur.'],
  },
};

export async function loadListening(db: SQLiteDatabase, session: Session, signal: AbortSignal): Promise<Listening> {
  const row = await db.getFirstAsync<Row>(
    'SELECT id, questions_json, audio_source FROM listening_exercises WHERE session_id = ? ORDER BY id DESC LIMIT 1',
    [session.id]
  );
  const saved = parseJsonColumn<z.infer<typeof savedSchema> | null>(row?.questions_json, savedSchema, null, 'listening');
  if (row && saved) return { ...saved, id: row.id, source: row.audio_source };

  const topic = topicFor(session.sessionNumber);
  const profile = await getProfile(db);
  const voice = await checkDutchVoice();
  let exercise = localPassages[topic.day] ?? fallback;
  try {
    const generated = await aiStructured(db, {
      purpose: 'listening.passage', stage: 'listening', sessionId: session.id, signal,
      schema: ListeningExerciseSchema, schemaName: 'ListeningExercise', maxTokens: 900,
      messages: [
        { role: 'system', content: tutorSystemPrompt(profile, topic) },
        { role: 'user', content: 'Write a fictional 30–60 second spoken monologue for this topic. Use about 80–120 words, exactly two distinct Dutch detail questions and answers, up to three glossed chunks, and exactly two short lines to shadow. Keep the monologue free of speaker labels and translations.' },
      ],
    });
    if (generated.passageNl.trim() && generated.gistAnswerEn.trim()
      && [generated.questions, generated.questionAnswers, generated.shadowLines]
        .every((lines) => lines.length === 2 && lines.every((line) => line.trim()))) {
      exercise = generated;
    }
  } catch {
    // The bundled exercise has the same stages and remains usable offline.
  }
  signal.throwIfAborted();
  const source = voice.available ? 'tts' : 'text_only';
  const state = { exercise, step: 0, answers: [] };
  const day = await currentDayKey(db);
  const now = nowIso();
  signal.throwIfAborted();
  const { lastInsertRowId } = await db.runAsync(
    `INSERT INTO listening_exercises
      (session_id, passage_nl, audio_source, est_seconds, questions_json, hard_chunks_json, shadow_lines_json, day_key, created_at, transcript_revealed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [session.id, exercise.passageNl, source, exercise.estSeconds, toJsonColumn(state),
      toJsonColumn(exercise.hardChunks), toJsonColumn(exercise.shadowLines), day, now, source === 'text_only' ? now : null]
  );
  return { ...state, id: lastInsertRowId, source };
}

export async function saveListening(db: SQLiteDatabase, state: Listening, reveal: boolean) {
  const { exercise, step, answers, source, id } = state;
  await db.runAsync(
    `UPDATE listening_exercises SET questions_json = ?, audio_source = ?,
      gist_answer = ?, gist_feedback = ?,
      transcript_revealed_at = COALESCE(transcript_revealed_at, ?)
      WHERE id = ?`,
    [toJsonColumn({ exercise, step, answers }), source,
      answers[0] ?? null, answers.length ? exercise.gistAnswerEn : null, reveal ? nowIso() : null, id]
  );
}

export async function recordListeningPlay(db: SQLiteDatabase, id: number, slow: boolean) {
  await db.runAsync(
    'UPDATE listening_exercises SET play_count = play_count + 1, slow_play_count = slow_play_count + ? WHERE id = ?',
    [slow ? 1 : 0, id]
  );
}
