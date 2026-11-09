# Dutch with Friends — Complete Claude Code App Specification

> **Purpose:** Build a practical AI-powered Dutch conversation learning app. This document combines the established rules from the Dutch Daily Practice project with proposed implementation details. Items labeled **Proposed** are engineering recommendations, not previously tested functionality.

## 1. Product vision and learner profile

Build **Dutch with Friends**, an AI Dutch conversation partner, listening trainer, writing coach, vocabulary review system, and progress tracker. Its primary goal is spontaneous, informal conversation with teammates and peers in the Netherlands—not textbook completion or formal test preparation.

Initial learner context:
- Native language: Bulgarian; default explanation language: English.
- Target: natural **Netherlands Dutch**, usually informal **jij/je**.
- Interests and scenarios: volleyball, training, teammates, sport, group chats, music, weekend plans, social life.
- Self-estimated comprehension: around 70% of familiar speech; unknown words disrupt comprehension.
- Main production difficulty: initiating speech and responding spontaneously.
- **Never infer a CEFR level** from the 70% estimate; receptive and productive skills can differ substantially.
- Standard session: 40 minutes; busy-day alternative: 20 minutes.

### Teaching principles

1. Communication before perfection; do not interrupt for every mistake.
2. Independent production before showing answers.
3. Useful sentence chunks before isolated words.
4. Natural Dutch in realistic contexts before textbook dialogues.
5. Recycle vocabulary across listening, writing, speaking, and later recall.
6. Target corrections to consequential or recurring errors.
7. Gradually reduce support and increase unpredictability.
8. Make the learner produce most of the language during speaking stages; do not invent measured speaking-time statistics.
9. Be friendly, concise, patient, and peer-like; avoid forced slang, exaggerated praise, and lectures.
10. Do not fabricate learning history, audio access, pronunciation judgments, timestamps, or saved progress.

## 2. Daily session workflow

### Standard session (40 minutes)

| Stage | Approx. time | Requirements |
|---|---:|---|
| Active recall | 5 min | Retrieve 6–8 due/weak phrases aloud from situational, meaning, or cloze cues; use two in new sentences. |
| Listening | 7 min | Hear 30–60 seconds without transcript; gist, second listen, two detail/inference questions, up to three difficult chunks, imitate two lines. |
| Writing | 5 min | Independently type 4–6 sentences or a short chat message; receive up to two priority corrections and rewrite. |
| Topic conversation | 13 min | Purposeful role-play, follow-up questions, misunderstanding repair, small complication, replay a challenging exchange with fewer hints. |
| Casual conversation | 8 min | Natural conversation with minimal correction. |
| Wrap-up | 2 min | Two retrieval prompts, one real-world challenge, cumulative progress log/checkpoint. |

**Busy-day session (20 minutes):** recall 3, listening 3, writing 2, topic conversation 5, casual conversation 5, wrap-up 2 minutes.

Timing is approximate unless the app has a real timer. Use exercise counts and natural transitions. Honor **Next** immediately. Never claim a timer/reminder is running if the app does not implement it.

### Start/resume rules

- On **Start today's session**, **Let's practise**, or **Continue**, load the latest persisted checkpoint and automatically begin or resume.
- **Start day N** explicitly overrides automatic selection.
- Briefly state session and topic, then **start with recall**, not a long plan.
- If no history exists for a genuinely new learner, start session 1 with a small baseline sample.
- If the user appears to be continuing but history is inaccessible, say so; never invent past sessions or silently reset.
- Save a compact checkpoint after each completed stage and a cumulative log at wrap-up.
- Missed calendar days do not advance session count or require catch-up sessions.
- An early departure leaves the session `in_progress`; resume from `next_stage` with an optional short recall warm-up.
- Complete a session only after planned stages and wrap-up, or when the learner explicitly counts a shortened session as completed.
- Increment completed sessions **exactly once** (idempotent completion).
- Returning after completion on the same day: offer **extra practice** or **next scheduled session**. Extra practice does not increment the counter.

## 3. Seven-session topic rotation

Session numbers represent **practice days**, not calendar weekdays.

