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

import { getPhrase, recordReview, selectForRecall } from '@/db/repo/phrases';
import { currentDayKey, getProfile, type LearnerProfile } from '@/db/repo/profile';
import { completeRound, getLatestCheckpoint, getStages, saveCheckpoint } from '@/db/repo/sessions';
import { awardXp, comboBonus, comboMultiplier, tallyReview, XP } from '@/gamification/xp';
import { play, playRecallOutcome } from '@/audio/sfx';
import { advanceStage, sessionById } from '@/session/engine';
import { recallItemCount, roundsForStage } from '@/session/plan';
import { buildRound, evaluateAnswer, type RecallCheckpoint, RecallCheckpointSchema, type RecallPrompt } from '@/session/recall';
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
  /** Consecutive unprompted answers. A hint or a miss resets it. */
  const [comboRun, setComboRun] = useState(0);
  /** XP for the answer just graded, shown beside the verdict. */
  const [lastAward, setLastAward] = useState(0);
  const [roundCorrect, setRoundCorrect] = useState(0);
  const [roundTotal, setRoundTotal] = useState(0);
  const [showRoundSummary, setShowRoundSummary] = useState(false);
  const [problem, setProblem] = useState('');

  // Set when an item is first shown; reading the clock during render is impure.
  const shownAtRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);
  const actionRef = useRef(false);
  const baseReviews = useRef(0);

  // One `now` per round, so FSRS scheduling inside a round is deterministic.
  const roundNowRef = useRef<Date | null>(null);

  const current = queue[index];

  /* Load ------------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!id) return;
      const session = await sessionById(db, id);
      if (cancelled) return;
      if (!session) throw new Error('Session unavailable');

      const [loadedProfile, stageRows, saved, reviewCount] = await Promise.all([
        getProfile(db),
        getStages(db, id), getLatestCheckpoint(db, id),
        db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM phrase_reviews WHERE session_id = ? AND stage = ?', [id, STAGE]),
      ]);
      const checkpoint = RecallCheckpointSchema.safeParse(saved?.stage === STAGE ? saved.state : null);
      const prior = checkpoint.success ? checkpoint.data : null;
      const phrases = prior ? (await Promise.all(prior.phraseIds.map((phraseId) => getPhrase(db, phraseId))))
        : await selectForRecall(db, { limit: recallItemCount(session.durationMode), now: new Date(), preferTags: topicByKey(session.topicKey)?.tags });
      const available = phrases.filter((phrase) => phrase !== null);
      if (prior && available.length !== prior.phraseIds.length) throw new Error('A saved phrase is unavailable');
      if (cancelled) return;

      const rounds = roundsForStage(session.durationMode, STAGE);
      let remaining = available.length;
      const sizes = prior?.roundSizes ?? rounds.map((round) => {
        const size = Math.min(remaining, round.items);
        remaining -= size;
        return size;
      }).filter(Boolean);
      const count = reviewCount?.count ?? 0;
      baseReviews.current = prior?.baseReviews ?? count;
      const resumeIndex = Math.min(available.length, Math.max(prior?.index ?? 0, count - baseReviews.current));
      let start = 0;
      const resumeRound = sizes.findIndex((size) => {
        start += size;
        return resumeIndex < start;
      });
      if (!prior) await saveCheckpoint(db, id, STAGE, null, {
        phraseIds: available.map((phrase) => phrase.id), roundSizes: sizes, index: resumeIndex,
        baseReviews: baseReviews.current, hintsUsed: 0, revealed: false, answer: '',
      });
      if (cancelled) return;

      setProfile(loadedProfile);
      setTopic(topicByKey(session.topicKey) ?? topicFor(session.sessionNumber));
      setQueue(buildRound(available, 0));
      setIndex(resumeIndex);
      setRoundIndex(resumeRound < 0 ? Math.max(0, sizes.length - 1) : resumeRound);
      setRoundSizes(sizes);
      setStageCount(stageRows.length);
      setRoundTotal(sizes[resumeRound] ?? 0);
      if (prior && resumeIndex === prior.index) {
        setHintsUsed(prior.hintsUsed);
        setRevealed(prior.revealed);
        setAnswer(prior.answer);
      }
      setLoading(false);
      roundNowRef.current = new Date();
      shownAtRef.current = Date.now();
    })().catch(() => {
      if (!cancelled) { setProblem('Could not restore your recall prompts.'); setLoading(false); }
    });

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

  const checkpoint = useCallback((patch: Partial<RecallCheckpoint> = {}) => saveCheckpoint(db, id, STAGE, null, {
    phraseIds: queue.map((prompt) => prompt.phrase.id), roundSizes, index, baseReviews: baseReviews.current,
    hintsUsed, revealed, answer, ...patch,
  }), [answer, db, hintsUsed, id, index, queue, revealed, roundSizes]);

  /* Actions ---------------------------------------------------------------- */

  const useHint = useCallback(async () => {
    if (!current || verdict || actionRef.current) return;
    if (hintsUsed >= current.hints.length) return;
    tapFeedback();
    actionRef.current = true;
    try { await checkpoint({ hintsUsed: hintsUsed + 1 }); setHintsUsed(hintsUsed + 1); }
    catch { setProblem('Could not save hint use. Try again.'); }
    finally { actionRef.current = false; }
  }, [checkpoint, current, hintsUsed, verdict]);

  const reveal = useCallback(async () => {
    if (!current || verdict || actionRef.current) return;
    warningFeedback();
    actionRef.current = true;
    try { await checkpoint({ revealed: true }); setRevealed(true); }
    catch { setProblem('Could not save this attempt. Try again.'); }
    finally { actionRef.current = false; }
  }, [checkpoint, current, verdict]);

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

      const kind =
        status === 'independent'
          ? 'RECALL_INDEPENDENT'
          : status === 'prompted'
            ? 'RECALL_PROMPTED'
            : 'RECALL_MISSED';

      // The run of unprompted answers this is part of. Taking a hint or missing
      // resets it, but neither ever costs XP -- the bonus rewards the brave answer
      // rather than punishing the careful one.
      const run = status === 'independent' ? comboRun + 1 : 0;
      setComboRun(run);

      let earned = 0;
      let bonusEarned = 0;
      /** The loudest thing that happened; only that gets a sound. */
      let crossed: 'levelup' | 'goal' | null = null;

      try {
        await tallyReview(db, dayKey, status === 'independent');
        if (status !== 'not_tested') {
          const award = await awardXp(db, dayKey, {
            kind, sessionId: id, stage: STAGE, refId: current.phrase.id,
            dedupeKey: `recall:${id}:${roundIndex}:${current.phrase.id}`,
          });
          earned += award.awarded;
          if (award.justLeveled) crossed = 'levelup';
          else if (award.justMetGoal) crossed = 'goal';

          // Booked as its own event rather than folded into the award above, so the
          // history stays readable ("6 + 2 bonus") and the bonus gets its own daily
          // ceiling instead of competing with the recall one.
          const extra = status === 'independent' ? comboBonus(XP.RECALL_INDEPENDENT, run) : 0;
          if (extra > 0) {
            const bonus = await awardXp(db, dayKey, {
              kind: 'COMBO_BONUS', amount: extra, sessionId: id, stage: STAGE,
              refId: current.phrase.id,
              dedupeKey: `combo:${id}:${roundIndex}:${current.phrase.id}`,
            });
            bonusEarned = bonus.awarded;
            earned += bonus.awarded;
            if (bonus.justLeveled) crossed = 'levelup';
            else if (bonus.justMetGoal && crossed === null) crossed = 'goal';
          }

          setRoundXp((xp) => xp + earned);
          setLastAward(earned);
        }
      } catch {
        setProblem('Your answer is saved. The practice totals could not be updated.');
      }

      if (status === 'independent') {
        setRoundCorrect((correct) => correct + 1);
        successFeedback();
      }

      // One sound per answer. Crossing a level or the daily goal is the bigger news,
      // so it replaces the per-answer sound instead of stacking on top of it.
      if (crossed) {
        play(crossed);
      } else if (status !== 'not_tested') {
        playRecallOutcome({
          independent: status === 'independent',
          prompted: status === 'prompted',
          comboBonus: bonusEarned > 0,
        });
      }

      setVerdict({ ...outcome, status });
    },
    [answer, comboRun, current, db, hintsUsed, id, revealed, roundIndex]
  );

  const check = useCallback(async () => {
    if (!current || !profile || !topic || actionRef.current) return;
    const trimmed = answer.trim();
    if (!trimmed) return;

    setChecking(true);
    actionRef.current = true;
    setProblem('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await checkpoint({ answer: trimmed });
      const outcome = await evaluateAnswer(db, {
        prompt: current,
        answer: trimmed,
        profile,
        topic,
        sessionId: id ?? null,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

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
    } catch {
      if (!controller.signal.aborted) setProblem('Could not save your answer. Try again.');
    } finally {
      actionRef.current = false;
      setChecking(false);
    }
  }, [answer, current, checkpoint, commit, db, hintsUsed, id, profile, revealed, topic]);

  const selfGrade = useCallback(
    async (rating: 'got_it' | 'needed_help' | 'missed') => {
      if (!current || actionRef.current) return;
      actionRef.current = true;
      const status = deriveStatus({
        aiAccepted: null,
        selfRated: rating,
        hintCount: hintsUsed,
        revealed,
        promptKind: current.kind,
      });
      try { await commit(status, {
        accepted: rating !== 'missed',
        explanation: '',
        suggestedAnswer: current.target,
        needsSelfGrade: false,
        error: null,
      }); } catch { setProblem('Could not save your answer. Try again.'); }
      finally { actionRef.current = false; }
    },
    [commit, current, hintsUsed, revealed]
  );

  const next = useCallback(async () => {
    if (!current || !id || actionRef.current) return;
    actionRef.current = true;
    try {

    // A missed phrase comes back later in this round (spec section 6). The next
    // session is handled separately by the relearn flag.
    const requeue = verdict?.status === 'missed' && queue.filter((prompt) => prompt.phrase.id === current.phrase.id).length === 1;
    const nextQueue = requeue ? [...queue, { ...current, hints: current.hints }] : queue;
    const nextSizes = requeue ? roundSizes.map((size, position) => position === roundSizes.length - 1 ? size + 1 : size) : roundSizes;

    const nextIndex = index + 1;
    const endOfRound = nextIndex - roundStart >= (nextSizes[roundIndex] ?? currentRoundSize);
    await checkpoint({ index: nextIndex, phraseIds: nextQueue.map((prompt) => prompt.phrase.id),
      roundSizes: nextSizes, hintsUsed: 0, revealed: false, answer: '' });

    setVerdict(null);
    setAnswer('');
    setHintsUsed(0);
    setRevealed(false);
    setQueue(nextQueue);
    setRoundSizes(nextSizes);
    setRoundTotal(nextSizes[roundIndex] ?? 0);
    shownAtRef.current = Date.now();

    if (endOfRound) {
      await completeRound(db, id, STAGE, roundIndex);
      setShowRoundSummary(true);
      return;
    }
    setIndex(nextIndex);
    } catch { setProblem('Could not save your progress. Try again.'); }
    finally { actionRef.current = false; }
  }, [checkpoint, current, currentRoundSize, db, id, index, queue, roundIndex, roundSizes, roundStart, verdict]);

  const continueFromRound = useCallback(async () => {
    if (!id || actionRef.current) return;
    actionRef.current = true;
    try {
    const session = await sessionById(db, id);
    if (!session) return;

    const lastRound = roundIndex >= roundSizes.length - 1;
    const exhausted = index + 1 >= queue.length;

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
    setComboRun(0);
    setLastAward(0);
    setRoundCorrect(0);
    setRoundTotal(Math.min(roundSizes[roundIndex + 1] ?? 0, queue.length - (index + 1)));
    shownAtRef.current = Date.now();
    } catch { setProblem('Could not save the round. Try again.'); }
    finally { actionRef.current = false; }
  }, [db, id, index, queue, roundCorrect, roundIndex, roundSizes, router]);

  const close = useCallback(async () => {
    if (id && !actionRef.current && !showRoundSummary && !verdict) {
      try { await checkpoint(); }
      catch { setProblem('Could not save your progress. Try again.'); return; }
    }
    await stopSpeaking();
    router.replace('/');
  }, [checkpoint, id, router, showRoundSummary, verdict]);

  const skipStage = useCallback(async () => {
    if (!id) return;
    abortRef.current?.abort();
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

  if (showRoundSummary && !problem) {
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
          {problem || (queue.length ? 'Recall answers saved' : 'Nothing to review yet')}
        </Text>
        <Text variant="small" tone="muted" center>
          {queue.length ? 'Continue to the next stage.' : 'Add phrases in the Dictionary tab to practise them.'}
        </Text>
        {problem && !queue.length ? (
          <Button title="Back to Today" onPress={() => router.replace('/')} />
        ) : (
          <Button title="Continue" onPress={() => void (queue.length ? continueFromRound() : skipStage())} />
        )}
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
        {problem ? <Text tone="danger" accessibilityRole="alert">{problem}</Text> : null}
        {showRoundSummary ? <Button title="Continue" onPress={() => void continueFromRound()} /> : null}
        <Card>
          <Text variant="caption" tone="faint">
            {current.instruction.toUpperCase()}
          </Text>
          <Text variant="h2">{current.text}</Text>

          {hintsUsed > 0 ? (
            <Animated.View entering={FadeIn} style={{ gap: theme.space.xs }}>
              {current.hints.slice(0, hintsUsed).map((hint) => (
                <Row key={hint} gap={6}>
                  <Ionicons name="bulb-outline" size={15} color={theme.colors.streakText} />
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

        {/*
          The run, and what the last answer paid. This is the only thing on the screen
          with stakes inside the round: something to build, and something to lose.
        */}
        {comboRun >= 2 || (lastAward > 0 && verdict) ? (
          <Row style={{ gap: theme.space.sm }}>
            {comboRun >= 2 ? (
              <Chip
                label={
                  comboMultiplier(comboRun) > 1
                    ? `${comboRun} in a row · ×${comboMultiplier(comboRun)}`
                    : `${comboRun} in a row`
                }
                tone="streak"
                leading={<Ionicons name="flame" size={13} color={theme.colors.streakText} />}
              />
            ) : null}
            {lastAward > 0 && verdict ? <Chip label={`+${lastAward} XP`} tone="success" /> : null}
          </Row>
        ) : null}

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
  const tone = verdict.status === 'independent' ? theme.colors.success : good ? theme.colors.streakText : theme.colors.danger;

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
