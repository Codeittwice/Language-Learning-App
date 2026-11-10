# Handoff: finishing Dutch with Friends

This document covers the app's current practice flow, persistence rules, and device
acceptance checks.

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

- The daily practice loop is recall, listening, writing, topic role-play, Friend Mode,
  and wrap-up. Quick practice has three stages. Sessions started on v1 keep their saved plan.
- Onboarding and Practice preferences cover topics, duration, and the device's Dutch voice.
- Daily reminder settings include time, streak rescue, OS queue health and recovery.
- Dictionary, book companion, progress and milestones share the on-device phrase bank and FSRS.
- Day 7 pairs a mixed review with saved Day 1 examples and optional self-rated confidence.
- Media suggestions open YouTube searches based on completed practice.
- Settings exports JSON or Markdown and can share the pre-upgrade database snapshots.
- Migration v2 adds an optional FTS5 index with the existing LIKE search as fallback.

Run these before and after changes:

```bash
npm run typecheck
npm run lint
npm test -- --runInBand
npx eslint src --max-warnings 0
npx expo export --platform all
```

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
way to detect the difference. Append the next migration without editing v1 or v2.

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
- **No Vercel AI SDK.** Its Expo guide exists to keep keys server-side, which is the one
  problem a bring-your-own-key app does not have.

---

## Device acceptance checks

- On Android, enable reminders and change the time. Check the live queue, then
  force-stop and reopen the app to confirm that its missing reminders are rebuilt.
- On iOS, check permission, the next expected time, and a notification tap from a cold start.
- Look up an uncached word with a configured provider. Switch to airplane mode and
  repeat the lookup in the same query language.
- Run a full session once with a Dutch voice and once without one. The first audio
  pass hides the transcript. The latter session identifies itself as text-based.
- Background or close the app during a stage, reopen it, and verify the same session
  and saved answers are available. Finish it, then complete an extra practice round.
- Share JSON and Markdown from Learning data and open each file on the receiving app.

Camera OCR remains deferred. The app uses typed conversation and system speech playback.

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