| Rotation day | Conversation | Writing | Real-world challenge |
|---|---|---|---|
| 1 | Arriving at training/meeting peers, daily life and energy | Short arrival-time message | Start a Dutch exchange and ask one follow-up. |
| 2 | Training, matches, teamwork, what went well | Brief training recap | Express an opinion and ask a teammate's. |
| 3 | Weekend plans, invitations, arranging time/place | Invitation or reply | Ask about someone's plans. |
| 4 | Funny, annoying, surprising or unexpected stories | 4–6-sentence story | Tell a real story and invite a reaction. |
| 5 | Opinions on music, food, films, hobbies; polite disagreement | Recommendation with a reason | State and explain a preference. |
| 6 | Group chats, humor, reactions, encountered expressions | Reply to a fictional group chat | Try one expression after checking meaning and tone. |
| 7 | Unprepared mixed conversation and review | Rewrite an earlier text from memory | Have a Dutch exchange and note difficulty. |

On Day 1, briefly ask which sport the learner plays and which peer situations matter most; personalize without making it an interview. Establish a baseline through recall, a short self-introduction, yesterday's activities, and a plan with a follow-up question. Do not assign unsupported CEFR levels.

## 4. Four-week progression

| Week | In-app practice | Suggested real-world target |
|---|---|---|
| 1 | Familiar topics, short turns, hints, baseline | Initiate one Dutch exchange daily. |
| 2 | Longer answers, past events, follow-ups, fewer hints | Attempt a 2–3-minute conversation on most days. |
| 3 | Unexpected questions, disagreement, changed plans, misunderstanding repair | Join an ongoing conversation and contribute twice. |
| 4 | Mixed topics without advance preparation; repeat baseline tasks | Attempt a 5–10-minute peer conversation when possible. |

These are **adjustable practice targets**, not fluency promises. Repeat a week if needed. After week 4, reuse the rotation with fresh situations and persistent weaknesses.

## 5. AI tutor behavior

- Default to natural Netherlands Dutch and informal `jij/je` in peer contexts.
- Most conversational responses: **1–3 sentences**.
- Ask **one question at a time**; respond to what the learner actually says and sometimes make comments instead of constantly asking questions.
- Start at a comfortable pace; simplify wording before slowing speech unnaturally.
- If stuck: (1) simpler Dutch paraphrase, (2) small hint, (3) brief English explanation if needed, then return to Dutch.
- Allow thinking time when the learner says **even denken**; do not promise exact silence intervals without turn-taking controls.
- If the learner inserts an English word, briefly supply the Dutch equivalent and ask them to reuse it later.
- Do not present answer keys before the learner attempts the task.
- Explain grammar briefly only when useful for an observed mistake; return to conversation.
- Immediate correction only when meaning breaks down or requested; otherwise defer up to two useful corrections until a natural pause.
- Distinguish genuine mistakes from optional stylistic changes and preserve the learner's meaning and informal tone.
- Do not invent personal experiences. Fictional role-play is acceptable when clearly framed as such.
- Explain slang in context, including regionality, register, teasing, rudeness, and appropriateness; never imply slang is universally used.
- Pronunciation assessment requires accessible audio. Speech-to-text errors alone do not prove pronunciation errors. Prioritize intelligibility, rhythm, and stress over eliminating an accent.

## 6. Active recall and vocabulary

### Recall activity

- Test **6–8 due or weak phrases** per normal session; use situational cues, cloze prompts, or English meanings.
- Do **not** show Dutch answers before an attempt.
- Mix older topics with today's topic.
- Include two opportunities to use recalled phrases in novel sentences.
- Accept contextually correct natural alternatives; do not require string equality.
- Hint first when appropriate, then reveal and re-test if missed.

### Recall statuses

| Status | Meaning |
|---|---|
| `independent` | Correctly produced without hints. |
| `prompted` | Produced after assistance. |
| `missed` | Could not produce it. |
| `not_tested` | In bank but not assessed. |

Recognition alone **never** counts as independent production.

### Phrase bank

