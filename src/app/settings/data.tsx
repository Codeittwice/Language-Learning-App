import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { Platform } from 'react-native';

import { backupPath, listBackups } from '@/db/backup';
import { exportLearningData } from '@/db/export';
import { useDbQuery } from '@/hooks/use-db-query';
import { Button } from '@/ui/button';
import { Card, ScreenScroll } from '@/ui/surface';
import { Text } from '@/ui/text';

export default function DataScreen() {
  const db = useSQLiteContext();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const lock = useRef(false);
  const backups = useDbQuery(() => Platform.OS === 'web' ? Promise.resolve([]) : listBackups());

  async function run(action: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setStatus('');
    try {
      if (await action() === 'copied') setStatus('Export copied to your clipboard.');
    } catch {
      setStatus('Could not export your data on this device. Try again.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <ScreenScroll>
      <Card>
        <Text variant="h2">Learning history</Text>
        <Text tone="muted">JSON contains the learning records. Markdown is a readable summary. Exports may include your typed practice and personal notes.</Text>
        <Button title={Platform.OS === 'web' ? 'Copy JSON' : 'Export JSON'} disabled={busy}
          onPress={() => void run(() => exportLearningData(db, 'json'))} />
        <Button title={Platform.OS === 'web' ? 'Copy Markdown' : 'Export Markdown'} disabled={busy} variant="secondary"
          onPress={() => void run(() => exportLearningData(db, 'md'))} />
      </Card>
      {status ? <Text accessibilityRole="alert">{status}</Text> : null}
      {Platform.OS !== 'web' && (
        <Card>
          <Text variant="h2">Pre-upgrade backups</Text>
          <Text tone="muted">Snapshots created before a database upgrade can be shared as files.</Text>
          {backups.data?.length ? backups.data.map((backup) => (
            <Button key={backup.name} title={backup.modified ? `Share ${new Date(backup.modified).toLocaleDateString()} backup` : 'Share backup'}
              size="medium" variant="secondary" disabled={busy} onPress={() => void run(async () => {
                if (!(await isAvailableAsync())) throw new Error('Sharing unavailable');
                await shareAsync(backupPath(backup.name), { mimeType: 'application/octet-stream' });
              })} />
          )) : <Text tone="muted">No backups on this device yet.</Text>}
        </Card>
      )}
    </ScreenScroll>
  );
}
