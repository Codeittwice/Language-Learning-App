/**
 * Zod schemas for every structured AI output.
 *
 * Two rules that are load-bearing, not stylistic:
 *
 * 1. **Flat and shallow.** No discriminated unions, no nested unions, at most one
 *    level of object nesting. Gemini and the smaller OpenRouter models degrade
 *    sharply with nesting, and nothing here needs it.
 * 2. **`.nullable()`, never `.optional()`.** Every field is always present, so
 *    OpenAI strict mode (which requires every property in `required`) needs no
 *    special casing and the model is never guessing whether to include a key.
 *
 * The AI only ever proposes. `src/srs/grading.ts` decides the recall status and the
 * FSRS grade, so nothing the model returns can violate the spec's invariants.
 */
import { z } from 'zod';

const shortText = z.string().max(400);
const line = z.string().max(200);

/* -------------------------------------------------------------------------- */
/* Recall                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Judgement of one recall attempt.
 *
 * Deliberately does NOT carry `status` or `learnerAnswer`, though the spec's sketch
 * does. We already hold the answer locally, so echoing it wastes tokens and risks the
 * model quietly rewriting it; and status is derived from `accepted` together with the
 * hint count and prompt kind, which is the only way the "a hint can never yield
 * independent" rule can be guaranteed.
 */
export const RecallEvaluationSchema = z.object({
  accepted: z
    .boolean()
    .describe('True if the answer conveys the target meaning in natural Dutch.'),
  quality: z
    .enum(['correct', 'minor_issue', 'wrong'])
    .describe(
      'correct = idiomatic and accurate; minor_issue = understandable with a small ' +
        'error; wrong = wrong meaning or not Dutch.'
    ),
  suggestedAnswer: line.describe('The natural Dutch phrasing a peer would use.'),
  explanation: shortText.describe(
    'At most two sentences of English, only if something is worth saying. Empty string otherwise.'
  ),
  alternatives: z
    .array(line)
    .max(4)
    .describe('Other natural answers that should also be accepted. May be empty.'),
  retryRecommended: z
    .boolean()
    .describe('True if the learner should try this phrase again straight away.'),
});
export type RecallEvaluation = z.infer<typeof RecallEvaluationSchema>;

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

export const CorrectionCategorySchema = z.enum([
  'grammar',
  'word_order',
  'vocabulary',
  'article',
  'preposition',
  'conjugation',
  'spelling',
  'naturalness',
]);

export const WritingCorrectionSchema = z.object({
  original: line.describe('The learner sentence or fragment, quoted exactly.'),
  corrected: line.describe('The corrected version, preserving their meaning and casual tone.'),
  category: CorrectionCategorySchema,
  explanation: shortText.describe('One short sentence of English explaining why.'),
  isRequired: z
    .boolean()
    .describe(
      'True for a real error (meaning-changing, recurring, or high-frequency structure). ' +
        'False for an optional naturalness suggestion.'
    ),
});
export type WritingCorrection = z.infer<typeof WritingCorrectionSchema>;

/** Spec section 8: at most two high-priority corrections per piece of writing. */
export const WritingFeedbackSchema = z.object({
  corrections: z.array(WritingCorrectionSchema).max(4),
  encouragement: line.describe(
    'One short, specific, non-inflated remark about what worked. Empty string if nothing stands out.'
  ),
});
export type WritingFeedback = z.infer<typeof WritingFeedbackSchema>;

/* -------------------------------------------------------------------------- */
/* Wrap-up                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * No `confidence` field: the spec allows a 1-5 confidence only when the learner
 * reports it themselves, so it is collected in the UI and never inferred.
 */
