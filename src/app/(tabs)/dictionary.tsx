import { FlashList } from '@shopify/flash-list';
import { useSQLiteContext } from 'expo-sqlite';
import { useDeferredValue, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';

import { AiError } from '@/ai/errors';
import {
  type CachedEntry, correctEntry, normalizeQuery, type QueryLanguage, saveEntry,
} from '@/db/repo/dictionary';
import { type Phrase, searchPhrases } from '@/db/repo/phrases';
import { EntryCard } from '@/dictionary/entry-card';
import { lookupDictionary } from '@/dictionary/lookup';
import { useDbQuery } from '@/hooks/use-db-query';
import { useTheme } from '@/theme/use-theme';
import { Button, Chip } from '@/ui/button';
import { SpeakButton } from '@/ui/speak-button';
import { Card, Row, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';

const LANGUAGES = { nl: 'Dutch', en: 'English', bg: 'Bulgarian' } satisfies Record<QueryLanguage, string>;
const FILTERS = ['All', 'New', 'Tricky', 'Check details'] as const;
const BANK_EVENTS = ['phrases:changed'] as const;

export default function DictionaryScreen() {
  const theme = useTheme();
  const db = useSQLiteContext();
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState<QueryLanguage>('nl');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [cached, setCached] = useState<CachedEntry | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<'lookup' | 'save' | 'correct' | null>(null);
  const pending = useRef(false);
  const needle = useDeferredValue(normalizeQuery(query));
  // SQLite LIKE folds ASCII case only. Bulgarian search uses Unicode case folding here.
  const cyrillic = /\p{Script=Cyrillic}/u.test(needle);
  const bankQuery = cyrillic ? '' : needle;
  const bank = useDbQuery((database) => searchPhrases(database, bankQuery, null), {
    events: BANK_EVENTS, queryKey: bankQuery,
  });
  const phrases = (bank.data ?? []).filter((phrase) => {
    if (filter === 'New' && phrase.reps !== 0) return false;
    if (filter === 'Tricky' && !phrase.relearnNextSession && phrase.lastStatus !== 'prompted' && phrase.lastStatus !== 'missed') return false;
    if (filter === 'Check details' && !phrase.needsVerification) return false;
    return !cyrillic || [phrase.dutch, phrase.meaningEn, phrase.meaningBg, phrase.register, ...phrase.tags]
      .some((value) => value && normalizeQuery(value).includes(needle));
  });

  async function run(
    kind: NonNullable<typeof busy>,
    task: () => Promise<CachedEntry>,
    failure: string
  ): Promise<boolean> {
    if (pending.current) return false;
    pending.current = true;
    setBusy(kind);
    setMessage(null);
    try {
      setCached(await task());
      return true;
    } catch (error) {
      setMessage(error instanceof AiError ? error.userMessage : failure);
      return false;
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  function lookup() {
    if (pending.current || !normalizeQuery(query)) return;
    void run('lookup', () => lookupDictionary(db, query, language), 'Could not look up this entry. Your phrase bank is still available below.');
  }

  return (
    <Screen>
      <FlashList
        data={phrases}
        keyExtractor={(phrase) => phrase.id}
        renderItem={renderPhrase}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: theme.space.lg, paddingBottom: theme.space.xl }}
        ListHeaderComponent={(
          <View style={{ gap: theme.space.lg, paddingBottom: theme.space.md }}>
            <View style={{ gap: theme.space.xs }}>
              <Text variant="h1" accessibilityRole="header">Dictionary</Text>
              <Text tone="muted">Look up a word or phrase and save it for practice.</Text>
            </View>
            <View style={{ gap: theme.space.sm }}>
              <Text variant="smallStrong">Look up from</Text>
              <Row style={{ flexWrap: 'wrap' }} gap={theme.space.sm}>
                {(Object.keys(LANGUAGES) as QueryLanguage[]).map((option) => (
                  <Chip key={option} label={LANGUAGES[option]} selected={language === option}
                    onPress={busy ? undefined : () => {
                      setLanguage(option);
                      setCached(null);
                      setMessage(null);
                    }} />
                ))}
              </Row>
              <TextInput
                accessibilityLabel="Word or phrase"
                placeholder="Enter a word or phrase"
                placeholderTextColor={theme.colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                editable={busy === null}
                maxLength={200}
                returnKeyType="search"
                onSubmitEditing={lookup}
                value={query}
                onChangeText={(text) => {
                  setQuery(text);
                  setCached(null);
                  setMessage(null);
                }}
                style={{
                  minHeight: 48,
                  color: theme.colors.text,
                  fontSize: theme.typography.body.fontSize,
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  borderWidth: 1,
                  borderRadius: theme.radius.md,
                  paddingHorizontal: theme.space.md,
                }}
              />
              <Button title="Look up" size="medium" disabled={busy !== null || !query.trim()}
                loading={busy === 'lookup'} onPress={lookup} />
            </View>
            {message && <Text accessibilityRole="alert" tone="danger">{message}</Text>}
            {cached && (
              <EntryCard
                key={cached.id}
                cached={cached}
                busy={busy !== null}
                onSave={() => void run('save', () => saveEntry(db, cached), 'Could not finish saving this entry. Try again.')}
                onCorrect={(fields) => run('correct', () => correctEntry(db, cached, fields), 'Could not save the corrections. Try again.')}
              />
            )}
            <View style={{ gap: theme.space.sm }}>
              <Text variant="h2" accessibilityRole="header">Phrase bank</Text>
              <Text variant="small" tone="muted">The search above also filters your saved phrases and topics.</Text>
              <Row style={{ flexWrap: 'wrap' }} gap={theme.space.sm}>
                {FILTERS.map((option) => (
                  <Chip key={option} label={option} selected={filter === option} onPress={() => setFilter(option)} />
                ))}
              </Row>
            </View>
            {bank.error && (
              <Button title="Retry loading the phrase bank" size="medium" variant="secondary" onPress={bank.refresh} />
            )}
          </View>
        )}
        ListEmptyComponent={bank.error ? null : (
          <Text tone="muted">{bank.loading ? 'Loading phrases…' : 'No phrases match this search.'}</Text>
        )}
      />
    </Screen>
  );
}

function renderPhrase({ item }: { item: Phrase }) {
  return <PhraseCard phrase={item} />;
}

function PhraseCard({ phrase }: { phrase: Phrase }) {
  const theme = useTheme();
  return (
    <Card variant="flat" style={{ marginBottom: theme.space.sm }}>
      <Row>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{phrase.dutch}</Text>
          <Text variant="small" tone="muted">{phrase.meaningEn}</Text>
        </View>
        <SpeakButton text={phrase.dutch} size={20} />
      </Row>
      {phrase.exampleNl ? <Text variant="small">{phrase.exampleNl}</Text> : null}
      {phrase.needsVerification && <Text variant="smallStrong" tone="primary">Needs verification</Text>}
    </Card>
  );
}
