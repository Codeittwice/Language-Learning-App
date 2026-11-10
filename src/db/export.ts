import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import { nowIso } from '@/time/day';

const TABLES = [
  'learner_profile', 'sessions', 'session_stages', 'session_checkpoints', 'phrases', 'phrase_reviews',
  'fsrs_review_logs', 'messages', 'writing_exercises', 'corrections', 'listening_exercises',
  'real_world_challenges', 'daily_activity', 'xp_events', 'streak_state', 'achievements',
  'dictionary_entries', 'books', 'book_units', 'book_items', 'media_recommendations',
] as const;

type Row = Record<string, string | number | null>;
type ExportData = Record<(typeof TABLES)[number], Row[]>;

export async function collectLearningData(db: SQLiteDatabase): Promise<ExportData> {
  // One statement gives all sections the same SQLite read snapshot. The table
  // names are compile-time constants, and no settings or provider ledger are read.
  const rows = await db.getAllAsync<{ name: keyof ExportData; data: string }>(
    TABLES.map((table) => `SELECT '${table}' AS name,
      (SELECT json_group_array(json_object(${EXPORT_COLUMNS[table].map((key) => `'${key}', "${key}"`).join(', ')})) FROM "${table}") AS data`
    ).join(' UNION ALL ')
  );
  return Object.fromEntries(rows.map(({ name, data }) => [name, JSON.parse(data) as Row[]])) as ExportData;
}

const EXPORT_COLUMNS = {
  learner_profile: ['native_language', 'explanation_language', 'target_variety', 'default_register', 'sport', 'interests', 'goals', 'default_duration_mode', 'day_start_hour', 'timezone', 'tts_voice_id', 'tts_rate', 'daily_goal_xp', 'onboarded_at'],
  sessions: ['id', 'session_number', 'week', 'rotation_day', 'topic_key', 'duration_mode', 'kind', 'status', 'counted', 'started_at', 'completed_at', 'day_key'],
  session_stages: ['session_id', 'stage', 'stage_order', 'status', 'rounds_total', 'rounds_done', 'result_json', 'started_at', 'completed_at'],
  session_checkpoints: ['session_id', 'stage', 'next_stage', 'state_json', 'created_at'],
  phrases: ['id', 'dutch', 'meaning_en', 'meaning_bg', 'example_nl', 'example_en', 'context', 'register', 'word_class', 'article', 'plural', 'diminutive', 'verb_infinitive', 'verb_present_3sg', 'verb_past_sg', 'verb_past_pl', 'verb_participle', 'verb_aux', 'verb_separable', 'prepositions', 'tags', 'source', 'source_ref', 'introduced_at', 'needs_verification', 'fsrs_due', 'fsrs_stability', 'fsrs_difficulty', 'last_status'],
  phrase_reviews: ['id', 'phrase_id', 'session_id', 'prompt_kind', 'prompt_text', 'learner_answer', 'hint_count', 'status', 'grade', 'day_key', 'reviewed_at'],
  fsrs_review_logs: ['phrase_id', 'phrase_review_id', 'rating', 'state', 'due', 'stability', 'difficulty', 'scheduled_days', 'learning_steps', 'review'],
  messages: ['id', 'session_id', 'thread', 'stage', 'role', 'content', 'lang', 'input_mode', 'seq', 'created_at'],
  writing_exercises: ['id', 'session_id', 'prompt', 'original_text', 'revision_text', 'day_key', 'created_at'],
  corrections: ['session_id', 'stage', 'writing_exercise_id', 'original', 'corrected', 'category', 'explanation', 'is_required', 'retry_text', 'day_key', 'created_at'],
  listening_exercises: ['id', 'session_id', 'passage_nl', 'audio_source', 'est_seconds', 'gist_answer', 'gist_feedback', 'questions_json', 'hard_chunks_json', 'shadow_lines_json', 'play_count', 'slow_play_count', 'day_key', 'created_at'],
  real_world_challenges: ['id', 'assigned_session_id', 'action', 'status', 'learner_note', 'created_at', 'answered_at'],
  daily_activity: ['day_key', 'xp', 'goal_xp', 'goal_met', 'reviews', 'independent_reviews', 'active_seconds', 'sessions_completed', 'timezone'],
  xp_events: ['day_key', 'kind', 'amount', 'session_id', 'stage', 'ref_id', 'created_at'],
  streak_state: ['current_streak', 'longest_streak', 'last_goal_day', 'freezes_available', 'computed_at'],
  achievements: ['key', 'unlocked_at', 'progress_json'],
  dictionary_entries: ['id', 'query', 'query_lang', 'entry_json', 'confidence', 'saved_phrase_id', 'lookup_count', 'last_looked_up_at'],
  books: ['id', 'title', 'author', 'level_hint', 'created_at'],
  book_units: ['id', 'book_id', 'label', 'page_from', 'page_to', 'topic', 'notes', 'status', 'position'],
  book_items: ['id', 'unit_id', 'raw_text', 'status', 'explanation_json', 'phrase_id', 'position'],
  media_recommendations: ['id', 'title', 'why', 'search_query', 'status', 'learner_note', 'generated_from_session', 'created_at'],
} satisfies Record<(typeof TABLES)[number], string[]>;

