# Handoff: finishing Dutch with Friends

You are picking up a half-built app. This document tells you what exists, what does
not, which rules must not be broken, and what to build next in what order.

Read [`docs/spec.md`](docs/spec.md) before writing anything. It is the owner's own
teaching design and it is the source of truth for *how* to teach. Where this codebase
and the spec appear to disagree, the deviations are listed in "Deliberate deviations"
below — those are decided, not accidental. Anything else is a bug.

Read [`README.md`](README.md) too; it covers the architecture and the reasoning.

---

## The one-sentence version

A single-user Expo/React Native app that teaches spontaneous Dutch through short daily
practice, reminds you to show up, runs entirely on-device against your own AI API key,
and never lets a provider failure dead-end a session.

The owner's previous ChatGPT routine worked but died because nothing reminded him to
practise. **The daily reminder is the feature the product rests on.** Treat anything
that weakens it as a serious regression.

---

## Current state

Working end to end:

- SQLite schema v1 (17 tables) with append-only migrations and a pre-upgrade backup.
- Four AI providers (OpenAI, Anthropic, Gemini, OpenRouter) behind one interface, with
  key validation, live model listing and per-call cost logging.
- A practice session: **recall → writing → Friend Mode → wrap-up**, resumable across
  sittings, idempotent completion, checkpoints at every step.
- FSRS scheduling, XP, daily goal, streak with freezes.
- The daily reminder: a rolling 14-day window of individual notifications with 25
  rotating copy templates.
- Today tab, AI settings screen, Dutch TTS, 60 seed phrases.

Verification, all currently clean:

```bash
npm run typecheck && npm test && npx eslint src --max-warnings 0
```

```bash
npx expo export --platform android
```

142 tests pass. Run all four before and after every change — the tests are the only
thing standing between you and silently corrupting someone's learning history.

### Not built yet

| Area | State |
|---|---|
| Listening stage | Zod schema + prompt exist; no screen, not in any plan |
| Topic role-play stage | Not in any plan; no screen |
| Dictionary tab | Table, schema, prompt and repo search exist; UI is a placeholder |
| Book companion | Tables and schema exist; UI is a placeholder |
| Progress tab | `masteryCounts`, `xpHistory`, `challengeHistory` exist; UI is a placeholder |
| Media suggestions | Table and schema exist; nothing generates or shows them |
| Settings beyond AI | Reminders, voice, profile, data export — all unbuilt |
| Onboarding | `learner_profile.sport` / `.interests` / `.onboarded_at` are never set |
| Achievements | Table exists, no logic |
| Day 7 review | Rotation day 7 exists; no special flow |
| FTS5 search | Migration v2 not written; `searchPhrases` uses LIKE |
| Export | No JSON/Markdown export |

---

## Rules that must not be broken

These are not style preferences. Each one is load-bearing, and most protect against a
failure that is silent rather than loud.

**1. Never compute a day key in SQL.** SQLite's `date('now')` is UTC, so at 01:00
Amsterdam time it returns *yesterday*. Every `day_key` comes from `src/time/day.ts`. A
learning day runs 04:00 → 04:00 so a late-night session counts for the day before.
Treat a `'now'` inside a SQL string as a bug.

**2. `PRAGMA foreign_keys = ON` is per connection and outside any transaction.** Inside
a transaction it silently does nothing and every `REFERENCES` clause becomes
decoration. It is already set in `migrate()`; do not move it.

**3. Migrations are append-only.** Once a migration has run on the owner's phone, its
`up` is frozen forever. Editing it makes his device and a fresh install diverge with no
way to detect the difference. Add migration v2; never touch v1.

**4. A hint can never yield `independent`, and recognition is never production.** This
is enforced in three places: CHECK constraints on `phrase_reviews`, `deriveStatus` in
`src/srs/grading.ts`, and an exhaustive unit test. Keep all three.

**5. Dictation is never writing.** `writing_exercises.input_mode` has a CHECK pinning it
to `'typed'`. If you add speech-to-text, it must not write through that table.

**6. Every structured AI call needs a deterministic local fallback.** Recall falls back
to string matching and then self-grading; writing keeps the learner's text and shows
raw feedback; wrap-up builds its summary from SQLite. This is also the offline path and
the rate-limited path. A model that cannot follow a schema must never leave the learner
at a dead end.

**7. Persist the learner's input before the AI call, never after.** A 429 eating four
sentences they just wrote is the most trust-destroying bug this app can have. See
`src/app/session/[id]/writing.tsx` for the pattern.

**8. Notification copy may only state things that are true.** Every template that
mentions a streak, a due count, a phrase or a challenge is gated on that value actually
existing, and tests assert it. Never add a template that interpolates something
unverified. Never use the words "time to practice".

**9. Every notification route must exist.** A reminder that cannot navigate is worse
than no reminder. `src/notifications/__tests__/copy.test.ts` has a test pinning the
allowed routes — extend it when you add one.

