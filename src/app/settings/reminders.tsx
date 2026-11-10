import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Platform, Switch } from 'react-native';

import { getBoolSetting, SETTING_KEYS, setSetting } from '@/db/repo/settings';
import { useDbQuery } from '@/hooks/use-db-query';
import { requestReminderPermission } from '@/notifications';
import { parseReminderTime, readReminderTime, reminderTimeLabel, writeReminderTime } from '@/notifications/preferences';
import { checkReminderHealth, reconcileReminders } from '@/notifications/schedule';
import { Button } from '@/ui/button';
import { ReminderTimeInput } from '@/ui/reminder-time-input';
import { Card, Row, ScreenScroll } from '@/ui/surface';
import { Text } from '@/ui/text';

const EVENTS = ['settings:changed'] as const;

export default function RemindersScreen() {
  const db = useSQLiteContext();
  const [draft, setDraft] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const state = useDbQuery(async (database) => {
    const [health, time, rescue] = await Promise.all([
      checkReminderHealth(database), readReminderTime(database),
      getBoolSetting(database, SETTING_KEYS.rescueEnabled, true),
    ]);
    return { health, time, rescue };
  }, { events: EVENTS });
  const refresh = state.refresh;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (value) => {
      if (value === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  async function change(task: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await task();
      await reconcileReminders(db, 'settings-changed');
      setDraft(null);
    } catch {
      setError('Could not update the reminder schedule. Check its health below and try again.');
    } finally {
      lock.current = false;
      setBusy(false);
      refresh();
    }
  }

  const data = state.data;
  if (!data) {
    return <ScreenScroll><Text>{state.error ? 'Could not read reminder settings.' : 'Loading…'}</Text></ScreenScroll>;
  }
  const { health, time, rescue } = data;
  const timeLabel = reminderTimeLabel(time.hour, time.minute);
  const parsed = parseReminderTime(draft ?? timeLabel);

  return (
    <ScreenScroll>
      <Card>
        <Row>
          <Text variant="bodyStrong" style={{ flex: 1 }}>Daily reminders</Text>
          <Switch accessibilityLabel="Daily reminders" value={health.enabled} disabled={busy}
            onValueChange={(enabled) => void change(async () => {
              await setSetting(db, SETTING_KEYS.remindersEnabled, enabled);
              if (enabled && Platform.OS !== 'web') await requestReminderPermission();
            })} />
        </Row>
        <Text tone="muted">Your daily reminder is set for around {timeLabel} local time.</Text>
        <ReminderTimeInput disabled={busy} value={draft ?? timeLabel} onChange={setDraft} />
        <Button title="Save time" size="medium" disabled={!parsed || draft === null || busy}
          onPress={() => parsed && void change(() => writeReminderTime(db, parsed.hour, parsed.minute))} />
        <Row>
          <Text variant="bodyStrong" style={{ flex: 1 }}>Streak rescue</Text>
          <Switch accessibilityLabel="Streak rescue" value={rescue} disabled={busy || !health.enabled}
            onValueChange={(enabled) => void change(() => setSetting(db, SETTING_KEYS.rescueEnabled, enabled))} />
        </Row>
        <Text variant="small" tone="muted">An extra evening reminder if a streak is at risk.</Text>
      </Card>
      <Card>
        <Text variant="h2">Reminder health</Text>
        <Text>Permission · {Platform.OS === 'web' ? 'Available in the mobile app' : health.permissionGranted ? 'Allowed' : 'Off'}</Text>
        <Text>Pending · {health.pending}</Text>
        <Text>Next expected · {health.nextAt ? health.nextAt.toLocaleString() : 'None scheduled'}</Text>
        <Text>Last checked · {health.lastReconcileAt ? new Date(health.lastReconcileAt).toLocaleString() : 'Never'}</Text>
        <Text>Device timezone · {health.liveTimezone}</Text>
        <Text>Scheduled timezone · {health.scheduledTimezone ?? 'None'}</Text>
        {health.looksCleared && <Text tone="danger">The OS queue is empty. Rebuild it below.</Text>}
        {!health.permissionGranted && Platform.OS !== 'web' && (
          <Button size="medium" title={health.canAskAgain ? 'Allow notifications' : 'Open device settings'}
            disabled={busy} onPress={() => void change(health.canAskAgain ? requestReminderPermission : Linking.openSettings)} />
        )}
        <Button title="Refresh schedule" variant="secondary" size="medium" loading={busy}
          onPress={() => void change(async () => undefined)} />
        <Button title="Reminders not arriving?" variant="ghost" size="medium" onPress={() => setHelp(true)} />
      </Card>
      {error ? <Text accessibilityRole="alert" tone="danger">{error}</Text> : null}
      <Modal visible={help} animationType="slide" onRequestClose={() => setHelp(false)}>
        <ScreenScroll>
          <Text variant="h2">Reminders not arriving?</Text>
          <Text>Check the app’s notification permission and its daily reminder channel in device settings.</Text>
          <Text>On Android, check whether battery optimisation restricts the app. Look for Autostart on Xiaomi, Sleeping apps on Samsung, or App launch on Huawei. Menu names vary by device.</Text>
          <Text>Force-stopping an Android app can clear its reminder queue. Reopen the app to rebuild the schedule.</Text>
          <Button title="Done" onPress={() => setHelp(false)} />
        </ScreenScroll>
      </Modal>
    </ScreenScroll>
  );
}
