/**
 * Friend Mode: casual conversation with minimal correction.
 *
 * The quiz framing is dropped entirely here. Replies stream in so the conversation
 * feels alive rather than arriving as a block, and the spec's support controls --
 * Nog een keer, Langzamer, Simpeler, Hint, English -- are buttons rather than
 * commands the learner has to remember to type.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { aiStream } from '@/ai/call';
import { AiError } from '@/ai/errors';
import { friendModePrompt, phraseContext, tutorSystemPrompt } from '@/ai/prompts';
import type { ChatMessage } from '@/ai/types';
import { selectForRecall } from '@/db/repo/phrases';
import { currentDayKey, getProfile } from '@/db/repo/profile';
import { appendTurn, readConversation } from '@/db/repo/messages';
import { getStages, saveCheckpoint } from '@/db/repo/sessions';
import { awardXp } from '@/gamification/xp';
import { advanceStage, sessionById } from '@/session/engine';
import { roundsForStage } from '@/session/plan';
import { topicByKey, topicFor, type RotationTopic } from '@/session/rotation';
import { speakDutch, stopSpeaking } from '@/speech/tts';
import { useTheme } from '@/theme/use-theme';
import { Button, Chip, tapFeedback } from '@/ui/button';
import { SessionHeader } from '@/ui/session-header';
import { SpeakButton } from '@/ui/speak-button';
import { Row } from '@/ui/surface';
import { Text } from '@/ui/text';
import type { SessionStage } from '@/types';

const STAGE: SessionStage = 'casual_conversation';

/** Rolling window. The whole transcript is never sent -- cost grows, quality does not. */
const CONTEXT_WINDOW = 12;

type Turn = { id: string; role: 'user' | 'assistant'; text: string };