**10. Create Android channels before requesting notification permission.** On Android
13+ the OS dialog does not appear until a channel exists, so the other order yields a
silent `denied` that reproduces on a real phone and nowhere else. The ordering is
encoded in `requestReminderPermission`; do not call `requestPermissionsAsync` directly.

**11. Never log or persist an API key.** Keys live only in SecureStore. The UI sees
`hasKey()` and `maskKey()`. Everything reaching `console` or `ai_calls.error_message`
goes through `redact()`. Gemini is authenticated by header, never `?key=`, so no secret
reaches a URL.

**12. Never invent a price, a model name, or a YouTube link.** Costs are shown only
where the provider publishes them (today: OpenRouter alone). Models are discovered
live and filtered by pattern, never hardcoded. Media stores a `search_query`, never a
URL — models hallucinate video ids freely.

**13. No `Math.random()` during render.** The React Compiler is enabled and will reject
it. See `scatter()` in `src/ui/celebrate.tsx` for the deterministic alternative.

**14. Keep AI output schemas flat, and use `.nullable()` not `.optional()`.** Gemini and
smaller OpenRouter models degrade sharply with nesting, and all-required-but-nullable
means OpenAI strict mode needs no special casing.

---

## Deliberate deviations from the spec

Do not "fix" these.

- **FSRS instead of the spec's 1→3→7→14→30 ladder.** The spec calls its own ladder "not
  claimed uniquely optimal"; FSRS tracks per-item difficulty and reaches the same
  retention with fewer reviews.
- **The streak is decoupled from session completion.** `completedSessions` counts
  finished scheduled sessions and drives the rotation; the streak counts days where the
  XP goal was met, earnable by any practice. This is the fix for why the previous
  routine died: when the only unit of success is a 40-minute session, a busy day is a
  zero, and a zero breaks the chain.
- **A session is divided into rounds and is resumable across sittings.** The spec never
  said a session must be finished in one sitting, only that it must be finished
  correctly.
- **`RecallEvaluation` carries no `status` or `learnerAnswer` field.** We hold the answer
  already, and status is derived locally so the invariants cannot be violated.
- **Listening and role-play are absent from every plan.** A four-stage session that works
  beats a six-stage session that half-works. `planFor()` in `src/session/plan.ts` is
  where they go back in.
- **No Vercel AI SDK.** Its Expo guide exists to keep keys server-side, which is the one
  problem a bring-your-own-key app does not have.

---

## What to build, in order

Each task lists where it goes and what "done" means. Most of the groundwork — tables,
schemas, prompts, repository functions — already exists; check before writing new ones.

### 1. Dictionary tab (highest value, lowest risk)

Everything except the screen exists.

- Use: `DictionaryEntrySchema` and `dictionaryPrompt` (`src/ai/schemas`, `src/ai/prompts`),
  `aiStructured` (`src/ai/call.ts`), `addPhrase` and `searchPhrases`
  (`src/db/repo/phrases.ts`), the `dictionary_entries` table.
- Replace the placeholder in `src/app/(tabs)/dictionary.tsx`.
- Cache every lookup in `dictionary_entries` keyed on
  `(normalized_query, query_lang)`; a cache hit must render instantly and offline.
- Show article, plural, verb forms, register, example, a `SpeakButton`, and
  **Add to phrase bank**. Award `XP.DICTIONARY_SAVE` on save.
- When `confidence` is `low`, set `needs_verification` on the saved phrase and show a
  "correct me" affordance. Models are confidently wrong about de/het more often than
  you would like.
- Below the search, list the whole bank with a `FlashList` and filters.
- **Done when:** a word looked up once opens instantly in airplane mode.

### 2. Reminders settings screen

`src/notifications/schedule.ts` is complete; there is no UI for it.

- New route `src/app/settings/reminders.tsx`, linked from the You tab.
- Time picker (default 19:30), enable/disable, streak-rescue toggle.
- A **Reminder health** card from `checkReminderHealth()`: permission state, pending
  count, next fire time, last reconcile, and the live-versus-scheduled timezone.
- A "Reminders not arriving?" sheet covering battery optimisation and the
  Xiaomi/Samsung/Huawei autostart settings. Android force-stop wipes the schedule with
  no API to detect it; `healIfCleared()` repairs it, and the card should say so.
- Call `reconcileReminders(db, 'settings-changed')` after every change.
- The UI must say **"around 19:30"**, never "at 19:30": we deliberately do not request
  `USE_EXACT_ALARM`, which Play policy restricts to alarm and calendar apps.
- **Done when:** changing the time reschedules all 14, and the health card reports
  honestly after a force-stop.

### 3. Onboarding

`learner_profile` has `sport`, `interests`, `goals` and `onboarded_at`, all unused. The
tutor prompt and several reminder templates already read `sport` and `interests`, so
this makes existing features better rather than adding new ones.

- Show once when `onboarded_at` is null; ask which sport, which peer situations matter,
  preferred session length and reminder time, then request notification permission.
