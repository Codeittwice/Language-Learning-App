/**
 * Wrap-up: two retrieval prompts, one real-world challenge, and the log.
 *
 * The summary is generated from the AI when it can be, but every field is already in
 * SQLite, so the fallback builds the whole thing locally. Confidence is asked of the
 * learner and never inferred -- the spec allows a 1-5 rating only when they report it.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { aiStructured } from '@/ai/call';
import { tutorSystemPrompt, wrapUpPrompt } from '@/ai/prompts';
import { type SessionSummary, SessionSummarySchema } from '@/ai/schemas';
import { getProfile } from '@/db/repo/profile';
import { readReviewExamples } from '@/db/repo/progress';
import { assignChallenge, getStages } from '@/db/repo/sessions';
import { advanceStage, finishSession, sessionById } from '@/session/engine';
import { topicByKey, topicFor, type RotationTopic } from '@/session/rotation';
import { useTheme } from '@/theme/use-theme';
import { Button, Chip } from '@/ui/button';
import { SessionHeader } from '@/ui/session-header';
import { Card, Row } from '@/ui/surface';
import { Text } from '@/ui/text';
import type { SessionStage } from '@/types';

const STAGE: SessionStage = 'wrap_up';

type SessionFacts = {
  reviewed: string[];
  meanings: string[];
  missed: string[];
  corrections: string[];
  independent: number;
  total: number;
};

export default function WrapUpScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();

  const [facts, setFacts] = useState<SessionFacts | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [fromAi, setFromAi] = useState(true);
  const [loading, setLoading] = useState(true);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [stageIndex, setStageIndex] = useState(3);
  const [stageCount, setStageCount] = useState(4);
  const [startedAt] = useState(() => Date.now());
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState<Awaited<ReturnType<typeof readReviewExamples>> | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!id) return;
      const session = await sessionById(db, id);
      if (!session || cancelled) return;

      const loadedProfile = await getProfile(db);
      const sessionTopic = topicByKey(session.topicKey) ?? topicFor(session.sessionNumber);
      const stages = (await getStages(db, id)).map((stage) => stage.stage);

      // Everything the summary needs is already recorded.
      const reviewRows = await db.getAllAsync<{ dutch: string; meaning_en: string; status: string }>(
        `SELECT p.dutch AS dutch, p.meaning_en, r.status AS status
           FROM phrase_reviews r JOIN phrases p ON p.id = r.phrase_id
          WHERE r.session_id = ? AND r.status <> 'not_tested' ORDER BY r.reviewed_at`,
        [id]
      );
      const correctionRows = await db.getAllAsync<{ corrected: string; category: string }>(
        'SELECT corrected, category FROM corrections WHERE session_id = ? AND is_required = 1',
        [id]
      );

      const collected: SessionFacts = {
        reviewed: [...new Set(reviewRows.map((row) => row.dutch))],
        meanings: [...new Set(reviewRows.map((row) => row.meaning_en))],
        missed: [...new Set(reviewRows.filter((r) => r.status === 'missed').map((r) => r.dutch))],
        corrections: correctionRows.map((row) => `${row.category}: ${row.corrected}`),
        independent: reviewRows.filter((row) => row.status === 'independent').length,
        total: reviewRows.length,
      };

      const examples = session.rotationDay === 7 && session.kind === 'scheduled' ? await readReviewExamples(db, id) : null;
      if (cancelled) return;
      setReview(examples);
      setFacts(collected);
      setStageIndex(Math.max(0, stages.indexOf(STAGE)));
      setStageCount(stages.length);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const generated = await aiStructured<SessionSummary>(db, {
          purpose: 'wrapup.summary',
          sessionId: id,
          stage: STAGE,
          schema: SessionSummarySchema,
          schemaName: 'SessionSummary',
          temperature: 0.3,
          maxTokens: 700,
          signal: controller.signal,
          messages: [
            { role: 'system', content: tutorSystemPrompt(loadedProfile, sessionTopic) },
            {
              role: 'user',
              content: wrapUpPrompt({
                topic: sessionTopic,
                reviewed: collected.reviewed,
                missed: collected.missed,
                corrections: collected.corrections,
              }),
            },
          ],
        });
        if (!cancelled) {
          setSummary(generated);
          setFromAi(true);
        }
      } catch {
        // Every field exists locally, so a provider failure costs polish, not content.
        if (!cancelled) {
          setSummary(localSummary(collected, sessionTopic));
          setFromAi(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })().catch(() => { if (!cancelled) setError('Could not open your saved session.'); });

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [db, id]);

  const finish = useCallback(async () => {
    if (!id || finishing) return;
    setFinishing(true);

    setError('');
    try {
      const session = await sessionById(db, id);
      if (!session) throw new Error('Session unavailable');
      if (summary?.realWorldChallenge) {
        await assignChallenge(db, id, session.rotationDay, summary.realWorldChallenge);
      }
      await advanceStage(db, session, { stage: STAGE, result: { confidence, weeklyReview: Boolean(review) } });
      await finishSession(db, session);
      router.replace(`/session/${id}/complete`);
    } catch {
      setError('Could not finish saving the session. Try again.');
      setFinishing(false);
    }
  }, [confidence, db, finishing, id, review, router, summary]);

  if (loading || !summary || !facts) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        {error ? <Button title="Back to Today" onPress={() => router.replace('/')} /> : <ActivityIndicator color={theme.colors.primary} />}
        <Text variant="small" tone="muted">
          {error || 'Putting your session together…'}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <SessionHeader
        stage={STAGE}
        stageIndex={stageIndex}
        stageCount={stageCount}
        progress={0.9}
        startedAt={startedAt}
        onClose={() => router.replace('/')}
      />

      <ScrollView contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.lg }}>
        <Animated.View entering={FadeIn} style={{ gap: theme.space.lg }}>
          {review && <WeeklyReview examples={review} />}
          <Card>
            <Text variant="caption" tone="faint">
              BEFORE YOU GO
            </Text>
            <Text variant="h3">Two quick questions</Text>
            {summary.retrievalPrompts.map((prompt, position) => (
              <Row key={`${prompt}-${position}`} style={{ alignItems: 'flex-start' }}>
                <Text variant="bodyStrong" tone="primary">
                  {position + 1}.
                </Text>
                <Text variant="body" style={{ flex: 1 }}>
                  {prompt}
                </Text>
              </Row>
            ))}
            <Text variant="caption" tone="faint">
              Answer them in your head. Retrieval is the point, not typing.
            </Text>
          </Card>

          {summary.realWorldChallenge ? (
            <Card>
              <Row>
                <Ionicons name="flag-outline" size={18} color={theme.colors.primary} />
                <Text variant="caption" tone="faint" style={{ flex: 1 }}>
                  BEFORE NEXT SESSION
                </Text>
              </Row>
              <Text variant="h3">{summary.realWorldChallenge}</Text>
              <Text variant="caption" tone="faint">
                However it goes, tell me next time. Not doing it is not a failure.
              </Text>
            </Card>
          ) : null}

          <Card>
            <Text variant="h3">This session</Text>
            <Row>
              <Text variant="small" tone="muted" style={{ flex: 1 }}>
                Phrases reviewed
              </Text>
              <Text variant="smallStrong">{facts.total}</Text>
            </Row>
            <Row>
              <Text variant="small" tone="muted" style={{ flex: 1 }}>
                Produced without help
              </Text>
              <Text variant="smallStrong">{facts.independent}</Text>
            </Row>
            {facts.missed.length > 0 ? (
              <>
                <Text variant="small" tone="muted">
                  Coming back next session:
                </Text>
                <Text variant="small">{facts.missed.join(', ')}</Text>
              </>
            ) : null}
            {summary.recurringErrorNotes.length > 0 ? (
              <>
                <Text variant="small" tone="muted">
                  Worth watching:
                </Text>
                {summary.recurringErrorNotes.map((note) => (
                  <Text key={note} variant="small">
                    • {note}
                  </Text>
                ))}
              </>
            ) : null}
            {!fromAi ? (
              <Text variant="caption" tone="faint">
                Built from your saved session data; the AI summary was unavailable.
              </Text>
            ) : null}
          </Card>

          <Card>
            <Text variant="h3">How did that feel?</Text>
            <Text variant="small" tone="muted">
              Optional, and only you see it.
            </Text>
            <Row style={{ gap: theme.space.sm }}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Chip
                  key={value}
                  label={String(value)}
                  selected={confidence === value}
                  onPress={() => setConfidence(value)}
                />
              ))}
            </Row>
            <Row>
              <Text variant="caption" tone="faint" style={{ flex: 1 }}>
                1 = struggled
              </Text>
              <Text variant="caption" tone="faint">
                5 = comfortable
              </Text>
            </Row>
          </Card>

          {error ? <Text tone="danger" accessibilityRole="alert">{error}</Text> : null}
          <Button title="Finish session" loading={finishing} onPress={() => void finish()} />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function WeeklyReview({ examples }: { examples: Awaited<ReturnType<typeof readReviewExamples>> }) {
  const labels = { recall: 'Recall', gist: 'Listening gist', writing: 'Writing', roleplay: 'Role-play' } as const;
  return (
    <Card>
      <Text variant="h2">Day 7 · Mixed review</Text>
      <Text tone="muted">Compare examples from your first session and today. Where did you find words more easily? What would you try again?</Text>
      {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => (
        <View key={key}>
          <Text variant="bodyStrong">{labels[key]}</Text>
          <Text variant="small" tone="muted">Day 1 · {examples.earlier?.[key] ?? 'No saved example'}</Text>
          <Text variant="small">Today · {examples.current?.[key] ?? 'No saved example'}</Text>
        </View>
      ))}
    </Card>
  );
}

/** The whole summary, built from the database when the model is unavailable. */
function localSummary(facts: SessionFacts, topic: RotationTopic): SessionSummary {
  const prompts: string[] = [];
  const first = facts.meanings[0];
  const second = facts.meanings[1];
  if (first) prompts.push(`How do you say "${first}" without looking?`);
  if (second && second !== first) prompts.push(`And "${second}"?`);
  if (prompts.length < 2) prompts.push('What is one Dutch phrase you could use in a conversation like today’s?');
  if (prompts.length < 2) prompts.push('How would you ask a follow-up question in Dutch?');

  return {
    retrievalPrompts: prompts.slice(0, 2),
    realWorldChallenge: topic.challenge,
    recurringErrorNotes: facts.corrections.slice(0, 2),
    speakingSuccess: '',
    speakingObstacle: '',
    nextSessionPriority: facts.missed.length
      ? `Re-drill: ${facts.missed.slice(0, 3).join(', ')}`
      : 'Keep going with the rotation.',
  };
}