function plain(value: Row[string] | undefined) {
  return String(value ?? '').replace(/[\\`*_{}[\]()<>#|]/g, '\\$&').replace(/\s+/g, ' ');
}

function markdown(data: ExportData, exportedAt: string) {
  const lines = [
    '# Dutch with Friends learning history', '', `Exported ${exportedAt}`, '',
    '## Scheduled sessions', '',
    ...data.sessions.filter((row) => row.kind === 'scheduled').map((row) =>
      `- Session ${plain(row.session_number)} · ${plain(row.topic_key)} · ${plain(row.status)} · ${plain(row.day_key)}`),
    '', '## Phrase bank', '',
    ...data.phrases.map((row) => `- **${plain(row.dutch)}** · ${plain(row.meaning_en)} · ${plain(row.last_status ?? 'not tested')}${row.fsrs_due ? ` · Review ${plain(row.fsrs_due)}` : ''}`),
    '', '## Corrections', '',
    ...data.corrections.map((row) => `- ${plain(row.original)} → ${plain(row.corrected)} · ${plain(row.explanation)}`),
    '', '## Real-world challenges', '',
    ...data.real_world_challenges.map((row) => `- ${plain(row.action)} · ${plain(row.status)}${row.learner_note ? ` · ${plain(row.learner_note)}` : ''}`),
    '', '## Learning days', '',
    ...data.daily_activity.map((row) => `- ${plain(row.day_key)} · ${plain(row.xp)} XP · ${plain(row.reviews)} reviews`),
    '', '## Milestones', '',
    ...data.achievements.map((row) => `- ${plain(row.key)} · ${plain(row.unlocked_at)}`), '',
  ];
  return lines.join('\n');
}

export async function exportLearningData(db: SQLiteDatabase, format: 'json' | 'md') {
  const exportedAt = nowIso();
  const data = await collectLearningData(db);
  const contents = format === 'json'
    ? JSON.stringify({ version: 1, exportedAt, data }, null, 2)
    : markdown(data, exportedAt);
  if (Platform.OS === 'web') {
    if (!(await Clipboard.setStringAsync(contents))) throw new Error('Clipboard unavailable');
    return 'copied';
  }
  if (!(await isAvailableAsync())) throw new Error('Sharing unavailable');
  const file = new File(Paths.cache, `dutch-with-friends.${format}`);
  file.create({ overwrite: true });
  file.write(contents);
  await shareAsync(file.uri, { mimeType: format === 'json' ? 'application/json' : 'text/markdown' });
  return 'shared';
}
