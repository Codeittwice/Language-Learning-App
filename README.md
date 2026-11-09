# Dutch with Friends

An AI Dutch practice app for the phone, built around one thing the previous
ChatGPT-based routine was missing: something that reminds you to show up.

The teaching design comes from [`docs/spec.md`](docs/spec.md) and is the source of
truth for *how* to teach. This app replaces that spec's web delivery layer (Next.js,
Postgres, Supabase) with a local-first mobile one, because none of that can put a
notification on your lock screen at half seven.

## Running it

```bash
npm start
```

Scan the QR code with Expo Go on Android. No Android Studio and no Android SDK are
needed: every dependency ships inside the Expo SDK, and local notifications work in
Expo Go (only *push* notifications do not).

If Metro is unreachable, allow Node through the Windows Defender prompt on private
networks, or start with `npx expo start --tunnel`.

```bash
npm run typecheck && npm test && npx eslint src
```

## How it is put together

| Area | Where | Notes |
|---|---|---|
| Learning-day arithmetic | `src/time/day.ts` | A day runs from 04:00 to 04:00, so a late-night session counts for the day before. |
| Database | `src/db/` | SQLite, 17 tables, hand-written append-only migrations. |
| AI providers | `src/ai/` | OpenAI, Anthropic, Gemini, OpenRouter behind one interface. |
| Screens | `src/app/` | Expo Router. Everything else lives outside this folder. |
| Design tokens | `src/theme/tokens.ts` | The only place a colour or size is decided. |

### Decisions worth knowing before changing anything

**Day keys are never computed in SQL.** SQLite's `date('now')` is UTC, so at 01:00
Amsterdam time it returns yesterday. Every `day_key` in the database comes from
`src/time/day.ts`. Treat a `'now'` appearing in a SQL string as a bug.

**`PRAGMA foreign_keys = ON` is set per connection and outside any transaction.**
Inside a transaction it silently does nothing, and every `REFERENCES` clause becomes
decoration while orphan rows pile up unnoticed.

**Migrations are append-only.** Once a migration has run on a real device its `up` is
frozen; editing it makes that device and a fresh install diverge permanently with no
way to tell. Add a new migration instead. The runner copies the database file aside
before any upgrade.

**The spec's strictest rules are CHECK constraints, not comments.** A hint can never
produce an `independent` recall; recognition is never production; dictation is never
writing. Those are enforced by the schema, so a future refactor that breaks one gets
a loud SQLite error rather than a quietly corrupted learning record.

**The AI proposes, application code decides.** Every structured call has a
deterministic local fallback — self-grading for recall, raw text for writing
feedback, a SQLite-built summary for the wrap-up. A model that cannot follow a schema
must never leave you at a dead end, and this is also the offline path.

**No Vercel AI SDK.** Its Expo guide exists to keep API keys server-side, which is
the one problem a bring-your-own-key app does not have. Plain REST over `expo/fetch`
instead, which is also the only fetch in React Native that genuinely streams.

**Keys live only in SecureStore.** The UI sees `hasKey()` and a mask, never the
value. Everything logged or persisted goes through `redact()`, and Gemini is
authenticated with a header rather than the `?key=` query parameter its docs lead
with, so no secret reaches a URL.

**Costs are shown only where a provider publishes prices.** OpenRouter does; the
others do not. Rather than ship a price table that would be stale within months, the
app shows token counts and says the cost is unknown.

## Status

Working: database and migrations, the four AI providers with key validation and model
selection, the tab shell, design system, and the learning-day/streak foundations.

Not built yet: the practice session itself, reminders, the dictionary, the book
companion and the progress charts. The Today tab reports real setup state rather than
pretending otherwise.
