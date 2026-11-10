import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { Modal, Platform } from 'react-native';

import { type LearnerProfile, updateProfile } from '@/db/repo/profile';
import { SETTING_KEYS, setSetting } from '@/db/repo/settings';
import { requestReminderPermission } from '@/notifications';
import { parseReminderTime, writeReminderTime } from '@/notifications/preferences';
import { reconcileReminders } from '@/notifications/schedule';
import { nowIso } from '@/time/day';
import { Button, Chip } from '@/ui/button';
import { Field } from '@/ui/field';
import { ReminderTimeInput } from '@/ui/reminder-time-input';
import { Card, Row, ScreenScroll } from '@/ui/surface';
import { Text } from '@/ui/text';

export function Onboarding({ profile }: { profile: LearnerProfile }) {
  const db = useSQLiteContext();
  const [sport, setSport] = useState(profile.sport ?? '');
  const [interests, setInterests] = useState(profile.interests.join(', '));
  const [mode, setMode] = useState<'short' | 'standard'>(profile.defaultDurationMode === 'short' ? 'short' : 'standard');
  const [time, setTime] = useState('19:30');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const parsed = parseReminderTime(time);

  async function finish(enableReminders: boolean) {
    if (!parsed || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await writeReminderTime(db, parsed.hour, parsed.minute);
      await setSetting(db, SETTING_KEYS.remindersEnabled, enableReminders);
      await updateProfile(db, {
        sport: sport.trim() || null,
        interests: [...new Set(interests.split(',').map((value) => value.trim()).filter(Boolean))],
        defaultDurationMode: mode,
      });
      if (enableReminders && Platform.OS !== 'web') await requestReminderPermission();
      await reconcileReminders(db, 'settings-changed');
      await updateProfile(db, { onboardedAt: nowIso() });
    } catch {
      setError('Could not finish setup. Try again or continue with reminders off.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={() => void finish(false)}>
      <ScreenScroll>
        <Text variant="h1">Dutch with Friends</Text>
        <Text tone="muted">A little context makes practice feel like conversations you actually have.</Text>
        <Card>
          <Field label="Your sport (optional)" placeholder="Volleyball" value={sport} maxLength={60} onChangeText={setSport} editable={!busy} />
          <Field label="Situations you want to practise (optional)" placeholder="Training, group chats, weekend plans"
            value={interests} maxLength={160} onChangeText={setInterests} editable={!busy} />
          <Text variant="smallStrong">Usual session length</Text>
          <Row style={{ flexWrap: 'wrap' }}>
            <Chip label="20 min" selected={mode === 'short'} onPress={busy ? undefined : () => setMode('short')} />
            <Chip label="40 min" selected={mode === 'standard'} onPress={busy ? undefined : () => setMode('standard')} />
          </Row>
          {Platform.OS !== 'web' && (
            <ReminderTimeInput value={time} onChange={setTime} disabled={busy} />
          )}
        </Card>
        {Platform.OS !== 'web' && (
          <Button title="Continue and allow reminders" loading={busy} disabled={!parsed} onPress={() => void finish(true)} />
        )}
        <Button title={Platform.OS === 'web' ? 'Continue' : 'Continue without reminders'}
          variant="secondary" disabled={!parsed || busy} onPress={() => void finish(false)} />
        {error ? <Text tone="danger" accessibilityRole="alert">{error}</Text> : null}
      </ScreenScroll>
    </Modal>
  );
}
