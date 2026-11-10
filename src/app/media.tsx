import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { openBrowserAsync } from 'expo-web-browser';
import { useRef, useState } from 'react';

import { generateMediaIdeas, readMediaIdeas, setMediaStatus, youtubeSearch } from '@/db/repo/media';
import { useDbQuery } from '@/hooks/use-db-query';
import { Button } from '@/ui/button';
import { Card, Row, ScreenScroll } from '@/ui/surface';
import { Text } from '@/ui/text';

const EVENTS = ['media:changed'] as const;

export default function MediaScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { idea } = useLocalSearchParams<{ idea?: string }>();
  const ideas = useDbQuery(readMediaIdeas, { events: EVENTS });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const lock = useRef(false);
  const items = ideas.data ?? [];
  const ordered = [...items].sort((a, b) => Number(String(b.id) === idea) - Number(String(a.id) === idea));

  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNote('');
    try { await task(); }
    catch { setNote('Could not finish this action. Try again.'); }
    finally { lock.current = false; setBusy(false); }
  }

  return (
    <ScreenScroll>
      <Button title="Back to Today" variant="ghost" size="medium" onPress={() => router.replace('/')} />
      <Text variant="h1">Dutch in the wild</Text>
      <Text tone="muted">Use a search to choose an authentic 30–60 second Dutch clip. Listen for familiar expressions before replaying it for details.</Text>
      <Button title="Get ideas from my last session" loading={busy} onPress={() => void run(async () => {
        if (!(await generateMediaIdeas(db))) setNote('Complete a scheduled session to get searches based on what you practised.');
        else ideas.refresh();
      })} />
      {note ? <Text accessibilityRole="alert" tone="muted">{note}</Text> : null}
      {ideas.error && <Button title="Retry loading ideas" onPress={ideas.refresh} />}
      {ordered.map((item) => (
        <Card key={item.id}>
          <Text variant="h3">{item.title}</Text>
          <Text tone="muted">{item.why}</Text>
          <Button title="Open YouTube search" disabled={busy} size="medium" onPress={() => void run(async () => {
            await openBrowserAsync(youtubeSearch(item.search_query));
            await setMediaStatus(db, item.id, 'opened');
          })} />
          <Row style={{ flexWrap: 'wrap' }}>
            <Button title={item.status === 'saved' ? 'Saved' : 'Save'} disabled={busy || item.status === 'saved'} fullWidth={false}
              variant="secondary" size="medium" onPress={() => void run(() => setMediaStatus(db, item.id, 'saved'))} />
            <Button title="Dismiss" disabled={busy} fullWidth={false} variant="ghost" size="medium"
              onPress={() => void run(() => setMediaStatus(db, item.id, 'dismissed'))} />
          </Row>
        </Card>
      ))}
    </ScreenScroll>
  );
}
