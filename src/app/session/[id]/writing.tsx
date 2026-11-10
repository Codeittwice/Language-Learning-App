/**
 * The writing stage.
 *
 * Typed only, by design: the spec is explicit that dictation does not count as
 * writing, and `writing_exercises.input_mode` has a CHECK constraint pinning it to
 * 'typed' so that stays true however the UI changes.
 *
 * At most two required corrections, then a rewrite. The learner's text is saved to
 * SQLite BEFORE the AI call, so a rate limit or a dropped connection can never eat
 * four sentences they just wrote.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { aiStructured } from '@/ai/call';
import { AiError } from '@/ai/errors';
import { tutorSystemPrompt, writingFeedbackPrompt } from '@/ai/prompts';
import { type WritingCorrection, type WritingFeedback, WritingFeedbackSchema } from '@/ai/schemas';
import { emit } from '@/db/events';
import { currentDayKey, getProfile, type LearnerProfile } from '@/db/repo/profile';
import { getStages, saveCheckpoint } from '@/db/repo/sessions';
import { awardXp } from '@/gamification/xp';
import { advanceStage, sessionById } from '@/session/engine';
import { topicByKey, topicFor, type RotationTopic } from '@/session/rotation';
import { nowIso } from '@/time/day';
import { useTheme } from '@/theme/use-theme';
import { Button, Chip } from '@/ui/button';
import { SessionHeader } from '@/ui/session-header';
import { SpeakButton } from '@/ui/speak-button';
import { Card, Row } from '@/ui/surface';
import { Text } from '@/ui/text';
import { CORRECTION_LABELS, type SessionStage } from '@/types';

const STAGE: SessionStage = 'writing';
const MIN_WORDS = 12;

type Phase = 'writing' | 'feedback' | 'rewriting';

export default function WritingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();

  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [topic, setTopic] = useState<RotationTopic | null>(null);
  const [stageIndex, setStageIndex] = useState(1);
  const [stageCount, setStageCount] = useState(4);
  const [loading, setLoading] = useState(true);
  const [startedAt] = useState(() => Date.now());

  const [text, setText] = useState('');
  const [rewrite, setRewrite] = useState('');
  const [phase, setPhase] = useState<Phase>('writing');
  const [checking, setChecking] = useState(false);
  const [corrections, setCorrections] = useState<WritingCorrection[]>([]);
  const [encouragement, setEncouragement] = useState('');
  const [rawFeedback, setRawFeedback] = useState<string | null>(null);
  const [exerciseId, setExerciseId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState('');

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!id) return;
      const session = await sessionById(db, id);
      if (cancelled) return;
      if (!session) throw new Error('Session unavailable');
      const [loadedProfile, stageRows, saved] = await Promise.all([
        getProfile(db), getStages(db, id),
        db.getFirstAsync<{ id: number; original_text: string; revision_text: string | null }>(
          'SELECT id, original_text, revision_text FROM writing_exercises WHERE session_id = ? ORDER BY id DESC LIMIT 1', [id]
        ),
      ]);
      const feedback = saved ? await db.getAllAsync<Omit<WritingCorrection, 'isRequired'>>(
        'SELECT original, corrected, category, explanation FROM corrections WHERE writing_exercise_id = ? AND is_required = 1 ORDER BY id LIMIT 2',
        [saved.id]
      ) : [];
      if (cancelled) return;

      const stages = stageRows.map((stage) => stage.stage);
      setProfile(loadedProfile);
      setTopic(topicByKey(session.topicKey) ?? topicFor(session.sessionNumber));
      setStageIndex(Math.max(0, stages.indexOf(STAGE)));
      setStageCount(stages.length);
      if (saved) {
        setText(saved.original_text);
        setRewrite(saved.revision_text ?? '');
        setExerciseId(saved.id);
        setCorrections(feedback.map((item) => ({ ...item, isRequired: true })));
        if (!feedback.length) setRawFeedback('Your original is saved. Read it once, then try a fresh version.');
        setPhase(feedback.length && !saved.revision_text ? 'feedback' : 'rewriting');
      }
      setLoading(false);
    })().catch(() => { if (!cancelled) setSaveError('Could not open the saved exercise.'); });

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [db, id]);

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  const submit = useCallback(async () => {
    if (!id || !profile || !topic || checking) return;
    const written = text.trim();
    if (!written) return;

    setChecking(true);
    setSaveError('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let persisted = false;
    try {
      const dayKey = await currentDayKey(db);
      // Preserve the learner's original before calling the provider.
      const inserted = await db.runAsync(
        `INSERT INTO writing_exercises (session_id, prompt, target_sentences, original_text, input_mode, day_key, created_at)
         VALUES (?, ?, ?, ?, 'typed', ?, ?)`,
        [id, topic.writing, 5, written, dayKey, nowIso()]
      );
      const writingId = inserted.lastInsertRowId;
      persisted = true;
      setExerciseId(writingId);
      const feedback = await aiStructured<WritingFeedback>(db, {
        purpose: 'writing.feedback',
        sessionId: id,
        stage: STAGE,
        schema: WritingFeedbackSchema,
        schemaName: 'WritingFeedback',
        temperature: 0.2,
        maxTokens: 900,
        signal: controller.signal,
        messages: [
          { role: 'system', content: tutorSystemPrompt(profile, topic) },
          { role: 'user', content: writingFeedbackPrompt({ task: topic.writing, text: written }) },
        ],
      });
      controller.signal.throwIfAborted();

      // Spec section 8: at most two required corrections.
      const required = feedback.corrections.filter((c) => c.isRequired).slice(0, 2);
      const optional = feedback.corrections.filter((c) => !c.isRequired).slice(0, 2);
      const shown = [...required, ...optional];

      setCorrections(shown);
      setEncouragement(feedback.encouragement);
      setRawFeedback(null);

      for (const correction of required) {
        await db.runAsync(
          `INSERT INTO corrections (session_id, stage, writing_exercise_id, original, corrected,
                                    category, explanation, is_required, day_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            id,
            STAGE,
            writingId,
            correction.original,
            correction.corrected,
            correction.category,
            correction.explanation,
            dayKey,
            nowIso(),
          ]
        );
      }
      emit('session:changed');
      setPhase(required.length > 0 ? 'feedback' : 'rewriting');
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!persisted) {
        setSaveError('Your text could not be saved. It is still in the editor.');
        return;
      }
      // The text is already saved. Show whatever we can and keep the stage usable.
      const message =
        error instanceof AiError ? error.userMessage : 'Could not get feedback right now.';
      setCorrections([]);
      setRawFeedback(message);
      setPhase('rewriting');
    } finally {
      setChecking(false);
    }
  }, [checking, db, id, profile, text, topic]);

  const finish = useCallback(async () => {
    if (!id) return;
    const session = await sessionById(db, id);
    if (!session) return;

    const revised = rewrite.trim();
    if (revised && exerciseId !== null) {
      await db.runAsync(
        'UPDATE writing_exercises SET revision_text = ?, revision_at = ? WHERE id = ?',
        [revised, nowIso(), exerciseId]
      );
      const dayKey = await currentDayKey(db);
      await awardXp(db, dayKey, {
        kind: 'WRITING_REVISED',
        sessionId: id,
        stage: STAGE,
        dedupeKey: `writing:${id}:${exerciseId}`,
      });
    }

    await saveCheckpoint(db, id, STAGE, null, { done: true });
    const nextStage = await advanceStage(db, session, {
      stage: STAGE,
      result: { words: wordCount, corrections: corrections.length },
    });
    router.replace(nextStage ? `/session/${id}` : `/session/${id}/complete`);
  }, [corrections.length, db, exerciseId, id, rewrite, router, wordCount]);

  const skip = useCallback(async () => {
    if (!id) return;
    abortRef.current?.abort();
    const session = await sessionById(db, id);
    if (!session) return;
    const nextStage = await advanceStage(db, session, { stage: STAGE, skipped: true });
    router.replace(nextStage ? `/session/${id}` : `/session/${id}/complete`);
  }, [db, id, router]);

  if (loading || !topic) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {saveError ? <Button title="Back to Today" onPress={() => router.replace('/')} /> : <ActivityIndicator color={theme.colors.primary} />}
        {saveError ? <Text tone="danger">{saveError}</Text> : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <SessionHeader
        stage={STAGE}
        stageIndex={stageIndex}
        stageCount={stageCount}
        progress={phase === 'writing' ? 0.2 : phase === 'feedback' ? 0.6 : 0.85}
        startedAt={startedAt}
        onClose={() => router.replace('/')}
        onSkip={() => void skip()}
      />

      <ScrollView
        contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.lg }}
        keyboardShouldPersistTaps="handled"
      >
        {saveError ? <Text tone="danger" accessibilityRole="alert">{saveError}</Text> : null}
        <Card>
          <Text variant="caption" tone="faint">
            WRITE
          </Text>
          <Text variant="h3">{topic.writing}</Text>
          <Text variant="small" tone="muted">
            Four to six sentences. Type it yourself -- no translation first, that is the
            whole point.
          </Text>
        </Card>

        {phase === 'writing' ? (
          <>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Schrijf hier in het Nederlands..."
              placeholderTextColor={theme.colors.textFaint}
              multiline
              autoCapitalize="sentences"
              editable={!checking}
              style={{
                minHeight: 170,
                color: theme.colors.text,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                padding: theme.space.md,
                fontSize: 17,
                lineHeight: 24,
                textAlignVertical: 'top',
              }}
            />
            <Row>
              <Text variant="caption" tone="faint" style={{ flex: 1 }}>
                {wordCount} words
              </Text>
              {wordCount > 0 && wordCount < MIN_WORDS ? (
                <Text variant="caption" tone="faint">
                  A few more makes the feedback useful
                </Text>
              ) : null}
            </Row>
            <Button
              title="Get feedback"
              loading={checking}
              disabled={wordCount === 0}
              onPress={() => void submit()}
            />
          </>
        ) : (
          <Animated.View entering={FadeIn} style={{ gap: theme.space.lg }}>
            <Card>
              <Text variant="caption" tone="faint">
                WHAT YOU WROTE
              </Text>
              <Text variant="body">{text.trim()}</Text>
            </Card>

            {encouragement ? (
              <Row>
                <Ionicons name="happy-outline" size={18} color={theme.colors.success} />
                <Text variant="small" tone="success" style={{ flex: 1 }}>
                  {encouragement}
                </Text>
              </Row>
            ) : null}

            {rawFeedback ? (
              <Card>
                <Text variant="smallStrong" tone="danger">
                  No feedback this time
                </Text>
                <Text variant="small" tone="muted">
                  {rawFeedback} Your writing is saved. You can still revise it below.
                </Text>
              </Card>
            ) : null}

            {corrections.map((correction, position) => (
              <CorrectionCard key={`${correction.original}-${position}`} correction={correction} />
            ))}

            <Card>
              <Text variant="caption" tone="faint">
                NOW WRITE IT AGAIN
              </Text>
              <Text variant="small" tone="muted">
                Rewriting it is what makes the correction stick.
              </Text>
              <TextInput
                value={rewrite}
                onChangeText={setRewrite}
                placeholder="Your revised version"
                placeholderTextColor={theme.colors.textFaint}
                multiline
                style={{
                  minHeight: 140,
                  color: theme.colors.text,
                  backgroundColor: theme.colors.surfaceAlt,
                  borderRadius: theme.radius.md,
                  padding: theme.space.md,
                  fontSize: 17,
                  lineHeight: 24,
                  textAlignVertical: 'top',
                }}
              />
            </Card>

            <Button title="Done" onPress={() => void finish()} />
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

function CorrectionCard({ correction }: { correction: WritingCorrection }) {
  const theme = useTheme();
  return (
    <Card>
      <Row>
        <Chip
          label={CORRECTION_LABELS[correction.category] ?? correction.category}
          tone={correction.isRequired ? 'danger' : 'neutral'}
        />
        {!correction.isRequired ? (
          <Text variant="caption" tone="faint">
            optional
          </Text>
        ) : null}
      </Row>

      <Text variant="small" tone="muted" style={{ textDecorationLine: 'line-through' }}>
        {correction.original}
      </Text>

      <Row>
        <Text variant="dutch" style={{ flex: 1, color: theme.colors.success }}>
          {correction.corrected}
        </Text>
        <SpeakButton text={correction.corrected} />
      </Row>

      <Text variant="small" tone="muted">
        {correction.explanation}
      </Text>
    </Card>
  );
}