- Add at most **3–5 new target phrases** per standard session, fewer when existing phrases remain difficult.
- Prefer practical multiword chunks for peers.
- Store nouns with **de/het**; verbs with useful forms and prepositions; expressions with meaning, register, and a natural example.
- Reuse new phrases in listening, writing, topic conversation, and future recall.
- Store: ID, Dutch text, meaning(s), optional Bulgarian meaning, example, context, register, word class, article, verb forms, prepositions, introduction date/session, last review, next review, recall history, error history, source, confidence.

### Spaced repetition

- Adjustable starting intervals: **1 → 3 → 7 → 14 → 30 days**; not claimed uniquely optimal.
- Independent recall can lengthen the interval; prompted recall gets a shorter interval; missed items return later in the current session and next session.
- If actual dates are unknown, schedule by session numbers rather than fabricating dates.
- Persist **every** attempt and hint usage; review scheduling must be deterministic app logic, not only model memory.

### Example exercise formats

1. English → Dutch: “I'm running a little late.”
2. Situation: “Ask a teammate how their day was.”
3. Cloze: “Ik heb vandaag geen ____ om te trainen.”
4. Make an original sentence with `zin hebben in`.
5. Spoken situational cue → spoken Dutch response.

## 7. Listening comprehension

- Use a **30–60-second** natural Dutch passage or clearly labeled fictional dialogue on the daily topic.
- First pass: audio without transcript, translation, or vocabulary preview; ask for the **gist**.
- Second pass: replay, then ask **two** detail/inference questions **one at a time**.
- Afterwards explain **up to three** difficult chunks and replay/re-read relevant lines.
- Imitate **two short lines** for rhythm and stress (shadowing).
- Controls: Play, Replay, Slower, Show transcript, Repeat selected line, Highlight phrase.
- Hide transcript during initial listens if the app can; otherwise ask the learner to look away—never falsely claim it was hidden.
- Encourage authentic **30–60-second** Dutch-speaker clips **2–3 times per week**, chosen by the learner; AI speech cannot cover all real accents, overlap, and habits.
- Do not claim to have heard inaccessible external audio. If only transcript is available, label activity text-based.
- Never invent clips, quotations, or interpretations of incomplete phrases; request context or mark uncertainty.

## 8. Writing practice

- Learner **types** 4–6 sentences, a short story, or a realistic group-chat message independently.
- Do not count speech dictation as writing.
- Do not supply a translation before the first attempt.
- Return at most **two high-priority corrections**, favoring meaning-changing, recurring, or high-frequency structure errors.
- Show original sentence, suggested correction, brief explanation, and a learner rewrite field.
- Preserve intent and casual tone; distinguish errors from optional naturalness suggestions.
- Error categories: grammar, word order, vocabulary, article, preposition, conjugation, spelling, naturalness.

## 9. Topic role-play and conversational skills

- Role-plays must have a real purpose: arrange plans, explain an event, respond to a teammate, express an opinion, or navigate a social interaction.
- Begin supported; introduce a small complication once comfortable (e.g., someone cannot make Saturday and proposes Sunday).
- Practice **initiating**, **asking follow-ups**, **joining ongoing conversations**, **expressing opinions**, **disagreeing politely**, **buying thinking time**, and **repairing misunderstandings**.
- After several exchanges, optionally present up to two corrections: learner phrase → natural alternative → short reason; let learner retry.
- Repeat a challenging **1–2-minute** exchange with changed details and fewer hints.
- Useful phrases to teach in context: `Hoe was je dag?`, `Echt? Hoezo?`, `Volgens mij...`, `Ja, maar ik denk dat...`, `Wat bedoel je precies?`, `Kun je dat nog een keer zeggen?`, `Even denken...`, `Waar hebben jullie het over?`.

## 10. Casual conversation / Friend Mode

- Approx. eight minutes in standard session.
- Drop quiz framing; follow interests and allow topic shifts.
- Keep responses short and peer-like; do not turn each response into a question.
- Correct only when communication fails; save one or two useful observations for wrap-up.
- Clearly distinguish role-play from claims about the AI's own experiences.

## 11. User commands and UI equivalents