export default function CasualScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();

  const [topic, setTopic] = useState<RotationTopic | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [stageIndex, setStageIndex] = useState(2);
  const [stageCount, setStageCount] = useState(4);
  const [targetTurns, setTargetTurns] = useState(6);
  const [loading, setLoading] = useState(true);
  const [startedAt] = useState(() => Date.now());

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const finishingRef = useRef(false);

  const userTurns = turns.filter((turn) => turn.role === 'user').length;

  /* Load and open the conversation ----------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!id) return;
      const session = await sessionById(db, id);
      if (cancelled) return;
      if (!session) throw new Error('Session unavailable');

      const [loadedProfile, phrases, stageRows, history] = await Promise.all([
        getProfile(db),
        selectForRecall(db, { limit: 8, now: new Date() }),
        getStages(db, id), readConversation(db, id, 'casual'),
      ]);
      if (cancelled) return;

      const sessionTopic = topicByKey(session.topicKey) ?? topicFor(session.sessionNumber);
      const stages = stageRows.map((stage) => stage.stage);
      const rounds = roundsForStage(session.durationMode, STAGE);

      const prompt = [
        tutorSystemPrompt(loadedProfile, sessionTopic),
        '',
        friendModePrompt(sessionTopic),
        '',
        phraseContext(phrases),
      ]
        .filter(Boolean)
        .join('\n');

      setTopic(sessionTopic);
      setTurns(history);
      setSystemPrompt(prompt);
      setStageIndex(Math.max(0, stages.indexOf(STAGE)));
      setStageCount(stages.length);
      setTargetTurns(rounds.reduce((sum, round) => sum + round.items, 0) || 6);
      setLoading(false);
    })().catch(() => { if (!cancelled) setError('Could not open the saved conversation.'); });

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      void stopSpeaking();
    };
  }, [db, id]);

  /** Send a turn and stream the reply. */
  const send = useCallback(
    async (content: string, { persistUser = true }: { persistUser?: boolean } = {}) => {
      if (!id || abortRef.current || finishingRef.current || !systemPrompt) return;
      const trimmed = content.trim();
      if (!trimmed) return;

      setError(null);
      setStreaming(true);
      setPartial('');

      const controller = new AbortController();
      abortRef.current = controller;
      let assembled = '';
      let callId: number | null = null;
      try {
        const history = persistUser
          ? [...turns, await appendTurn(db, id, 'casual', STAGE, 'user', trimmed)] : turns;
        if (persistUser) {
          setTurns(history);
          setDraft('');
        }
        const messages: ChatMessage[] = [
          { role: 'system', content: systemPrompt },
          ...history.slice(-CONTEXT_WINDOW).map((turn) => ({ role: turn.role, content: turn.text })),
        ];
        if (!persistUser) messages.push({ role: 'user', content: trimmed });
        for await (const event of aiStream(db, {
          purpose: 'casual.chat',
          sessionId: id,
          stage: STAGE,
          temperature: 0.8,
          maxTokens: 300,
          signal: controller.signal,
          onCallLogged: (logged) => { callId = logged; },
          messages,
        })) {
          if (event.type === 'delta') {
            assembled += event.text;
            setPartial(assembled);
          } else if (event.type === 'done') {
            assembled = event.text || assembled;
          }
        }

        if (!controller.signal.aborted && assembled.trim()) {
          const saved = await appendTurn(db, id, 'casual', STAGE, 'assistant', assembled.trim(), callId);
          setTurns((previous) => [...previous, saved]);
        }
      } catch (caught) {
        if (!controller.signal.aborted) setError(
          caught instanceof AiError ? caught.userMessage : 'Could not save or load this reply. Try again.'
        );
      } finally {
        setStreaming(false);
        setPartial('');
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [db, id, systemPrompt, turns]
  );

  // Open the conversation once everything is loaded.
  //
  // Deferred by a tick so the request does not set state synchronously inside the
  // effect, which would cascade a render before the first paint. The ref guard keeps
  // it to exactly one opening turn even under strict-mode double invocation.
  const openedRef = useRef(false);
  useEffect(() => {
    if (loading || !topic || openedRef.current || turns.length) return;
    const timer = setTimeout(() => {
      openedRef.current = true;
      void send('Begin het gesprek.', { persistUser: false });
    }, 0);
    return () => clearTimeout(timer);
    // `send` is recreated on every turn; opening must not re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, topic]);

  const finish = useCallback(async (skipped = false) => {
    if (!id || finishingRef.current) return;
    finishingRef.current = true;
    try {
    const session = await sessionById(db, id);
    if (!session) throw new Error('Session unavailable');

    abortRef.current?.abort();
    const dayKey = await currentDayKey(db);
    if (!skipped && userTurns > 0) {
      await awardXp(db, dayKey, {
        kind: 'ROUND_COMPLETE',
        sessionId: id,
        stage: STAGE,
        dedupeKey: `casual:${id}`,
      });
    }

    await saveCheckpoint(db, id, STAGE, null, { turns: userTurns });
    const nextStage = await advanceStage(db, session, {
      stage: STAGE,
      skipped,
      result: { turns: userTurns },
    });
    router.replace(nextStage ? `/session/${id}` : `/session/${id}/complete`);
    } catch {
      setError('Could not finish saving the conversation. Try again.');
    } finally {
      finishingRef.current = false;
    }
  }, [db, id, router, userTurns]);

  if (loading || !topic) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {error ? <Button title="Back to Today" onPress={() => router.replace('/')} /> : <ActivityIndicator color={theme.colors.primary} />}
        {error ? <Text tone="danger">{error}</Text> : null}
      </View>
    );
  }

  const lastAssistant = [...turns].reverse().find((turn) => turn.role === 'assistant');

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SessionHeader
        stage={STAGE}
        stageIndex={stageIndex}
        stageCount={stageCount}
        progress={Math.min(1, userTurns / targetTurns)}
        startedAt={startedAt}
        onClose={() => router.replace('/')}
        onSkip={() => void finish(true)}
      />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.md }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {turns.map((turn) => (
          <Bubble key={turn.id} role={turn.role} text={turn.text} />
        ))}

        {partial ? <Bubble role="assistant" text={partial} pending /> : null}

        {streaming && !partial ? (
          <Row>
            <ActivityIndicator size="small" color={theme.colors.textFaint} />
            <Text variant="small" tone="faint">
              Aan het typen…
            </Text>
          </Row>
        ) : null}

        {error ? (
          <Row>
            <Ionicons name="cloud-offline-outline" size={18} color={theme.colors.danger} />
            <Text variant="small" tone="danger" style={{ flex: 1 }}>
              {error}
            </Text>
          </Row>
        ) : null}
      </ScrollView>

      {/* The spec's support controls, as buttons rather than remembered commands. */}
      <View style={{ paddingHorizontal: theme.space.lg, paddingBottom: theme.space.sm }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Row style={{ gap: theme.space.sm, paddingRight: theme.space.lg }}>
            {lastAssistant ? (
              <Chip
                label="Nog een keer"
                leading={
                  <Ionicons name="volume-low-outline" size={14} color={theme.colors.text} />
                }
                onPress={() => {
                  tapFeedback();
                  void speakDutch(lastAssistant.text);
                }}
              />
            ) : null}
            {lastAssistant ? (
              <Chip
                label="Langzamer"
                onPress={() => {
                  tapFeedback();
                  void speakDutch(lastAssistant.text, { rate: 0.6 });
                }}
              />
            ) : null}
            <Chip label="Simpeler" onPress={() => void send('Kun je dat simpeler zeggen?')} />
            <Chip label="Hint" onPress={() => void send('Geef me een kleine hint.')} />
            <Chip
              label="English"
              onPress={() => void send('Explain that briefly in English, then continue in Dutch.')}
            />
          </Row>
        </ScrollView>
      </View>

      <View
        style={{
          flexDirection: 'row',
          gap: theme.space.sm,
          padding: theme.space.lg,
          paddingTop: theme.space.sm,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          backgroundColor: theme.colors.bg,
          alignItems: 'flex-end',
        }}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Schrijf in het Nederlands…"
          placeholderTextColor={theme.colors.textFaint}
          multiline
          editable={!streaming}
          style={{
            flex: 1,
            maxHeight: 120,
            minHeight: 44,
            color: theme.colors.text,
            backgroundColor: theme.colors.surfaceAlt,
            borderRadius: theme.radius.md,
            paddingHorizontal: theme.space.md,
            paddingTop: 11,
            fontSize: 16,
          }}
        />
        <Button
          title=""
          fullWidth={false}
          size="medium"
          disabled={!draft.trim() || streaming}
          onPress={() => void send(draft)}
          leading={<Ionicons name="arrow-up" size={20} color={theme.colors.onAccent} />}
          style={{ width: 52, paddingHorizontal: 0 }}
        />
      </View>

      {userTurns >= targetTurns ? (
        <View style={{ paddingHorizontal: theme.space.lg, paddingBottom: theme.space.lg }}>
          <Button title="Wrap up" variant="secondary" onPress={() => void finish()} />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function Bubble({
  role,
  text,
  pending = false,
}: {
  role: 'user' | 'assistant';
  text: string;
  pending?: boolean;
}) {
  const theme = useTheme();
  const isUser = role === 'user';

  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '88%',
        backgroundColor: isUser ? theme.colors.primary : theme.colors.surface,
        borderRadius: theme.radius.lg,
        borderBottomRightRadius: isUser ? theme.radius.sm : theme.radius.lg,
        borderBottomLeftRadius: isUser ? theme.radius.lg : theme.radius.sm,
        padding: theme.space.md,
        borderWidth: isUser ? 0 : 1,
        borderColor: theme.colors.border,
        gap: theme.space.xs,
        opacity: pending ? 0.85 : 1,
      }}
    >
      <Text style={{ color: isUser ? theme.colors.onAccent : theme.colors.text, fontSize: 16 }}>
        {text}
      </Text>
      {!isUser && !pending ? (
        <Row style={{ justifyContent: 'flex-end' }}>
          <SpeakButton text={text} size={20} />
        </Row>
      ) : null}
    </Animated.View>
  );
}
