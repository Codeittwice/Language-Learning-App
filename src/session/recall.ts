/**
 * Building recall prompts and judging the answers.
 *
 * Prompts are generated locally from the phrase row rather than by a model: it is
 * instant, free, works offline, and there is nothing a model would add to "show the
 * English and ask for the Dutch".
 *
 * Judging goes local-first. A string match that succeeds costs nothing and returns
 * immediately; the model is only consulted when the answer does not match, because
 * that is the only case where it might still be a valid alternative. If the model is
 * unavailable the learner grades themselves, so no provider failure can ever block
 * practice.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { aiStructured } from '@/ai/call';
import { AiError } from '@/ai/errors';
import { phraseContext, recallEvaluationPrompt, tutorSystemPrompt } from '@/ai/prompts';
import { type RecallEvaluation, RecallEvaluationSchema } from '@/ai/schemas';
import type { Phrase } from '@/db/repo/phrases';
import type { LearnerProfile } from '@/db/repo/profile';
import type { RotationTopic } from '@/session/rotation';
import { buildCloze, matchesLocally } from '@/srs/normalize';
import type { PromptKind } from '@/types';

export type RecallPrompt = {
  phrase: Phrase;
  kind: PromptKind;
  /** What the learner is shown. */
  text: string;
  /** A short label above the prompt, e.g. "Say it in Dutch". */
  instruction: string;
  /** The phrase we are driving at. */
  target: string;
  /** Progressive hints; each one costs the learner `independent`. */
  hints: string[];
};

/** `geen zin hebben` -> `g___ z__ h_____` */
export function maskPhrase(target: string): string {
  return target
    .split(/\s+/)
    .map((word) => {
      if (word.length <= 1) return word;
      return word[0] + '_'.repeat(Math.max(1, word.length - 1));
    })
    .join(' ');
}

/**
 * Choose how to cue a phrase.
 *
 * Varies by how well it is known: a phrase seen many times gets a harder cue (a
 * situation to react to) while a new one gets the direct English-to-Dutch prompt.
 * `variant` rotates the choice so the same phrase is not always asked the same way.
 */
export function buildPrompt(phrase: Phrase, variant: number): RecallPrompt {
  const hints: string[] = [];

  // A cloze needs an example containing the phrase; not every row has one.
  const cloze = phrase.exampleNl ? buildCloze(phrase.exampleNl, phrase.dutch) : null;

  const canUseSituation = Boolean(phrase.context);
  const wellKnown = phrase.independentCount >= 2;

  let kind: PromptKind = 'en_to_nl';
  let text = phrase.meaningEn;
  let instruction = 'Say this in Dutch';

  if (cloze && variant % 3 === 1) {
    kind = 'cloze';
    text = cloze.prompt;
    instruction = 'Fill in the gap';
    hints.push(`It means: ${phrase.meaningEn}`);
    hints.push(`Starts like this: ${maskPhrase(cloze.answer)}`);
  } else if (canUseSituation && wellKnown && variant % 3 === 2) {
    kind = 'situation';
    text = phrase.context!;
    instruction = 'What would you say?';
    hints.push(`It means: ${phrase.meaningEn}`);
    hints.push(`Starts like this: ${maskPhrase(phrase.dutch)}`);
  } else {
    kind = 'en_to_nl';
    text = phrase.meaningEn;
    instruction = 'Say this in Dutch';
    if (phrase.context) hints.push(`Used when: ${phrase.context}`);
    hints.push(`Starts like this: ${maskPhrase(phrase.dutch)}`);
  }

  return {
    phrase,
    kind,
    text,
    instruction,
    target: kind === 'cloze' && cloze ? cloze.answer : phrase.dutch,
    hints,
  };
}

/** Build a round's worth of prompts, varying the cue per phrase. */
export function buildRound(phrases: readonly Phrase[], roundIndex: number): RecallPrompt[] {
  return phrases.map((phrase, index) => buildPrompt(phrase, roundIndex + index));
}

export type EvaluationOutcome = {
  accepted: boolean;
  /** Where the verdict came from, recorded on the review row. */
  gradedBy: 'ai' | 'local' | 'self';
  /** Null when no model was consulted. */
  aiAccepted: boolean | null;
  explanation: string;
  suggestedAnswer: string;
  alternatives: string[];
  retryRecommended: boolean;
  /** True when the model could not be reached and the learner must self-grade. */
  needsSelfGrade: boolean;
  /** Set when something went wrong, for an honest message in the UI. */
  error: string | null;
};

/**
 * Judge one answer.
 *
 * Local first: a match is free and instant. Only a non-match reaches the model, and
 * only because the answer may still be a natural alternative we do not have listed.
 */
export async function evaluateAnswer(
  db: SQLiteDatabase,
  input: {
    prompt: RecallPrompt;
    answer: string;
    profile: LearnerProfile;
    topic: RotationTopic;
    sessionId: string | null;
    signal?: AbortSignal;
  }
): Promise<EvaluationOutcome> {
  const { prompt, answer } = input;

  const local = matchesLocally(answer, prompt.target, [prompt.phrase.dutch]);
  if (local.accepted) {
    return {
      accepted: true,
      gradedBy: 'local',
      aiAccepted: null,
      explanation: local.exact ? '' : 'Close enough -- just a typo.',
      suggestedAnswer: prompt.target,
      alternatives: [],
      retryRecommended: false,
      needsSelfGrade: false,
      error: null,
    };
  }

  try {
    const evaluation = await aiStructured<RecallEvaluation>(db, {
      purpose: 'recall.evaluate',
      sessionId: input.sessionId ?? undefined,
      stage: 'recall',
      schema: RecallEvaluationSchema,
      schemaName: 'RecallEvaluation',
      temperature: 0,
      maxTokens: 400,
      signal: input.signal,
      messages: [
        { role: 'system', content: tutorSystemPrompt(input.profile, input.topic) },
        {
          role: 'user',
          content: [
            recallEvaluationPrompt({
              target: prompt.target,
              meaningEn: prompt.phrase.meaningEn,
              promptText: prompt.text,
              learnerAnswer: answer,
              context: prompt.phrase.context,
            }),
            phraseContext([prompt.phrase]),
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    });

    return {
      accepted: evaluation.accepted,
      gradedBy: 'ai',
      aiAccepted: evaluation.accepted,
      explanation: evaluation.explanation,
      suggestedAnswer: evaluation.suggestedAnswer || prompt.target,
      alternatives: evaluation.alternatives,
      retryRecommended: evaluation.retryRecommended,
      needsSelfGrade: false,
      error: null,
    };
  } catch (error) {
    // Every failure lands here: no key, offline, rate limited, or a model that could
    // not produce the schema. The learner grades it themselves and carries on.
    const message = error instanceof AiError ? error.userMessage : 'Could not reach the AI.';
    return {
      accepted: false,
      gradedBy: 'self',
      aiAccepted: null,
      explanation: '',
      suggestedAnswer: prompt.target,
      alternatives: [],
      retryRecommended: false,
      needsSelfGrade: true,
      error: message,
    };
  }
}
