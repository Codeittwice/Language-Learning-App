import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { getStages, type Session } from '@/db/repo/sessions';
import { advanceStage, sessionById } from '@/session/engine';
import { type Listening, loadListening, recordListeningPlay, saveListening } from '@/session/listening';
import { speakDutch, stopSpeaking } from '@/speech/tts';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { SessionHeader } from '@/ui/session-header';
import { SpeakButton } from '@/ui/speak-button';
import { Card, Row, ScreenScroll } from '@/ui/surface';
import { Text } from '@/ui/text';

export default function ListeningScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [position, setPosition] = useState({ index: 1, count: 6 });
  const [state, setState] = useState<Listening | null>(null);
  const [startedAt] = useState(() => Date.now());
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [heard, setHeard] = useState(false);
  const lock = useRef(false);
  const playback = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const current = await sessionById(db, id);
      if (!current) throw new Error('Session unavailable');
      const stages = await getStages(db, id);
      if (controller.signal.aborted) return;
      setSession(current);
      setPosition({ index: stages.findIndex((stage) => stage.stage === 'listening'), count: stages.length });
      const exercise = await loadListening(db, current, controller.signal);
      if (!controller.signal.aborted) setState(exercise);
    }
    void load().catch(() => {
      if (!controller.signal.aborted) setError('Could not open the listening exercise.');
    });
    return () => {
      controller.abort();
      playback.current += 1;
      void stopSpeaking();
    };
  }, [attempt, db, id]);

  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try { await task(); }
    catch { setError('Could not save your progress. Try again.'); }
    finally { lock.current = false; setBusy(false); }
  }

  async function progress(current: Listening, next: Partial<Listening>) {
    const updated = { ...current, ...next };
    const reveal = updated.source === 'text_only' || updated.step >= 5;
    await saveListening(db, updated, reveal);
    setState(updated);
    setDraft('');
    setHeard(false);
  }

  function play(current: Listening, slow = false) {
    if (playing || lock.current) return;
    const token = ++playback.current;
    setPlaying(true);
    const fail = () => {
      if (token !== playback.current) return;
      playback.current += 1;
      setPlaying(false);
      void run(() => progress(current, { source: 'text_only' }));
    };
    void speakDutch(current.exercise.passageNl, {
      rate: slow ? 0.65 : 1,
      onError: fail,
      onDone: () => {
        if (token === playback.current) {
          setPlaying(false);
          setHeard(true);
          void recordListeningPlay(db, current.id, slow).catch(() => setError('Audio played, but the playback count could not be saved.'));
        }
      },
    }).catch(fail);
  }

  function leave() {
    playback.current += 1;
    void stopSpeaking();
    router.replace('/');
  }

  function finish(skipped: boolean) {
    if (!session) return;
    void run(async () => {
      playback.current += 1;
      await stopSpeaking();
      await advanceStage(db, session, {
        stage: 'listening', skipped,
        result: state && { audioSource: state.source, answers: state.answers },
      });
      router.replace(`/session/${id}`);
    });
  }

  const exercise = state?.exercise;
  const step = state?.step ?? 0;
  const textOnly = state?.source === 'text_only';
  const question = step === 1 ? 'What is this about?' : exercise?.questions[step - 3];

  return (
    <View style={{ flex: 1 }}>
      <SessionHeader stage="listening" stageIndex={position.index} stageCount={position.count}
        progress={step / 6} startedAt={startedAt} onClose={leave} onSkip={session && !busy ? () => finish(true) : undefined} />
      <ScreenScroll>
        {error ? <Text tone="danger" accessibilityRole="alert">{error}</Text> : null}
        {!state || !exercise ? (
          error ? <Button title="Retry" onPress={() => { setError(''); setAttempt(attempt + 1); }} />
            : <Text tone="muted">Preparing a short fictional passage…</Text>
        ) : (
          <>
            {textOnly && <Text tone="muted">Text-based practice · Dutch audio is unavailable on this device.</Text>}
            {(textOnly || step >= 5) && <Card><Text variant="h3">Transcript</Text><Text>{exercise.passageNl}</Text></Card>}
            {(step === 0 || step === 2) && (
              <Card>
                <Text variant="h2">{step === 0 ? 'First pass' : 'Second pass'}</Text>
                <Text>{textOnly ? 'Read the passage before continuing.' : step === 0 ? 'Listen for the main idea.' : 'Listen again for the details.'}</Text>
                {!textOnly && (
                  <>
                    <Row style={{ flexWrap: 'wrap' }}>
                      <Button title={step === 0 ? 'Play' : 'Replay'} fullWidth={false} size="medium" loading={playing} disabled={busy} onPress={() => play(state)} />
                      <Button title="Slower" fullWidth={false} size="medium" variant="secondary" disabled={playing || busy} onPress={() => play(state, true)} />
                    </Row>
                    <Button title="Use text instead" size="medium" variant="ghost" disabled={busy || playing}
                      onPress={() => void run(() => progress(state, { source: 'text_only' }))} />
                  </>
                )}
                <Button title="Continue" disabled={busy || playing || (!textOnly && !heard)}
                  onPress={() => void run(() => progress(state, { step: step + 1 }))} />
              </Card>
            )}
            {(step === 1 || step === 3 || step === 4) && (
              <Card>
                <Text variant="h2">{step === 1 ? 'Gist' : `Detail ${step - 2} of 2`}</Text>
                <Field label={question ?? 'Your answer'} value={draft} onChangeText={setDraft} multiline maxLength={1000} editable={!busy} />
                <Button title="Save answer" disabled={busy || !draft.trim()} onPress={() => void run(() => progress(state, {
                  step: step + 1, answers: [...state.answers, draft.trim()],
                }))} />
              </Card>
            )}
            {step === 5 && (
              <Card>
                <Text variant="h2">Check your understanding</Text>
                <Text>{exercise.gistAnswerEn}</Text>
                {exercise.questions.map((item, index) => (
                  <View key={index}><Text variant="smallStrong">{item}</Text><Text>{exercise.questionAnswers[index]}</Text></View>
                ))}
                {exercise.hardChunks.map((chunk, index) => <Text key={index} tone="muted">{chunk}</Text>)}
                <Button title="Practise the lines" disabled={busy} onPress={() => void run(() => progress(state, { step: 6 }))} />
              </Card>
            )}
            {step === 6 && (
              <Card>
                <Text variant="h2">{textOnly ? 'Read two lines aloud' : 'Shadow two lines'}</Text>
                <Text tone="muted">{textOnly ? 'Say each line aloud.' : 'Play each line, then imitate its rhythm and stress.'}</Text>
                {exercise.shadowLines.map((line, index) => (
                  <Row key={index}><Text style={{ flex: 1 }}>{line}</Text>{!textOnly && <SpeakButton text={line} />}</Row>
                ))}
                <Button title="Finish listening" loading={busy} onPress={() => finish(false)} />
              </Card>
            )}
          </>
        )}
      </ScreenScroll>
    </View>
  );
}
