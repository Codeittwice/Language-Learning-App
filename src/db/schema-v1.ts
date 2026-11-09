/**
 * Migration v1 DDL, kept in its own module so `migrations.ts` stays readable.
 *
 * Conventions that hold for every table:
 *  - Timestamps are UTC ISO-8601 strings produced by JavaScript. Never SQLite's
 *    `datetime('now')`, which is UTC and so disagrees with local day boundaries.
 *  - `day_key` is 'YYYY-MM-DD' naming a learning day, always computed by
 *    `src/time/day.ts`, never by SQL.
 *  - Loose structures are JSON in TEXT columns, Zod-parsed on read.
 *  - Business invariants are CHECK constraints, not just TypeScript.
 */
export const SCHEMA_V1 = `
CREATE TABLE __migration_log (
  version    INTEGER PRIMARY KEY,
  label      TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE learner_profile (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  native_language       TEXT NOT NULL DEFAULT 'bg',
  explanation_language  TEXT NOT NULL DEFAULT 'en',
  target_variety        TEXT NOT NULL DEFAULT 'nl-NL',
  default_register      TEXT NOT NULL DEFAULT 'informal',
  sport                 TEXT,
  interests             TEXT NOT NULL DEFAULT '[]',
  goals                 TEXT,
  default_duration_mode TEXT NOT NULL DEFAULT 'standard'
    CHECK (default_duration_mode IN ('quick','short','standard')),
  day_start_hour        INTEGER NOT NULL DEFAULT 4
    CHECK (day_start_hour BETWEEN 0 AND 12),
  timezone              TEXT NOT NULL,
  tts_voice_id          TEXT,
  tts_rate              REAL NOT NULL DEFAULT 1.0,
  daily_goal_xp         INTEGER NOT NULL DEFAULT 30 CHECK (daily_goal_xp > 0),
  onboarded_at          TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

-- Sessions -------------------------------------------------------------------
-- 'counted' is the idempotency flag. Completion is an UPDATE guarded on
-- status='in_progress', so the spec's "increment exactly once" holds even under a
-- double tap. completedSessions is DERIVED from this column, never stored.
CREATE TABLE sessions (
  id             TEXT PRIMARY KEY,
  session_number INTEGER NOT NULL,
  week           INTEGER NOT NULL,
  rotation_day   INTEGER NOT NULL CHECK (rotation_day BETWEEN 1 AND 7),
  topic_key      TEXT NOT NULL,
  duration_mode  TEXT NOT NULL CHECK (duration_mode IN ('quick','short','standard')),
  kind           TEXT NOT NULL DEFAULT 'scheduled' CHECK (kind IN ('scheduled','extra')),
  status         TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','completed','abandoned')),
  next_stage     TEXT,
  counted        INTEGER NOT NULL DEFAULT 0 CHECK (counted IN (0,1)),
  day_key        TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  completed_at   TEXT,
  updated_at     TEXT NOT NULL,
  CHECK (NOT (counted = 1 AND status <> 'completed')),
  CHECK (NOT (kind = 'extra' AND counted = 1))
);
CREATE UNIQUE INDEX ux_sessions_number ON sessions(session_number)
  WHERE kind = 'scheduled' AND status <> 'abandoned';
CREATE INDEX ix_sessions_day ON sessions(day_key);
CREATE INDEX ix_sessions_status ON sessions(status);

CREATE TABLE session_stages (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  stage        TEXT NOT NULL CHECK (stage IN
    ('recall','listening','writing','topic_conversation','casual_conversation','wrap_up')),
  stage_order  INTEGER NOT NULL,
  planned      INTEGER NOT NULL DEFAULT 1 CHECK (planned IN (0,1)),
  status       TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','completed','skipped')),
  rounds_total INTEGER NOT NULL DEFAULT 1 CHECK (rounds_total > 0),
  rounds_done  INTEGER NOT NULL DEFAULT 0 CHECK (rounds_done >= 0),
  result_json  TEXT,
  started_at   TEXT,
  completed_at TEXT,
  UNIQUE (session_id, stage)
);
CREATE INDEX ix_stages_session ON session_stages(session_id, stage_order);

-- Recovery always reads MAX(seq). When that disagrees with session_stages, the UI
-- states the uncertainty rather than guessing (spec section 12).
CREATE TABLE session_checkpoints (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  stage      TEXT NOT NULL,
  next_stage TEXT,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, seq)
);

-- Phrase bank ----------------------------------------------------------------
-- The fsrs_* block mirrors the ts-fsrs Card type field for field, so there is no
-- mapping layer between the scheduler and storage.
CREATE TABLE phrases (
  id                        TEXT PRIMARY KEY,
  dutch                     TEXT NOT NULL,
  normalized                TEXT NOT NULL,
  meaning_en                TEXT NOT NULL,
  meaning_bg                TEXT,
  example_nl                TEXT,
  example_en                TEXT,
  context                   TEXT,
  register                  TEXT CHECK (register IN ('informal','neutral','formal','slang','vulgar')),
  word_class                TEXT,
  article                   TEXT CHECK (article IN ('de','het','de/het')),
  plural                    TEXT,
  diminutive                TEXT,
  verb_infinitive           TEXT,
  verb_present_3sg          TEXT,
  verb_past_sg              TEXT,
  verb_past_pl              TEXT,
  verb_participle           TEXT,
  verb_aux                  TEXT CHECK (verb_aux IN ('hebben','zijn','hebben/zijn')),
  verb_separable            INTEGER,
  prepositions              TEXT NOT NULL DEFAULT '[]',
  tags                      TEXT NOT NULL DEFAULT '[]',
  source                    TEXT NOT NULL CHECK (source IN
    ('seed','session','dictionary','book','real_life','media')),
  source_ref                TEXT,
  introduced_session_number INTEGER,
  introduced_at             TEXT NOT NULL,
  is_archived               INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),
  relearn_next_session      INTEGER NOT NULL DEFAULT 0 CHECK (relearn_next_session IN (0,1)),
  confidence_self           INTEGER CHECK (confidence_self BETWEEN 1 AND 5),
  needs_verification        INTEGER NOT NULL DEFAULT 0 CHECK (needs_verification IN (0,1)),
  fsrs_due                  TEXT NOT NULL,
  fsrs_stability            REAL NOT NULL DEFAULT 0,
  fsrs_difficulty           REAL NOT NULL DEFAULT 0,
  fsrs_scheduled_days       REAL NOT NULL DEFAULT 0,
  fsrs_learning_steps       INTEGER NOT NULL DEFAULT 0,
  fsrs_reps                 INTEGER NOT NULL DEFAULT 0,
  fsrs_lapses               INTEGER NOT NULL DEFAULT 0,
  fsrs_state                INTEGER NOT NULL DEFAULT 0 CHECK (fsrs_state BETWEEN 0 AND 3),
  fsrs_last_review          TEXT,
  last_status               TEXT CHECK (last_status IN
    ('independent','prompted','missed','not_tested')),
  independent_count         INTEGER NOT NULL DEFAULT 0,
  prompted_count            INTEGER NOT NULL DEFAULT 0,
  missed_count              INTEGER NOT NULL DEFAULT 0,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_phrases_normalized ON phrases(normalized);
CREATE INDEX ix_phrases_due ON phrases(fsrs_due) WHERE is_archived = 0;
CREATE INDEX ix_phrases_state ON phrases(fsrs_state);
CREATE INDEX ix_phrases_relearn ON phrases(relearn_next_session)
  WHERE relearn_next_session = 1;
CREATE INDEX ix_phrases_source ON phrases(source);

-- One row per attempt. The four CHECKs below make the spec's strictest rules
-- impossible to violate at the storage layer: a hint can never yield 'independent',
-- and recognition alone never counts as production.
CREATE TABLE phrase_reviews (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  phrase_id        TEXT NOT NULL REFERENCES phrases(id) ON DELETE CASCADE,
  session_id       TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  stage            TEXT,
  prompt_kind      TEXT NOT NULL CHECK (prompt_kind IN
    ('en_to_nl','bg_to_nl','situation','cloze','original_sentence','spoken_cue','recognition')),
  prompt_text      TEXT NOT NULL,
  learner_answer   TEXT,
  hint_count       INTEGER NOT NULL DEFAULT 0 CHECK (hint_count >= 0),
  revealed         INTEGER NOT NULL DEFAULT 0 CHECK (revealed IN (0,1)),
  status           TEXT NOT NULL CHECK (status IN
    ('independent','prompted','missed','not_tested')),
  grade            INTEGER CHECK (grade BETWEEN 1 AND 4),
  graded_by        TEXT NOT NULL CHECK (graded_by IN ('ai','self','local')),
  ai_accepted      INTEGER,
  ai_explanation   TEXT,
  suggested_answer TEXT,
  alternatives     TEXT,
  latency_ms       INTEGER,
  day_key          TEXT NOT NULL,
  reviewed_at      TEXT NOT NULL,
  CHECK (NOT (hint_count > 0 AND status = 'independent')),
  CHECK (NOT (revealed = 1 AND status = 'independent')),
  CHECK (NOT (prompt_kind = 'recognition' AND status = 'independent')),
  CHECK (NOT (status = 'not_tested' AND grade IS NOT NULL))
);
CREATE INDEX ix_reviews_phrase ON phrase_reviews(phrase_id, reviewed_at);
CREATE INDEX ix_reviews_day ON phrase_reviews(day_key);
CREATE INDEX ix_reviews_session ON phrase_reviews(session_id);

-- Mirrors the ts-fsrs v6 ReviewLog type field for field, so a misgrade can be rolled
-- back and FSRS parameters can later be optimised against real history. (v6 dropped
-- the elapsed_days / last_elapsed_days fields earlier versions carried.)
CREATE TABLE fsrs_review_logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  phrase_id        TEXT NOT NULL REFERENCES phrases(id) ON DELETE CASCADE,
  phrase_review_id INTEGER REFERENCES phrase_reviews(id) ON DELETE SET NULL,
  rating           INTEGER NOT NULL,
  state            INTEGER NOT NULL,
  due              TEXT NOT NULL,
  stability        REAL NOT NULL,
  difficulty       REAL NOT NULL,
  scheduled_days   REAL NOT NULL,
  learning_steps   INTEGER NOT NULL,
  review           TEXT NOT NULL
);
CREATE INDEX ix_fsrs_logs_phrase ON fsrs_review_logs(phrase_id, review);

-- Conversation ---------------------------------------------------------------
-- input_mode records how each turn arrived, which together with the CHECK on
-- writing_exercises keeps dictation from being counted as writing (spec section 8).
CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  thread     TEXT NOT NULL,
  stage      TEXT,
  role       TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
  content    TEXT NOT NULL,
  lang       TEXT,
  input_mode TEXT CHECK (input_mode IN ('typed','dictated','button')),
  audio_uri  TEXT,
  ai_call_id INTEGER,
  seq        INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_messages_thread ON messages(session_id, thread, seq);

CREATE TABLE writing_exercises (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  prompt           TEXT NOT NULL,
  target_sentences INTEGER NOT NULL DEFAULT 5,
  original_text    TEXT NOT NULL,
  input_mode       TEXT NOT NULL DEFAULT 'typed' CHECK (input_mode = 'typed'),
  revision_text    TEXT,
  revision_at      TEXT,
  day_key          TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE TABLE corrections (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id          TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  stage               TEXT,
  writing_exercise_id INTEGER REFERENCES writing_exercises(id) ON DELETE CASCADE,
  original            TEXT NOT NULL,
  corrected           TEXT NOT NULL,
  category            TEXT NOT NULL CHECK (category IN
    ('grammar','word_order','vocabulary','article','preposition',
     'conjugation','spelling','naturalness')),
  explanation         TEXT NOT NULL,
  is_required         INTEGER NOT NULL DEFAULT 1 CHECK (is_required IN (0,1)),
  retry_text          TEXT,
  retry_success       INTEGER,
  day_key             TEXT NOT NULL,
  created_at          TEXT NOT NULL
);
CREATE INDEX ix_corrections_category ON corrections(category, created_at);

CREATE TABLE listening_exercises (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id           TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  passage_nl           TEXT NOT NULL,
  is_fictional         INTEGER NOT NULL DEFAULT 1 CHECK (is_fictional IN (0,1)),
  audio_source         TEXT NOT NULL CHECK (audio_source IN ('tts','external','text_only')),
  external_ref         TEXT,
  est_seconds          INTEGER,
  gist_answer          TEXT,
  gist_feedback        TEXT,
  questions_json       TEXT NOT NULL DEFAULT '[]',
  hard_chunks_json     TEXT,
  shadow_lines_json    TEXT,
  play_count           INTEGER NOT NULL DEFAULT 0,
  slow_play_count      INTEGER NOT NULL DEFAULT 0,
  transcript_revealed_at TEXT,
  day_key              TEXT NOT NULL,
  created_at           TEXT NOT NULL
);

CREATE TABLE real_world_challenges (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  assigned_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  rotation_day       INTEGER,
  action             TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN
    ('assigned','completed','attempted','not_attempted','declined')),
  learner_note       TEXT,
  asked_at           TEXT,
  answered_at        TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX ix_challenges_status ON real_world_challenges(status, created_at);

-- Gamification ---------------------------------------------------------------
CREATE TABLE daily_activity (
  day_key             TEXT PRIMARY KEY,
  xp                  INTEGER NOT NULL DEFAULT 0,
  goal_xp             INTEGER NOT NULL,
  goal_met            INTEGER NOT NULL DEFAULT 0 CHECK (goal_met IN (0,1)),
  reviews             INTEGER NOT NULL DEFAULT 0,
  independent_reviews INTEGER NOT NULL DEFAULT 0,
  active_seconds      INTEGER NOT NULL DEFAULT 0,
  sessions_completed  INTEGER NOT NULL DEFAULT 0,
  freeze_used         INTEGER NOT NULL DEFAULT 0 CHECK (freeze_used IN (0,1)),
  timezone            TEXT NOT NULL,
  first_activity_at   TEXT,
  last_activity_at    TEXT
);

-- dedupe_key plus its unique partial index means a remount or double tap cannot
-- inflate XP.
CREATE TABLE xp_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  day_key    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  session_id TEXT,
  stage      TEXT,
  ref_id     TEXT,
  dedupe_key TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_xp_dedupe ON xp_events(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX ix_xp_day ON xp_events(day_key);

-- A cache of the recomputation, never the source of truth: recomputeStreak() derives
-- the streak from the ordered day_key set in daily_activity.
CREATE TABLE streak_state (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  current_streak     INTEGER NOT NULL DEFAULT 0,
  longest_streak     INTEGER NOT NULL DEFAULT 0,
  last_goal_day      TEXT,
  freezes_available  INTEGER NOT NULL DEFAULT 0,
  computed_at        TEXT NOT NULL
);

CREATE TABLE achievements (
  key           TEXT PRIMARY KEY,
  unlocked_at   TEXT NOT NULL,
  progress_json TEXT
);

-- Dictionary -----------------------------------------------------------------
CREATE TABLE dictionary_entries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  query             TEXT NOT NULL,
  normalized_query  TEXT NOT NULL,
  query_lang        TEXT NOT NULL CHECK (query_lang IN ('nl','en','bg')),
  entry_json        TEXT NOT NULL,
  source            TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai','manual','seed')),
  provider          TEXT,
  model             TEXT,
  confidence        TEXT CHECK (confidence IN ('high','medium','low')),
  saved_phrase_id   TEXT REFERENCES phrases(id) ON DELETE SET NULL,
  lookup_count      INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  last_looked_up_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_dict_query ON dictionary_entries(normalized_query, query_lang);

-- Book companion -------------------------------------------------------------
CREATE TABLE books (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  author     TEXT,
  level_hint TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE book_units (
  id         TEXT PRIMARY KEY,
  book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  page_from  INTEGER,
  page_to    INTEGER,
  topic      TEXT,
  notes      TEXT,
  position   INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','in_progress','done')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_units_book ON book_units(book_id, position);

CREATE TABLE book_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id          TEXT NOT NULL REFERENCES book_units(id) ON DELETE CASCADE,
  raw_text         TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'word'
    CHECK (kind IN ('word','phrase','sentence','grammar_question')),
  status           TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','explained','known','added','skipped')),
  explanation_json TEXT,
  phrase_id        TEXT REFERENCES phrases(id) ON DELETE SET NULL,
  position         INTEGER NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX ix_items_unit ON book_items(unit_id, position);

-- Media ----------------------------------------------------------------------
-- search_query, never a watch URL: models hallucinate video ids, and a dead link
-- reads as a broken app.
CREATE TABLE media_recommendations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  kind                  TEXT NOT NULL CHECK (kind IN
    ('youtube','series','film','podcast','music','news')),
  title                 TEXT NOT NULL,
  why                   TEXT NOT NULL,
  search_query          TEXT NOT NULL,
  platform_hint         TEXT,
  difficulty            TEXT CHECK (difficulty IN ('easier','on_level','stretch')),
  phrase_ids            TEXT NOT NULL DEFAULT '[]',
  topic_tags            TEXT NOT NULL DEFAULT '[]',
  generated_from_session TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN
    ('suggested','saved','opened','watched','dismissed')),
  learner_note          TEXT,
  rating                INTEGER CHECK (rating BETWEEN 1 AND 5),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX ix_media_status ON media_recommendations(status, created_at);

-- AI accounting --------------------------------------------------------------
CREATE TABLE ai_calls (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  purpose           TEXT NOT NULL,
  mode              TEXT NOT NULL CHECK (mode IN ('chat','stream','structured')),
  schema_strategy   TEXT CHECK (schema_strategy IN
    ('native_schema','tool_force','prompt_only','repair')),
  session_id        TEXT,
  stage             TEXT,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  cached_tokens     INTEGER,
  reasoning_tokens  INTEGER,
  cost_usd          REAL,
  cost_is_estimate  INTEGER NOT NULL DEFAULT 1 CHECK (cost_is_estimate IN (0,1)),
  latency_ms        INTEGER,
  http_status       INTEGER,
  ok                INTEGER NOT NULL CHECK (ok IN (0,1)),
  error_code        TEXT,
  error_message     TEXT,
  retries           INTEGER NOT NULL DEFAULT 0,
  day_key           TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
CREATE INDEX ix_ai_calls_day ON ai_calls(day_key);
CREATE INDEX ix_ai_calls_purpose ON ai_calls(purpose, created_at);

CREATE TABLE ai_models (
  provider             TEXT NOT NULL,
  model_id             TEXT NOT NULL,
  label                TEXT,
  context_window       INTEGER,
  supports_json_schema INTEGER,
  supports_tools       INTEGER,
  supports_streaming   INTEGER,
  input_price_per_m    REAL,
  output_price_per_m   REAL,
  raw_json             TEXT,
  fetched_at           TEXT NOT NULL,
  PRIMARY KEY (provider, model_id)
);
`;
