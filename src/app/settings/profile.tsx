import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { Switch } from 'react-native';

import { play, setSoundEnabled } from '@/audio/sfx';
import { getProfile, type LearnerProfile, updateProfile } from '@/db/repo/profile';
import { getSoundEnabled, setSoundPreference } from '@/db/repo/settings';
import { useDbQuery } from '@/hooks/use-db-query';
import { reconcileReminders } from '@/notifications/schedule';
import { configureDutchSpeech, listDutchVoices, speakDutch } from '@/speech/tts';
import { useTheme } from '@/theme/use-theme';
import { Button, Chip } from '@/ui/button';
import { Field } from '@/ui/field';
import { Card, Row, ScreenScroll } from '@/ui/surface';
import { Text } from '@/ui/text';
import type { DurationMode } from '@/types';

const SAMPLE = 'Hé, hoe was je dag? Heb je straks zin om mee te trainen?';
const MODES: { id: DurationMode; label: string }[] = [
  { id: 'quick', label: 'Quick' }, { id: 'short', label: '20 min' }, { id: 'standard', label: '40 min' },
];
const RATES = [{ value: 0.8, label: 'Slower' }, { value: 1, label: 'Normal' }, { value: 1.2, label: 'Faster' }];
/**
 * Daily goal options.
 *
 * 60 is the default: a 7-minute Quick session clears it, but tapping through
 * flashcards does not. 40 is the floor for a hard week, and the two above it are for
 * learners whose typical day already runs long.
 */
const GOALS = [40, 60, 90, 120];

export default function ProfileScreen() {
  const result = useDbQuery(
    async (db) => ({ profile: await getProfile(db), soundOn: await getSoundEnabled(db) }),
    { refreshOnFocus: false }
  );
  if (!result.data) return (
    <ScreenScroll>
      <Text tone={result.error ? 'danger' : 'muted'}>{result.error ? 'Could not load your profile.' : 'Loading…'}</Text>
      {result.error && <Button title="Retry" onPress={result.refresh} />}
    </ScreenScroll>
  );
  return <ProfileForm profile={result.data.profile} initialSoundOn={result.data.soundOn} />;
}

function ProfileForm({ profile, initialSoundOn }: { profile: LearnerProfile; initialSoundOn: boolean }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const voices = useDbQuery(listDutchVoices, { refreshOnFocus: false });
  const [sport, setSport] = useState(profile.sport ?? '');
  const [interests, setInterests] = useState(profile.interests.join(', '));
  const [goals, setGoals] = useState(profile.goals ?? '');
  const [mode, setMode] = useState(profile.defaultDurationMode);
  const [goal, setGoal] = useState(profile.dailyGoalXp);
  const [soundOn, setSoundOn] = useState(initialSoundOn);
  const [voiceId, setVoiceId] = useState(profile.ttsVoiceId);
  const [rate, setRate] = useState(profile.ttsRate);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const lock = useRef(false);

  async function save() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setStatus('');
    try {
      await updateProfile(db, {
        sport: sport.trim() || null, goals: goals.trim() || null,
        interests: [...new Set(interests.split(',').map((value) => value.trim()).filter(Boolean))],
        defaultDurationMode: mode, ttsVoiceId: voiceId, ttsRate: rate,
        dailyGoalXp: goal,
      });
      await setSoundPreference(db, soundOn);
      configureDutchSpeech(voiceId, rate);
      try {
        await reconcileReminders(db, 'settings-changed');
        setStatus('Preferences saved.');
      } catch {
        setStatus('Preferences saved. Open Reminders to check the schedule.');
      }
    } catch {
      setStatus('Could not save your preferences. Try again.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <ScreenScroll>
      <Card>
        <Text variant="h2">Your practice</Text>
        <Field label="Sport" value={sport} onChangeText={setSport} maxLength={60} editable={!busy} />
        <Field label="Situations and interests" value={interests} onChangeText={setInterests} maxLength={160} editable={!busy} />
        <Field label="What would you like to get better at?" value={goals} onChangeText={setGoals} maxLength={240} editable={!busy} />
        <Text variant="smallStrong">Usual session length</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {MODES.map(({ id, label }) => <Chip key={id} label={label} selected={mode === id}
            onPress={busy ? undefined : () => setMode(id)} />)}
        </Row>
        <Text variant="smallStrong">Daily goal</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {GOALS.map((value) => <Chip key={value} label={`${value} XP`} selected={goal === value}
            onPress={busy ? undefined : () => setGoal(value)} />)}
        </Row>
        <Text variant="caption" tone="faint">
          Meeting this is what keeps the streak. A 7-minute Quick session clears 60.
        </Text>
      </Card>
      <Card>
        <Text variant="h2">Dutch audio</Text>
        {voices.data?.length ? (
          <>
            <Row style={{ flexWrap: 'wrap' }}>
              <Chip label="Device default" selected={voiceId === null} onPress={busy ? undefined : () => setVoiceId(null)} />
              {voices.data.map((voice) => <Chip key={voice.identifier} label={voice.name}
                selected={voice.identifier === voiceId} onPress={busy ? undefined : () => setVoiceId(voice.identifier)} />)}
            </Row>
            <Text variant="smallStrong">Playback speed</Text>
            <Row style={{ flexWrap: 'wrap' }}>
              {RATES.map(({ value, label }) => <Chip key={value} label={label}
                selected={rate === value} onPress={busy ? undefined : () => setRate(value)} />)}
            </Row>
            <Button title="Hear sample" size="medium" variant="secondary" disabled={busy}
              onPress={() => void speakDutch(SAMPLE, { voiceId, previewRate: rate,
                onError: () => setStatus('Could not play the Dutch voice.') }).catch(() => setStatus('Could not play the Dutch voice.'))} />
          </>
        ) : <Text tone="muted">{voices.loading ? 'Checking the device’s voices…' : 'Install a Dutch text-to-speech voice in device settings to hear Dutch audio.'}</Text>}
        <Button title="Refresh installed voices" size="medium" variant="ghost" disabled={busy} onPress={voices.refresh} />
      </Card>
      <Card>
        <Text variant="h2">Sound</Text>
        <Row>
          <Text variant="bodyStrong" style={{ flex: 1 }}>Interface sounds</Text>
          <Switch
            value={soundOn}
            disabled={busy}
            onValueChange={(next) => {
              setSoundOn(next);
              // Apply straight away so the sound below is a real preview, not a
              // promise about what Save will do.
              setSoundEnabled(next);
              if (next) play('correct');
            }}
            trackColor={{ false: theme.colors.track, true: theme.colors.primarySoft }}
            thumbColor={soundOn ? theme.colors.primary : theme.colors.borderStrong}
            accessibilityLabel="Interface sounds"
          />
        </Row>
        <Text variant="small" tone="muted">
          Short tones for a correct answer, a run of them, and a level gained. A phone
          on silent stays silent — this never overrides the hardware switch.
        </Text>
      </Card>
      <Button title="Save preferences" loading={busy} onPress={() => void save()} />
      {status ? <Text accessibilityRole="alert">{status}</Text> : null}
    </ScreenScroll>
  );
}