| User command | Behavior |
|---|---|
| `Start today's session` / `Let's practise` / `Continue` | Start/resume current scheduled session. |
| `Start day N` | Explicitly override day selection. |
| `Nog een keer` | Repeat last line. |
| `Langzamer` | Repeat more slowly, preserving natural phrasing. |
| `Simpeler` | Rephrase in easier Dutch. |
| `Hint` | Small clue, not full answer. |
| `English` | Brief English explanation, then Dutch. |
| `Hoe zeg je …?` | Natural Dutch equivalent, then continue. |
| `Next` | Advance/skip current stage immediately. |
| `Friend mode` | Enter casual conversation with minimal correction. |
| `Wrap up` | End practice and generate text log/checkpoint. |

**Proposed:** expose buttons for Repeat, Slower, Simpler, Hint, English, Next, microphone, typing, and transcript; accept both voice and typed commands.

## 12. State, progression, and persistence

```ts
type SessionStage =
  | 'recall' | 'listening' | 'writing'
  | 'topic_conversation' | 'casual_conversation' | 'wrap_up';

interface SessionState {
  completedSessions: number;
  activeSession: number;
  week: number;
  rotationDay: number;
  status: 'in_progress' | 'completed';
  completedStages: SessionStage[];
  nextStage: SessionStage | null;
  durationMode: 'standard' | 'short';
  startedAt?: string;
  completedAt?: string;
}

const week = Math.floor((sessionNumber - 1) / 7) + 1;
const rotationDay = ((sessionNumber - 1) % 7) + 1;
```

- `completedSessions` counts **completed scheduled sessions**, never calendar days.
- For a genuinely new learner: `completedSessions=0`, `activeSession=1`.
- Preserve checkpoints at each stage; a wrap-up log is automatic.
- Resolve duplicate checkpoints by order and completion status; if contradictory, report uncertainty rather than guess.
- Store progress in a database in the app. Original ChatGPT workflow used cumulative **conversation-message checkpoints**; those are not guaranteed writes to project files.
- Save stage completion and session completion transactionally/idempotently; never mark unfinished stages completed.
- If persistence fails, show the error; never claim success.

## 13. Session log and weekly review

At each wrap-up:
1. Ask **two quick retrieval prompts**.
2. Assign **one small real-world Dutch interaction**.
3. Summarize up to two useful recurring corrections.
4. Save and display a **cumulative log** (do not read a large table aloud).

Log fields:
- Session/date if known; completed sessions; active session; week; rotation day; status; completed stages; next stage/topic.
- **Complete cumulative phrase bank**, including older items: Dutch, meaning/use, independent/prompted/missed/not-tested, last tested, next review.
- Two recurring errors with corrected examples.
- Listening gist/details and lines requiring replay.
- One concrete speaking success and current obstacle.
- Confidence 1–5 **only if learner reports it**.
- Real-world challenge and result, if known.
- Next-session priority.

At Day 7, use familiar but unrehearsed tasks to evaluate recall, gist, storytelling, follow-ups, and repair. Compare with baseline using concrete examples; ask for self-rated confidence (1–5). Never invent precise scores.

Ask about the previous real-world challenge next session without treating non-completion as failure. Suggested reporting options: completed, attempted, not attempted, prefer not to say.

## 14. Voice and pronunciation

**Core requirement:** support Dutch audio listening and spoken conversation when the chosen providers allow it. Voice availability and capabilities vary by platform; verify them.

**Proposed implementation:**
- Speech-to-text, text-to-speech, conversational turn-taking, replay, speed adjustment, and switchable text input.
- Netherlands Dutch voice, relaxed and natural; audition actual available voices using the same Dutch sample.
- Audio-based pronunciation observations focused on intelligibility, stress, and rhythm, with explicit uncertainty.
- Do not diagnose pronunciation from transcript alone or treat ASR mistakes as conclusive.
- Original ChatGPT voice suggestions were Arbor, Sol, and Spruce; **do not assume** other APIs expose these voices.
- Audio processing must have graceful text-based fallback when unavailable.

## 15. Proposed user interface

### Dashboard
- Today's session number, topic, duration, **Start/Resume**.
- Due expressions, learned expressions, difficult expressions.
- Completed sessions and practice history.
- Current real-world challenge.

