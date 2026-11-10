import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { appendTurn, type ConversationTurn, readConversation } from '@/db/repo/messages';
import { completeRound, getStages, type Session } from '@/db/repo/sessions';
import { advanceStage, sessionById } from '@/session/engine';
import { createRoleplayCorrections, peerReply, readRoleplayCorrections, ROLEPLAY, roleplayPrompt } from '@/session/roleplay';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { SessionHeader } from '@/ui/session-header';
import { SpeakButton } from '@/ui/speak-button';
import { Card, Row, ScreenScroll } from '@/ui/surface';
import { Text } from '@/ui/text';

const ROUND_LABELS = ['Set the scene', 'Handle a change', 'Try a fresh version'];

export default function RoleplayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [position, setPosition] = useState({ index: 3, count: 6 });
  const [startedAt] = useState(() => Date.now());
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [corrections, setCorrections] = useState<Awaited<ReturnType<typeof readRoleplayCorrections>> | null>(null);
  const [retried, setRetried] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const task = useRef<AbortController | null>(null);
  const userTurns = turns.filter((turn) => turn.role === 'user');
  const waiting = turns.at(-1)?.role === 'user';
  const round = userTurns.length - (waiting ? 1 : 0);

  useEffect(() => {
    let active = true;
    void Promise.all([sessionById(db, id), getStages(db, id), readConversation(db, id, 'roleplay'),
      readRoleplayCorrections(db, id), readConversation(db, id, 'roleplay-retry')])
      .then(([current, stages, history, feedback, retry]) => {
        if (!active) return;
        if (!current) throw new Error('Session unavailable');
        setTurns(history);
        if (feedback.length) setCorrections(feedback);
        setRetried(retry.length > 0);
        setPosition({ index: stages.findIndex((stage) => stage.stage === ROLEPLAY), count: stages.length });
        setSession(current);
      }).catch(() => { if (active) setError('Could not open the role-play.'); });
    return () => { active = false; task.current?.abort(); };
  }, [db, id, reload]);

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (task.current) return;
    const controller = new AbortController();
    task.current = controller;
    setBusy(true);
    setError('');
    try { await action(controller.signal); }
    catch { if (!controller.signal.aborted) setError('Could not save your progress. Try again.'); }
    finally {
      if (task.current === controller) { task.current = null; setBusy(false); }
    }
  }

  function send() {
    if (!session || (!waiting && !draft.trim())) return;
    const current = session;
    void run(async (signal) => {
      let history = turns;
      if (!waiting) {
        history = [...turns, await appendTurn(db, id, 'roleplay', ROLEPLAY, 'user', draft.trim())];
        setTurns(history);
        setDraft('');
      }
      let callId: number | null = null;
      const reply = await peerReply(db, current, history, round, signal, (logged) => { callId = logged; });
      signal.throwIfAborted();
      const saved = await appendTurn(db, id, 'roleplay', ROLEPLAY, 'assistant', reply, callId);
      setTurns([...history, saved]);
      await completeRound(db, id, ROLEPLAY, round);
    });
  }

  function finish(skipped: boolean) {
    if (!session) return;
    if (skipped) {
      task.current?.abort();
      task.current = null;
    }
    const current = session;
    void run(async () => {
      await advanceStage(db, current, { stage: ROLEPLAY, skipped,
        result: { rounds: round, retried } });
      router.replace(`/session/${id}`);
    });
  }

  const lastReply = [...turns].reverse().find((turn) => turn.role === 'assistant');
  return (
    <View style={{ flex: 1 }}>
      <SessionHeader stage={ROLEPLAY} stageIndex={position.index} stageCount={position.count}
        progress={round / 3} startedAt={startedAt} onClose={() => router.replace('/')}
        onSkip={session ? () => finish(true) : undefined} />
      <ScreenScroll>
        {error ? <Text tone="danger" accessibilityRole="alert">{error}</Text> : null}
        {!session ? (
          error ? <Button title="Retry" onPress={() => { setError(''); setReload(reload + 1); }} />
            : <Text tone="muted">Opening the role-play…</Text>
        ) : (
          <>
            <Text tone="muted">Fictional role-play · {round < 3 ? `Round ${round + 1} of 3` : 'Review and retry'}</Text>
            {lastReply && !waiting && <Text variant="small" tone="muted">Your partner replied · {lastReply.text}</Text>}
            {round < 3 ? (
              <Card>
                <Text variant="h2">{ROUND_LABELS[round]}</Text>
                <Row><Text style={{ flex: 1 }}>{roleplayPrompt(session, round)}</Text><SpeakButton text={roleplayPrompt(session, round)} /></Row>
                {round === 0 && <Text variant="small" tone="muted">Respond and ask one follow-up question if it fits.</Text>}
                {round === 1 && <Text variant="small" tone="muted">Check what changed, then propose a way forward.</Text>}
                {waiting ? <Text>{userTurns.at(-1)?.text}</Text> : <Field label="Your Dutch reply" value={draft} onChangeText={setDraft} editable={!busy} multiline maxLength={1200} />}
                <Button title={waiting ? 'Get their reply' : 'Send reply'} loading={busy} disabled={!waiting && !draft.trim()} onPress={send} />
              </Card>
            ) : (
              <Card>
                <Text variant="h2">Try one reply again</Text>
                {corrections === null ? (
                  <Button title="Check for feedback" loading={busy}
                    onPress={() => void run(async (signal) => setCorrections(await createRoleplayCorrections(db, session, turns, signal)))} />
                ) : corrections.length ? corrections.map((item) => (
                  <View key={item.id}><Text>{item.original} → {item.corrected}</Text><Text variant="small" tone="muted">{item.explanation}</Text></View>
                )) : <Text tone="muted">Choose one of your replies and try saying it a little differently.</Text>}
                {!retried && corrections !== null && (
                  <>
                    <Field label="Your retry" value={draft} onChangeText={setDraft} editable={!busy} multiline maxLength={1200} />
                    <Button title="Save retry" disabled={!draft.trim()} loading={busy} onPress={() => void run(async () => {
                      await appendTurn(db, id, 'roleplay-retry', ROLEPLAY, 'user', draft.trim());
                      setRetried(true);
                      setDraft('');
                    })} />
                  </>
                )}
                {retried && <Text tone="success">Retry saved.</Text>}
                <Button title="Finish role-play" variant="secondary" disabled={busy || !retried} onPress={() => finish(false)} />
              </Card>
            )}
          </>
        )}
      </ScreenScroll>
    </View>
  );
}