- Per the spec: personalise without interviewing. Keep it to one screen.
- **Done when:** sport-flavoured reminder copy appears for a new user.

### 4. Listening stage

- Add `'listening'` back to the `standard` plan in `src/session/plan.ts`.
- New screen `src/app/session/[id]/listening.tsx`; fix the `listening` entry in
  `ROUTE_FOR` in `src/app/session/[id]/index.tsx`, which currently points at recall as a
  placeholder.
- Use `ListeningExerciseSchema` and `speakDutch` for playback.
- Follow the spec exactly: first pass audio only with no transcript; ask for the gist;
  replay; then **two** detail questions one at a time; then up to three difficult
  chunks; then two lines to shadow.
- The transcript must genuinely be hidden on the first pass. If it cannot be, say so —
  never claim it was hidden when it was not.
- Record `audio_source`. With `'text_only'` the screen must label the activity as
  text-based, and the model must never be given a field in which to claim it heard
  anything.
- **Done when:** a full listening stage runs with no Dutch voice installed and says
  plainly why there is no audio.

### 5. Topic role-play stage

- Add `'topic_conversation'` to the `standard` plan; new screen reusing the chat shape
  from `casual.tsx`.
- Three rounds, which is how the spec already describes it: setup, a small complication
  ("someone cannot make Saturday and proposes Sunday"), then a replay with fewer hints.
- Up to two corrections at the end, then a retry.

### 6. Progress tab

Repository functions already exist: `masteryCounts`, `xpHistory`, `challengeHistory`,
`completedSessionCount`, plus correction counts by category.

- Hand-rolled `react-native-svg` charts only. Do not add a charting library.
- Mastery bands come from FSRS stability, not a review counter — "words I own" is then a
  real retention estimate rather than a vanity number.
- No invented fluency percentages or CEFR levels, ever.
- Show the self-reported confidence trend. It is currently written to
  `session_stages.result_json` by the wrap-up and never read.

### 7. Book companion

Tables (`books`, `book_units`, `book_items`) and `BookItemExplanationSchema` exist.

- Add a book, then a unit or page range; paste or type the words you got stuck on.
- Walk them one at a time: *know it* / *explain it*. Anything kept joins the same
  review schedule via `addPhrase` with `source: 'book'`.
- Camera OCR is explicitly deferred — it needs a development build.

### 8. Media suggestions

- `MediaSuggestionsSchema` exists. Generate from phrases and topics already covered.
- Store `search_query` and open `https://www.youtube.com/results?search_query=...` via
  `expo-web-browser`. **Never render a model-produced `watch?v=` URL.**
- Surface as a carousel on Today plus a `/media` route; not a sixth tab.

### 9. Smaller items

- **Data export** — JSON + Markdown via `expo-sharing`; `listBackups`/`backupPath` exist.
- **Achievements** — table exists; tie to spec milestones (first Day 7 review, week 4
  complete, 30-day streak, 100 words owned).
- **Day 7 review flow** — familiar but unrehearsed tasks, compared against the baseline
  with concrete examples; ask for self-rated confidence; never invent a score.
- **FTS5 (migration v2)** — gate on
  `SELECT sqlite_compileoption_used('ENABLE_FTS5')` and keep the LIKE fallback.
- **Remove template leftovers** — `@expo/ui`, `expo-glass-effect`, `expo-symbols` are
  unused and add native weight to the Android build.
- **`daily_activity.active_seconds`** and **`messages.ai_call_id`** are never populated;
  either wire them up or drop them in a later migration.

---

## Traps specific to this codebase

- `npx expo install <pkg>`, never `npm install`, for anything `expo-*`. A mismatched
  version fails at runtime only.
- The project path contains a space. Harmless for Expo Go and EAS cloud builds; if you
  ever need a **local** Gradle build, move the project to a space-free path first.
- Jest needs `@/assets/*` mapped before the general `@/*` rule — see `jest.config.js`.
- Do not import `src/notifications/schedule.ts` from a unit test: it pulls in
  `expo-notifications`, which has native side effects at module load. Constants live in
  `src/notifications/constants.ts` precisely so tests can reach them.
- `ts-fsrs` v6 has no `elapsed_days` on `Card` or `ReviewLog`, and `Rating` is a const
  object plus a type alias, not a TS enum — hence `ReviewGrade` in `src/srs/fsrs.ts`.
- Capture `now` **once per round** and thread it through every item, or scheduling inside
  a round becomes non-deterministic and untestable.
- `eslint-plugin-import` cannot follow `export *` through `.d.ts`, which is why the
  `expo-notifications` enums are imported by name.
- The React Compiler is on: no `setState` synchronously inside an effect body, no refs
  written during render, no impure calls during render.

---

## Definition of done for the whole thing

From the spec: the owner can open the app, press one button, and immediately practise
Dutch; the app handles progression and review scheduling on its own; it stays
conversational and selective with corrections; it preserves history; and it makes real
speaking practice easier.

Plus the thing the spec could not do: **it reminds him, every day, with something worth
reading.**