### Session screen
- Stage indicator, optional real timer, exercise content, AI dialogue, microphone and text entry.
- Contextual controls: Repeat, Slower, Simpler, Hint, English, Next, transcript.
- Separate typed writing editor; prevent dictated speech being silently counted as writing.

### Vocabulary library
- Search/filter by topic, register, review status, and difficulty.
- Example sentences, audio pronunciation, next review, immediate practice, **Save Phrase** from conversation.

### Progress screen
- Completed sessions, recall status distribution, listening observations, recurring error categories, confidence trend (self-reported), real-world attempts.
- No invented fluency percentages or precision.

### Proposed extras
- Quick Practice (5-minute recall, listening, writing, pronunciation, or chat) without scheduled-session advancement.
- Custom role-plays for upcoming situations.
- Conversation replay with corrections and alternatives.
- Import phrases heard in real life, with uncertainty if incomplete.
- Optional notifications/reminders **only if actually implemented**.

## 16. Proposed technical architecture

Suggested stack (adjust after inspecting the repository):

| Layer | Candidate |
|---|---|
| Frontend | Next.js, React, TypeScript |
| Styling | Tailwind CSS |
| Database | PostgreSQL |
| Auth | Supabase Auth or equivalent |
| AI | Configurable LLM provider |
| STT/TTS | Providers with verified Netherlands Dutch support |
| Storage | Secure object storage for optional audio |
| Validation | Zod |
| Deployment | Vercel or equivalent |

Separate **deterministic application logic** from **AI language reasoning**:
- App: session numbering, stage completion, scheduling, persistence, user settings, analytics.
- AI: conversation, role-play, examples, contextual evaluation, selective corrections, explanations.
- Audio services: playback, synthesis, transcription, and any supported pronunciation signals.
- Never use the LLM's conversational memory as the only durable state.

Suggested modules:

```text
app/
  authentication/
  learner-profile/
  session-manager/
    schedule/
    stages/
    checkpoints/
  ai-tutor/
    conversation/
    roleplay/
    corrections/
    difficulty/
  vocabulary/
    phrase-bank/
    recall/
    spaced-repetition/
  listening/
    passages/
    audio/
    comprehension/
  writing/
  voice/
  progress/
  settings/
```

## 17. Proposed data model

Tables/entities:

1. `users`: account and authentication reference.
2. `learner_profiles`: languages, interests, goals, confidence, session duration, voice preferences.
3. `sessions`: session number, week/day, topic, duration mode, status, timestamps.
4. `session_stages`: stage, order, completion, results, timestamps.
5. `vocabulary_items`: phrase text, meaning, grammar metadata, examples, register, source.
6. `vocabulary_reviews`: every attempt, learner answer, hint usage, recall status, review date, next review.
7. `conversation_messages`: speaker, text, stage, timestamps, optional audio reference.
8. `corrections`: original, suggested, category, explanation, retry success.
9. `listening_exercises`: passage, audio, transcript, questions, expected answers, learner answers.
10. `writing_exercises`: prompt, typed original, corrections, independent revision.
11. `real_world_challenges`: assigned action, status, learner-reported result.
12. `session_checkpoints`: stage progress and version/sequence for reliable recovery.

### Structured AI outputs (examples)

```ts
interface RecallEvaluation {
  accepted: boolean;
  status: 'independent' | 'prompted' | 'missed';
  learnerAnswer: string;
  suggestedAnswer: string;
  explanation?: string;
  alternativeAnswers?: string[];
  retryRecommended: boolean;
}

interface WritingCorrection {
  original: string;
  corrected: string;
  category:
    | 'grammar' | 'word_order' | 'vocabulary' | 'article'
    | 'preposition' | 'conjugation' | 'spelling' | 'naturalness';
  explanation: string;
  isRequiredCorrection: boolean;
}

interface SessionSummary {
  sessionId: string;
  completed: boolean;
  newPhrases: string[];
  reviewedPhrases: string[];
  recurringErrors: WritingCorrection[];
  listeningObservations: string[];
  speakingSuccess?: string;
  speakingObstacle?: string;
  confidence?: number;
  nextSessionPriority: string;
}
```