export const SessionSummarySchema = z.object({
  retrievalPrompts: z
    .array(line)
    .max(2)
    .describe('Two quick questions that make the learner retrieve something from today.'),
  realWorldChallenge: line.describe(
    'One small, concrete Dutch interaction to attempt before the next session.'
  ),
  recurringErrorNotes: z
    .array(line)
    .max(2)
    .describe('At most two recurring corrections worth repeating, each with a corrected example.'),
  speakingSuccess: line.describe('One concrete thing that went well. Empty string if unclear.'),
  speakingObstacle: line.describe('The clearest current obstacle. Empty string if unclear.'),
  nextSessionPriority: line.describe('What next session should focus on first.'),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

/* -------------------------------------------------------------------------- */
/* Dictionary                                                                  */
/* -------------------------------------------------------------------------- */

export const RegisterSchema = z.enum(['informal', 'neutral', 'formal', 'slang', 'vulgar']);

/**
 * `confidence` exists because models are confidently wrong about de/het more often
 * than you would like. A `low` value sets `needs_verification` on the saved phrase
 * and the UI offers a "correct me" affordance.
 */
export const DictionaryEntrySchema = z.object({
  dutch: line.describe('The Dutch headword or phrase, correctly spelled.'),
  wordClass: line.describe('noun, verb, adjective, adverb, expression, etc.'),
  article: z
    .enum(['de', 'het', 'de/het'])
    .nullable()
    .describe('For nouns only. Null for anything else. Every plural and diminutive takes de/het respectively.'),
  plural: line.nullable().describe('Plural form for nouns, else null.'),
  diminutive: line.nullable().describe('Diminutive for nouns, else null. Diminutives are always het-words.'),
  meaningEn: line.describe('Concise English meaning.'),
  meaningBg: line.nullable().describe('Concise Bulgarian meaning, or null if unsure.'),
  register: RegisterSchema,
  exampleNl: line.describe('One natural example sentence a peer would actually say.'),
  exampleEn: line.describe('English translation of the example.'),
  verbInfinitive: line.nullable(),
  verbPresent3sg: line.nullable(),
  verbPastSg: line.nullable(),
  verbPastPl: line.nullable(),
  verbParticiple: line.nullable(),
  verbAux: z.enum(['hebben', 'zijn', 'hebben/zijn']).nullable(),
  verbSeparable: z.boolean().nullable(),
  prepositions: z
    .array(line)
    .max(4)
    .describe('Prepositions this word takes, e.g. ["zin hebben in"]. May be empty.'),
  notes: shortText.describe(
    'Register, regionality or usage warnings. Empty string if there is nothing to flag.'
  ),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe('Your confidence in this entry, especially the article and verb forms.'),
});
export type DictionaryEntry = z.infer<typeof DictionaryEntrySchema>;

/* -------------------------------------------------------------------------- */
/* Book companion                                                              */
/* -------------------------------------------------------------------------- */

export const BookItemExplanationSchema = z.object({
  headword: line.describe('The item, normalised to its dictionary form.'),
  meaningEn: line,
  meaningBg: line.nullable(),
  article: z.enum(['de', 'het', 'de/het']).nullable(),
  howItIsUsed: shortText.describe('Two sentences at most: when and how a peer would use this.'),
  exampleNl: line,
  exampleEn: line,
  worthLearning: z
    .boolean()
    .describe('False for rare or bookish items the learner can safely skip for now.'),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type BookItemExplanation = z.infer<typeof BookItemExplanationSchema>;

/* -------------------------------------------------------------------------- */
/* Media                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `searchQuery`, never a URL. Models hallucinate YouTube video ids freely, and a link
 * to a dead or unrelated video reads as a broken app, so we only ever open a search.
 */
export const MediaSuggestionSchema = z.object({
  kind: z.enum(['youtube', 'series', 'film', 'podcast', 'music', 'news']),
  title: line.describe('The real title of a real thing. Do not invent titles.'),
  why: line.describe('One sentence tying it to what the learner has practised.'),
  searchQuery: line.describe(
    'A search query that will find it. Never a URL and never a video id.'
  ),
  platformHint: line.nullable().describe('Where it can usually be found, e.g. "NPO Start".'),
  difficulty: z.enum(['easier', 'on_level', 'stretch']),
});
export type MediaSuggestion = z.infer<typeof MediaSuggestionSchema>;

export const MediaSuggestionsSchema = z.object({
  suggestions: z.array(MediaSuggestionSchema).max(6),
});
export type MediaSuggestions = z.infer<typeof MediaSuggestionsSchema>;

/* -------------------------------------------------------------------------- */
/* Listening                                                                   */
/* -------------------------------------------------------------------------- */

export const ListeningExerciseSchema = z.object({
  passageNl: z
    .string()
    .max(1200)
    .describe('30-60 seconds of natural spoken Dutch on the topic. Label speakers if it is a dialogue.'),
  estSeconds: z.number().int().min(15).max(120),
  gistAnswerEn: line.describe('What the passage is about, in one English sentence.'),
  questions: z
    .array(line)
    .max(2)
    .describe('Exactly two detail or inference questions, in Dutch, asked one at a time.'),
  questionAnswers: z.array(line).max(2).describe('The expected answer to each question.'),
  hardChunks: z
    .array(line)
    .max(3)
    .describe('At most three difficult chunks from the passage, each with a short gloss.'),
  shadowLines: z
    .array(line)
    .max(2)
    .describe('Two short lines from the passage, good for imitating rhythm and stress.'),
});
export type ListeningExerciseOutput = z.infer<typeof ListeningExerciseSchema>;
