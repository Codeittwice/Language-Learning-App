/**
 * The recall stage: retrieve six to eight due or weak phrases.
 *
 * Shape of one item: see the cue, type the Dutch, get judged, see the verdict. Hints
 * are available but each one costs `independent`, which the UI says plainly rather
 * than hiding.
 *
 * Nothing here can dead-end. If the model is unavailable the learner self-grades, and
 * that path is also the offline path and the rate-limited path.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { clearRelearnFlags, recordReview, selectForRecall } from '@/db/repo/phrases';
import { currentDayKey, getProfile, type LearnerProfile } from '@/db/repo/profile';
import { saveCheckpoint } from '@/db/repo/sessions';
import { awardXp, tallyReview } from '@/gamification/xp';
import { advanceStage, sessionById } from '@/session/engine';
import { recallItemCount, roundsForStage, stagesFor } from '@/session/plan';
import { buildRound, evaluateAnswer, type RecallPrompt } from '@/session/recall';
import { topicByKey, topicFor, type RotationTopic } from '@/session/rotation';
import { deriveStatus, explainStatus, gradeFromStatus } from '@/srs/grading';
import { stopSpeaking } from '@/speech/tts';
import { useTheme } from '@/theme/use-theme';
import { Button, Chip, successFeedback, tapFeedback, warningFeedback } from '@/ui/button';
import { RoundComplete } from '@/ui/celebrate';
import { SessionHeader } from '@/ui/session-header';
import { SpeakButton } from '@/ui/speak-button';
import { Card, Row } from '@/ui/surface';
import { Text } from '@/ui/text';
import type { RecallStatus, SessionStage } from '@/types';

type Verdict = {
  status: RecallStatus;
  accepted: boolean;
  explanation: string;
  suggestedAnswer: string;
  needsSelfGrade: boolean;
  error: string | null;
};

const STAGE: SessionStage = 'recall';

export default function RecallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();

  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [topic, setTopic] = useState<RotationTopic | null>(null);
  const [queue, setQueue] = useState<RecallPrompt[]>([]);
  const [index, setIndex] = useState(0);
  const [roundIndex, setRoundIndex] = useState(0);
  const [roundSizes, setRoundSizes] = useState<number[]>([]);
  const [stageCount, setStageCount] = useState(4);
  const [loading, setLoading] = useState(true);
  const [startedAt] = useState(() => Date.now());

  const [answer, setAnswer] = useState('');
  const [hintsUsed, setHintsUsed] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const [roundXp, setRoundXp] = useState(0);
  const [roundCorrect, setRoundCorrect] = useState(0);
  const [roundTotal, setRoundTotal] = useState(0);
  const [showRoundSummary, setShowRoundSummary] = useState(false);

  // Set when an item is first shown; reading the clock during render is impure.
  const shownAtRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  // One `now` per round, so FSRS scheduling inside a round is deterministic.
  const roundNowRef = useRef<Date | null>(null);

  const current = queue[index];

  /* Load ------------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!id) return;
      const session = await sessionById(db, id);
      if (!session || cancelled) return;

      const [loadedProfile, phrases] = await Promise.all([
        getProfile(db),
        selectForRecall(db, {
          limit: recallItemCount(session.durationMode),
          now: new Date(),
          preferTags: topicByKey(session.topicKey)?.tags,
        }),
      ]);
      if (cancelled) return;

      const rounds = roundsForStage(session.durationMode, STAGE);
      const sizes = rounds.map((round) => round.items);

      setProfile(loadedProfile);
      setTopic(topicByKey(session.topicKey) ?? topicFor(session.sessionNumber));
      setQueue(buildRound(phrases, 0));
      setRoundSizes(sizes);
      setStageCount(stagesFor(session.durationMode).length);
      setRoundTotal(Math.min(sizes[0] ?? phrases.length, phrases.length));
      setLoading(false);
      roundNowRef.current = new Date();
      shownAtRef.current = Date.now();
    })();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      void stopSpeaking();
    };
  }, [db, id]);

  /* Where are we in the round? --------------------------------------------- */

  const roundStart = useMemo(
    () => roundSizes.slice(0, roundIndex).reduce((sum, size) => sum + size, 0),
    [roundSizes, roundIndex]
  );
  const positionInRound = index - roundStart;
  const currentRoundSize = Math.min(
    roundSizes[roundIndex] ?? queue.length,
    Math.max(1, queue.length - roundStart)
  );
  const progress = currentRoundSize > 0 ? positionInRound / currentRoundSize : 0;

  /* Actions ---------------------------------------------------------------- */

  const useHint = useCallback(() => {
    if (!current || verdict) return;
    if (hintsUsed >= current.hints.length) return;
    tapFeedback();
    setHintsUsed((used) => used + 1);
  }, [current, hintsUsed, verdict]);

  const reveal = useCallback(() => {
    if (!current || verdict) return;
    warningFeedback();
    setRevealed(true);
  }, [current, verdict]);

  /** Write the attempt, update the schedule and award XP. */
  const commit = useCallback(
    async (status: RecallStatus, outcome: Omit<Verdict, 'status'>) => {
      if (!current || !id) return;

      const latency = Date.now() - shownAtRef.current;
      const grade = gradeFromStatus(status, hintsUsed, latency);
      const dayKey = await currentDayKey(db);

      await recordReview(
        db,
        {
          phraseId: current.phrase.id,
          sessionId: id,
          stage: STAGE,
          promptKind: current.kind,
          promptText: current.text,
          learnerAnswer: answer.trim() || null,
          hintCount: hintsUsed,
          revealed,
          status,
          grade,
          gradedBy: outcome.needsSelfGrade ? 'self' : outcome.error ? 'local' : 'ai',
          aiAccepted: outcome.needsSelfGrade ? null : outcome.accepted,
          aiExplanation: outcome.explanation || null,
          suggestedAnswer: outcome.suggestedAnswer,
          alternatives: [],
          latencyMs: latency,
          dayKey,
        },
        // One clock per round keeps scheduling within a round deterministic.
        roundNowRef.current ?? new Date()
      );

      await tallyReview(db, dayKey, status === 'independent');

      const kind =
        status === 'independent'
          ? 'RECALL_INDEPENDENT'
          : status === 'prompted'
            ? 'RECALL_PROMPTED'
            : 'RECALL_MISSED';

      if (status !== 'not_tested') {
        const award = await awardXp(db, dayKey, {
          kind,
          sessionId: id,
          stage: STAGE,
          refId: current.phrase.id,
          // Keyed per phrase per round, so a remount cannot double-credit.
          dedupeKey: `recall:${id}:${roundIndex}:${current.phrase.id}`,
        });
        setRoundXp((xp) => xp + award.awarded);
      }

      if (status === 'independent') {
        setRoundCorrect((correct) => correct + 1);
        successFeedback();
      }

      setVerdict({ ...outcome, status });
    },
    [answer, current, db, hintsUsed, id, revealed, roundIndex]
  );

  const check = useCallback(async () => {
    if (!current || !profile || !topic || checking) return;
    const trimmed = answer.trim();
    if (!trimmed) return;

    setChecking(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const outcome = await evaluateAnswer(db, {
        prompt: current,
        answer: trimmed,
        profile,
        topic,
        sessionId: id ?? null,
        signal: controller.signal,
      });

      if (outcome.needsSelfGrade) {
        // Offer the three self-grade buttons rather than guessing.
        setVerdict({
          status: 'missed',
          accepted: false,
          explanation: '',
          suggestedAnswer: outcome.suggestedAnswer,
          needsSelfGrade: true,
          error: outcome.error,
        });
        return;
      }

      const status = deriveStatus({
        aiAccepted: outcome.aiAccepted,
        selfRated: null,
        localAccepted: outcome.accepted,
        hintCount: hintsUsed,
        revealed,
        promptKind: current.kind,
      });

      await commit(status, {
        accepted: outcome.accepted,
        explanation: outcome.explanation,
        suggestedAnswer: outcome.suggestedAnswer,
        needsSelfGrade: false,
        error: outcome.error,
      });
    } finally {
      setChecking(false);
    }
  }, [answer, current, checking, commit, db, hintsUsed, id, profile, revealed, topic]);

  const selfGrade = useCallback(
    async (rating: 'got_it' | 'needed_help' | 'missed') => {
      if (!current) return;
      const status = deriveStatus({
        aiAccepted: null,
        selfRated: rating,
        hintCount: hintsUsed,
        revealed,
        promptKind: current.kind,
      });
      await commit(status, {
        accepted: rating !== 'missed',
        explanation: '',
        suggestedAnswer: current.target,
        needsSelfGrade: false,
        error: null,
      });
    },
    [commit, current, hintsUsed, revealed]
  );

  const next = useCallback(async () => {
    if (!current || !id) return;

    // A missed phrase comes back later in this round (spec section 6). The next
    // session is handled separately by the relearn flag.
    const requeue = verdict?.status === 'missed';
    const nextQueue = requeue ? [...queue, { ...current, hints: current.hints }] : queue;

    const nextIndex = index + 1;
    const endOfRound = nextIndex - roundStart >= currentRoundSize;

    setVerdict(null);
    setAnswer('');
    setHintsUsed(0);
    setRevealed(false);
    setQueue(nextQueue);
    shownAtRef.current = Date.now();

    await saveCheckpoint(db, id, STAGE, null, { index: nextIndex, roundIndex });

    if (endOfRound) {
      setShowRoundSummary(true);
      return;
    }
    setIndex(nextIndex);
  }, [current, currentRoundSize, db, id, index, queue, roundIndex, roundStart, verdict]);

  const continueFromRound = useCallback(async () => {
    if (!id) return;
    const session = await sessionById(db, id);
    if (!session) return;

    const lastRound = roundIndex >= roundSizes.length - 1;
    const exhausted = index + 1 >= queue.length;

    // Clear the relearn flags for everything this stage drilled.
    await clearRelearnFlags(
      db,
      queue.map((prompt) => prompt.phrase.id)
    );

    if (lastRound || exhausted) {
      const nextStage = await advanceStage(db, session, {
        stage: STAGE,
        result: { reviewed: queue.length, correct: roundCorrect },
      });
      router.replace(nextStage ? `/session/${id}` : `/session/${id}/complete`);
      return;
    }

    roundNowRef.current = new Date();
    setRoundIndex((value) => value + 1);
    setIndex(index + 1);
    setShowRoundSummary(false);
    setRoundXp(0);
    setRoundCorrect(0);
    setRoundTotal(Math.min(roundSizes[roundIndex + 1] ?? 0, queue.length - (index + 1)));
    shownAtRef.current = Date.now();
  }, [db, id, index, queue, roundCorrect, roundIndex, roundSizes, router]);

  const close = useCallback(async () => {
    if (id) await saveCheckpoint(db, id, STAGE, null, { index, roundIndex });
    await stopSpeaking();
    router.replace('/');
  }, [db, id, index, roundIndex, router]);

  const skipStage = useCallback(async () => {
    if (!id) return;
    const session = await sessionById(db, id);
    if (!session) return;
    const nextStage = await advanceStage(db, session, { stage: STAGE, skipped: true });
    router.replace(nextStage ? `/session/${id}` : `/session/${id}/complete`);
  }, [db, id, router]);

  /* Render ------------------------------------------------------------------ */

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (showRoundSummary) {
    return (
      <RoundComplete
        xpEarned={roundXp}
        correct={roundCorrect}
        total={Math.max(roundTotal, 1)}
        perfect={roundCorrect >= roundTotal && roundTotal > 0}
        onContinue={() => void continueFromRound()}
      />
    );
  }

  if (!current) {
    return (
      <View style={{ flex: 1, padding: theme.space.xl, gap: theme.space.lg, justifyContent: 'center' }}>
        <Text variant="h3" center>
          Nothing to review yet
        </Text>
        <Text variant="small" tone="muted" center>
          Add some phrases in the Dictionary tab, then come back.
        </Text>
        <Button title="Continue" onPress={() => void skipStage()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <SessionHeader
        stage={STAGE}
        stageIndex={0}
        stageCount={stageCount}
        progress={progress}
        startedAt={startedAt}
        onClose={() => void close()}
        onSkip={() => void skipStage()}
      />

      <ScrollView
        contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <Card>
          <Text variant="caption" tone="faint">
            {current.instruction.toUpperCase()}
          </Text>
          <Text variant="h2">{current.text}</Text>

          {hintsUsed > 0 ? (
            <Animated.View entering={FadeIn} style={{ gap: theme.space.xs }}>
              {current.hints.slice(0, hintsUsed).map((hint) => (
                <Row key={hint} gap={6}>
                  <Ionicons name="bulb-outline" size={15} color={theme.colors.streak} />
                  <Text variant="small" tone="muted" style={{ flex: 1 }}>
                    {hint}
                  </Text>
                </Row>
              ))}
            </Animated.View>
          ) : null}

          {revealed ? (
            <Animated.View entering={FadeIn}>
              <Text variant="dutch" tone="accent">
                {current.target}
              </Text>
            </Animated.View>
          ) : null}
        </Card>

        {!verdict ? (
          <>
            <TextInput
              value={answer}
              onChangeText={setAnswer}
              placeholder="Type it in Dutch"
              placeholderTextColor={theme.colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              editable={!checking}
              onSubmitEditing={() => void check()}
              style={{
                minHeight: 80,
                color: theme.colors.text,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                padding: theme.space.md,
                fontSize: 18,
                textAlignVertical: 'top',
              }}
            />

            <Row style={{ flexWrap: 'wrap', gap: theme.space.sm }}>
              <Chip
                label={hintsUsed < current.hints.length ? 'Hint' : 'No more hints'}
                tone="streak"
                onPress={hintsUsed < current.hints.length ? useHint : undefined}
              />
              <Chip label="Show answer" onPress={reveal} />
              <Chip
                label="Skip"
                onPress={() => {
                  void commit('not_tested', {
                    accepted: false,
                    explanation: '',
                    suggestedAnswer: current.target,
                    needsSelfGrade: false,
                    error: null,
                  });
                }}
              />
            </Row>

            {hintsUsed > 0 || revealed ? (
              <Text variant="caption" tone="faint">
                With help, this counts as prompted rather than independent.
              </Text>
            ) : null}

            <Button
              title="Check"
              loading={checking}
              disabled={!answer.trim()}
              onPress={() => void check()}
            />
          </>
        ) : (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={{ gap: theme.space.lg }}>
            <VerdictCard verdict={verdict} target={current.target} hintsUsed={hintsUsed} revealed={revealed} />

            {verdict.needsSelfGrade ? (
              <View style={{ gap: theme.space.sm }}>
                <Text variant="small" tone="muted">
                  {verdict.error} Grade it yourself and carry on.
                </Text>
                <Button title="Got it" onPress={() => void selfGrade('got_it')} />
                <Button
                  title="Needed help"
                  variant="secondary"
                  onPress={() => void selfGrade('needed_help')}
                />
                <Button
                  title="Missed it"
                  variant="danger"
                  onPress={() => void selfGrade('missed')}
                />
              </View>
            ) : (
              <Button title="Next" onPress={() => void next()} />
            )}
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

function VerdictCard({
  verdict,
  target,
  hintsUsed,
  revealed,
}: {
  verdict: Verdict;
  target: string;
  hintsUsed: number;
  revealed: boolean;
}) {
  const theme = useTheme();

  if (verdict.needsSelfGrade) {
    return (
      <Card>
        <Text variant="caption" tone="faint">
          THE PHRASE WAS
        </Text>
        <Row>
          <Text variant="dutch" style={{ flex: 1 }}>
            {target}
          </Text>
          <SpeakButton text={target} />
        </Row>
      </Card>
    );
  }

  const good = verdict.status === 'independent' || verdict.status === 'prompted';
  const tone = verdict.status === 'independent' ? theme.colors.success : good ? theme.colors.streak : theme.colors.danger;

  return (
    <Card>
      <Row>
        <Ionicons
          name={good ? 'checkmark-circle' : 'close-circle'}
          size={22}
          color={tone}
        />
        <Text variant="bodyStrong" style={{ color: tone, flex: 1 }}>
          {verdict.status === 'independent'
            ? 'Spot on'
            : verdict.status === 'prompted'
              ? 'Correct, with help'
              : verdict.status === 'not_tested'
                ? 'Skipped'
                : 'Not this time'}
        </Text>
      </Row>

      <Row>
        <Text variant="dutch" style={{ flex: 1 }}>
          {verdict.suggestedAnswer || target}
        </Text>
        <SpeakButton text={verdict.suggestedAnswer || target} />
      </Row>

      {verdict.explanation ? (
        <Text variant="small" tone="muted">
          {verdict.explanation}
        </Text>
      ) : null}

      <Text variant="caption" tone="faint">
        {explainStatus(verdict.status, {
          aiAccepted: verdict.accepted,
          selfRated: null,
          hintCount: hintsUsed,
          revealed,
          promptKind: 'en_to_nl',
        })}
      </Text>
    </Card>
  );
}