Validate AI outputs; ensure status `independent` is impossible if a hint was used, and do not equate recognition with production.

## 18. Adaptive difficulty

Use observed signals: independent recall, hints, follow-up questions, listening gist/details, response coherence, recurring errors, recovery from misunderstanding, and self-rated confidence.

**Increase challenge** when performance supports it: longer turns, natural speed, less predictable prompts, fewer hints, varied vocabulary.

**Reduce challenge** when needed: simpler words, familiar situations, contextual clues, shorter turns, more review, optional slower playback.

Hesitation alone is not evidence of low ability. Never invent a formal language level or precise improvement score.

## 19. Privacy, safety, and reliability (proposed)

- Explicit permission for microphone/audio recording.
- Clear retention policy and deletion options for recordings and account data.
- Secure API keys and server-side secrets; access controls for personal learning data.
- Graceful fallback for AI, STT, TTS, or database errors.
- No false claims that files, checkpoints, or recordings were saved.
- No fabricated audio analysis, external content access, or measurements.

## 20. Acceptance tests

| Scenario | Expected behavior |
|---|---|
| New user starts | Session 1 baseline recall begins. |
| Session completed | Counter increases once. |
| App closes mid-stage | Persisted progress resumes correctly. |
| Three calendar days pass | No sessions skipped. |
| User says Next | Immediately advances/skips as requested. |
| User requests Hint | Small clue, answer not revealed. |
| Independent correct answer | Stored as independent. |
| Correct after hint | Stored as prompted. |
| Missed phrase | Scheduled for near-term review. |
| User writes | At most two priority corrections; revision required. |
| Friend Mode | Natural chat, minimal interruptions. |
| User asks English | Brief explanation, then Dutch resumes. |
| Day 7 | Mixed review and self-rated confidence prompt. |
| Extra practice after completion | No automatic session increment. |
| Save phrase | Phrase persists after refresh. |
| Pronunciation request without audio | No fabricated judgment. |
| TTS/STT failure | Honest error and usable fallback. |
| Database write fails | App does not claim data was saved. |
| Conflicting checkpoints | State uncertainty; don't guess. |
| No accessible prior history | Do not fabricate or silently reset continuing learner. |

## 21. Implementation phases

**Phase 1 — Core:** profile, persistent session state, seven-day rotation, text AI tutor, recall, writing, role-play, Friend Mode, phrase bank, wrap-up log.

**Phase 2 — Audio:** Netherlands Dutch STT/TTS, listening passages, transcript reveal, replay/speed, voice conversation, audio fallbacks.

**Phase 3 — Adaptive:** spaced repetition, detailed error tracking, difficulty adjustment, progress dashboard, personalized review.

**Phase 4 — Enhancements:** custom role-play, imported phrases, conversation replay, reliable pronunciation analysis if supported, mobile polish, optional reminders.

## 22. Claude Code implementation brief

**Build a functioning app, not a mockup.** Inspect the repository first; identify platform, infrastructure, API availability, and constraints. Propose a concise architecture and build plan. Implement durable state and core learning workflows before advanced voice features.

The learner should be able to open the app, press **Start Today's Session**, and immediately practice Dutch. The app must handle progression and reviews automatically, remain conversational and selective with corrections, preserve history, and make useful real-world speaking practice easier.

The AI is the **language partner and contextual evaluator**; application code is the **source of truth for session progression, review scheduling, and persisted progress**. Verify actual provider capabilities, never invent integrations, and test resume/idempotency and evaluation rules.

### Definition of success

A learner can consistently practice spontaneous Netherlands Dutch, recall useful phrases, understand short spoken passages, type and revise short messages, practice real social interactions, and resume progress without manually managing session numbers or review schedules.

---

## Provenance and scope

**Established project rules** are grounded in the original `Dutch_Daily_Practice-2.md` instructions, including session timing, weekly rotation, four-week progression, tutoring behavior, vocabulary/review rules, listening/writing/conversation structure, commands, and checkpoint semantics.

**Proposed implementation** includes the database, UI, software stack, API architecture, extra features, privacy controls, structured data models, and acceptance tests. These are design recommendations, not evidence of an already-built or tested app.
