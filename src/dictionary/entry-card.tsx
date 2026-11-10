import { useState } from 'react';
import { TextInput, View } from 'react-native';

import type { DictionaryEntry } from '@/ai/schemas';
import { type CachedEntry, type correctEntry, dictionaryHeadword } from '@/db/repo/dictionary';
import { useTheme } from '@/theme/use-theme';
import { Button, Chip } from '@/ui/button';
import { SpeakButton } from '@/ui/speak-button';
import { Card, Row } from '@/ui/surface';
import { DutchText, Text } from '@/ui/text';

type Correction = Parameters<typeof correctEntry>[2];

export function EntryCard({
  cached,
  busy,
  onSave,
  onCorrect,
}: {
  cached: CachedEntry;
  busy: boolean;
  onSave: () => void;
  onCorrect: (fields: Correction) => Promise<boolean>;
}) {
  const theme = useTheme();
  const [editing, setEditing] = useState(false);
  const { entry, savedPhraseId } = cached;
  const headword = dictionaryHeadword(entry);
  const forms: [string, string | null][] = [
    ['Plural', entry.plural],
    ['Diminutive', entry.diminutive],
    ['Infinitive', entry.verbInfinitive],
    ['Present (hij/zij)', entry.verbPresent3sg],
    ['Past singular', entry.verbPastSg],
    ['Past plural', entry.verbPastPl],
    ['Past participle', entry.verbParticiple],
    ['Auxiliary', entry.verbAux],
    ['Separable verb', entry.verbSeparable === null ? null : entry.verbSeparable ? 'Yes' : 'No'],
    ['Prepositions', entry.prepositions.join(', ')],
  ];

  return (
    <Card>
      <Row>
        <DutchText style={{ flex: 1 }}>{headword}</DutchText>
        <SpeakButton text={headword} />
      </Row>
      <Row style={{ flexWrap: 'wrap' }} gap={theme.space.sm}>
        <Chip label={entry.wordClass} />
        <Chip label={entry.register} tone="accent" />
        {entry.article && <Chip label={entry.article} />}
      </Row>
      <View>
        <Text>{entry.meaningEn}</Text>
        {entry.meaningBg && <Text tone="muted">{entry.meaningBg}</Text>}
      </View>
      {forms.some(([, value]) => value) && (
        <View>
          {forms.map(([label, value]) => value ? (
            <Text key={label} variant="small">
              <Text variant="smallStrong">{label} · </Text>{value}
            </Text>
          ) : null)}
        </View>
      )}
      {entry.exampleNl ? (
        <View>
          <Text variant="bodyStrong">{entry.exampleNl}</Text>
          <Text variant="small" tone="muted">{entry.exampleEn}</Text>
        </View>
      ) : null}
      {entry.notes ? <Text variant="small" tone="muted">{entry.notes}</Text> : null}
      {entry.confidence === 'low' && (
        <Text variant="smallStrong" tone="primary">Some details may be wrong. Check them before using this entry.</Text>
      )}
      {editing ? (
        <CorrectionForm
          entry={entry}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSubmit={async (fields) => {
            if (await onCorrect(fields)) setEditing(false);
          }}
        />
      ) : savedPhraseId ? (
        <Text variant="bodyStrong" tone="success">In your phrase bank</Text>
      ) : (
        <>
          {entry.confidence === 'low' && (
            <Button title="Correct this entry" variant="ghost" size="medium" disabled={busy} onPress={() => setEditing(true)} />
          )}
          <Button title="Add to phrase bank" size="medium" loading={busy} onPress={onSave} />
        </>
      )}
    </Card>
  );
}

function CorrectionForm({ entry, busy, onCancel, onSubmit }: {
  entry: DictionaryEntry;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (fields: Correction) => void;
}) {
  const theme = useTheme();
  const [fields, setFields] = useState<Correction>({
    article: entry.article,
    meaningEn: entry.meaningEn,
    plural: entry.plural,
    verbPastSg: entry.verbPastSg,
    verbParticiple: entry.verbParticiple,
  });
  const isNoun = entry.article !== null || entry.wordClass.toLowerCase() === 'noun';
  const isVerb = entry.verbInfinitive !== null || entry.wordClass.toLowerCase() === 'verb';
  const inputs: [Exclude<keyof Correction, 'article'>, string][] = [['meaningEn', 'English meaning']];
  if (isNoun) inputs.push(['plural', 'Plural']);
  if (isVerb) inputs.push(['verbPastSg', 'Past singular'], ['verbParticiple', 'Past participle']);

  return (
    <View style={{ gap: theme.space.md }}>
      {isNoun && (
        <View style={{ gap: theme.space.sm }}>
          <Text variant="smallStrong">Article</Text>
          <Row style={{ flexWrap: 'wrap' }}>
            {(['de', 'het', 'de/het'] as const).map((article) => (
              <Chip key={article} label={article} selected={fields.article === article}
                onPress={busy ? undefined : () => setFields({ ...fields, article })} />
            ))}
          </Row>
        </View>
      )}
      {inputs.map(([field, label]) => (
        <View key={field} style={{ gap: theme.space.xs }}>
          <Text variant="smallStrong">{label}</Text>
          <TextInput
            accessibilityLabel={label}
            editable={!busy}
            value={fields[field] ?? ''}
            maxLength={200}
            onChangeText={(text) => setFields({ ...fields, [field]: text })}
            style={{
              color: theme.colors.text,
              fontSize: theme.typography.body.fontSize,
              minHeight: 44,
              paddingHorizontal: theme.space.md,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surfaceAlt,
            }}
          />
        </View>
      ))}
      <Button title="Save corrections" size="medium" loading={busy} disabled={!fields.meaningEn.trim()}
        onPress={() => onSubmit({
          article: fields.article,
          meaningEn: fields.meaningEn.trim(),
          plural: fields.plural?.trim() || null,
          verbPastSg: fields.verbPastSg?.trim() || null,
          verbParticiple: fields.verbParticiple?.trim() || null,
        })} />
      <Button title="Cancel" variant="ghost" size="medium" disabled={busy} onPress={onCancel} />
    </View>
  );
}
