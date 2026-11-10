import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';

import { addBook, addBookUnit, type BookItem, bookExplanation, explainBookItem, keepBookItem,
  markBookItem, readBookItems, readBookShelf } from '@/db/repo/books';
import { useDbQuery } from '@/hooks/use-db-query';
import { normalizeDutch } from '@/srs/normalize';
import { Button, Chip } from '@/ui/button';
import { Field } from '@/ui/field';
import { SpeakButton } from '@/ui/speak-button';
import { Card, Row, ScreenScroll } from '@/ui/surface';
import { Text } from '@/ui/text';

const EVENTS = ['book:changed'] as const;

export default function BookScreen() {
  const db = useSQLiteContext();
  const [bookId, setBookId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [unit, setUnit] = useState('');
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const shelf = useDbQuery(readBookShelf, { events: EVENTS });
  const activeBook = shelf.data?.books.find((book) => book.id === bookId) ?? shelf.data?.books[0];
  const units = shelf.data?.units.filter((item) => item.book_id === activeBook?.id) ?? [];
  const activeUnit = units.find((item) => item.id === unitId) ?? units.at(-1);
  const entries = [...new Set(words.split(/\r?\n/).map((value) => value.trim()).filter((value) => normalizeDutch(value)))].slice(0, 40);

  async function run(task: () => Promise<void>, failure = 'Could not save this change. Try again.') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try { await task(); }
    catch { setError(failure); }
    finally { lock.current = false; setBusy(false); }
  }

  return (
    <ScreenScroll>
      <Text variant="h1">Book companion</Text>
      <Text tone="muted">Bring words or phrases from your reading into the same review schedule.</Text>
      {shelf.error && <Button title="Retry loading your books" onPress={shelf.refresh} />}
      <Card>
        <Field label="Book title" value={title} onChangeText={setTitle} maxLength={120} editable={!busy} />
        <Button title="Add book" size="medium" disabled={!title.trim() || busy} onPress={() => void run(async () => {
          setBookId(await addBook(db, title.trim()));
          setUnitId(null);
          setTitle('');
        })} />
        <Row style={{ flexWrap: 'wrap' }}>
          {shelf.data?.books.map((book) => <Chip key={book.id} label={book.title} selected={book.id === activeBook?.id}
            onPress={busy ? undefined : () => { setBookId(book.id); setUnitId(null); setError(''); }} />)}
        </Row>
      </Card>
      {activeBook && (
        <Card>
          <Text variant="h2">{activeBook.title}</Text>
          <Field label="Unit or page range" placeholder="Pages 12–15" value={unit} onChangeText={setUnit} maxLength={100} editable={!busy} />
          <Field label="Words and phrases, one per line (up to 40)" value={words} onChangeText={setWords}
            maxLength={4000} multiline editable={!busy} />
          <Button title="Add reading list" size="medium" disabled={!unit.trim() || entries.length === 0 || busy}
            onPress={() => void run(async () => {
              setUnitId(await addBookUnit(db, activeBook.id, unit.trim(), entries));
              setUnit('');
              setWords('');
            })} />
          <Row style={{ flexWrap: 'wrap' }}>
            {units.map((item) => <Chip key={item.id} label={item.status === 'done' ? `${item.label} ✓` : item.label}
              selected={activeUnit?.id === item.id} onPress={busy ? undefined : () => setUnitId(item.id)} />)}
          </Row>
        </Card>
      )}
      {error ? <Text tone="danger" accessibilityRole="alert">{error}</Text> : null}
      {activeUnit && <ReadingList key={activeUnit.id} unitId={activeUnit.id} title={activeUnit.label} busy={busy} run={run} />}
    </ScreenScroll>
  );
}

function ReadingList({ unitId, title, busy, run }: {
  unitId: string;
  title: string;
  busy: boolean;
  run: (task: () => Promise<void>, failure?: string) => Promise<void>;
}) {
  const items = useDbQuery((database) => readBookItems(database, unitId), { events: EVENTS });
  const current = items.data?.find((item) => item.status === 'queued' || item.status === 'explained');
  const completed = items.data?.filter((item) => item.status !== 'queued' && item.status !== 'explained') ?? [];
  return (
    <Card>
      <Text variant="h2">{title}</Text>
      {items.error && <Button title="Retry loading this list" onPress={items.refresh} />}
      {items.loading && <Text tone="muted">Loading reading list…</Text>}
      {current ? <ReadingItem key={current.id} item={current} busy={busy} run={run} /> : !items.loading && !items.error && (
        <Text tone="success">You’ve reached the end of this list.</Text>
      )}
      {completed.map((item) => <Text key={item.id} variant="small" tone="muted">{item.raw_text} · {item.status}</Text>)}
    </Card>
  );
}

function ReadingItem({ item, busy, run }: {
  item: BookItem;
  busy: boolean;
  run: (task: () => Promise<void>, failure?: string) => Promise<void>;
}) {
  const db = useSQLiteContext();
  const [meaning, setMeaning] = useState('');
  const explanation = bookExplanation(item);
  return (
    <>
      <Row><Text variant="h3" style={{ flex: 1 }}>{item.raw_text}</Text><SpeakButton text={item.raw_text} /></Row>
      {explanation ? (
        <>
          <Text>{explanation.meaningEn}</Text>
          {explanation.article ? <Text variant="small">Article · {explanation.article}</Text> : null}
          {explanation.howItIsUsed ? <Text tone="muted">{explanation.howItIsUsed}</Text> : null}
          {explanation.exampleNl ? <Text>{explanation.exampleNl}</Text> : null}
          {explanation.exampleEn ? <Text variant="small" tone="muted">{explanation.exampleEn}</Text> : null}
          {explanation.confidence === 'low' && <Text tone="primary">Check this explanation in context.</Text>}
        </>
      ) : (
        <>
          <Button title="Explain it" size="medium" disabled={busy}
            onPress={() => void run(async () => { await explainBookItem(db, item); },
              'Could not explain this item. You can enter your own meaning below or keep reading.')} />
          <Field label="Or enter your own English meaning" value={meaning} onChangeText={setMeaning} maxLength={200} editable={!busy} />
        </>
      )}
      <Button title="Add to phrase bank" size="medium" disabled={busy || (!explanation && !meaning.trim())}
        onPress={() => void run(() => keepBookItem(db, item, explanation, meaning.trim()))} />
      <Button title="I know it" size="medium" variant="secondary" disabled={busy}
        onPress={() => void run(() => markBookItem(db, item, true))} />
      <Button title="Skip this item" size="medium" variant="ghost" disabled={busy}
        onPress={() => void run(() => markBookItem(db, item, false))} />
    </>
  );
}
