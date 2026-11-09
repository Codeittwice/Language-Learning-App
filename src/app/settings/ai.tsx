/**
 * AI provider settings: choose a provider, paste a key, pick models.
 *
 * The key is held in local state only while it is being typed, and is handed straight
 * to SecureStore. Once saved, this screen only ever sees `hasKey` and a mask.
 */
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSQLiteContext } from 'expo-sqlite';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  readAiConfig,
  setActiveProvider,
  setChatModel,
  setStructuredModel,
} from '@/ai/config';
import { deleteKey, getKey, maskKey, setKey } from '@/ai/keys';
import { getProvider } from '@/ai/registry';
import { isRecommended, sortModels } from '@/ai/model-info';
import type { KeyValidation, ModelInfo, ProviderId } from '@/ai/types';
import { PROVIDER_IDS } from '@/ai/types';
import { getCachedModels, upsertModels } from '@/db/repo/ai-calls';
import { useDbQuery } from '@/hooks/use-db-query';
import { useTheme } from '@/theme/use-theme';
import { Button, Chip, tapFeedback } from '@/ui/button';
import { Card, Row, ScreenScroll, Separator } from '@/ui/surface';
import { Text } from '@/ui/text';

const VALIDATE_DEBOUNCE_MS = 600;

export default function AiSettingsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();

  const config = useDbQuery((database) => readAiConfig(database), { events: ['settings:changed'] });
  const provider = config.data?.provider ?? null;

  return (
    <ScreenScroll>
      <Card>
        <Text variant="h3">Provider</Text>
        <Text variant="small" tone="muted">
          Your key stays on this phone, in the device keychain. It is never sent
          anywhere except to the provider you choose.
        </Text>
        <Row style={{ flexWrap: 'wrap', gap: theme.space.sm }}>
          {PROVIDER_IDS.map((id) => (
            <Chip
              key={id}
              label={getProvider(id).label}
              selected={provider === id}
              onPress={() => void setActiveProvider(db, id)}
            />
          ))}
        </Row>
      </Card>

      {provider ? (
        <>
          {/* Keyed by provider so switching provider remounts with clean state,
              rather than resetting fields from an effect. */}
          <KeySection key={provider} providerId={provider} />
          <ModelSection
            providerId={provider}
            chatModel={config.data?.chatModel ?? null}
            structuredModel={config.data?.structuredModel ?? null}
          />
        </>
      ) : (
        <Text variant="small" tone="muted">
          Pick a provider to continue.
        </Text>
      )}
    </ScreenScroll>
  );
}

/* -------------------------------------------------------------------------- */

function KeySection({ providerId }: { providerId: ProviderId }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const provider = getProvider(providerId);

  const [draft, setDraft] = useState('');
  const [stored, setStored] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<KeyValidation | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the stored key once on mount; the parent remounts this on provider change.
  useEffect(() => {
    let active = true;
    void getKey(providerId).then((key) => {
      if (active) setStored(key);
    });
    return () => {
      active = false;
    };
  }, [providerId]);

  // Cancel any in-flight validation when leaving the screen.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const validate = useCallback(
    async (candidate: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setChecking(true);
      try {
        const validation = await provider.validateKey(candidate, controller.signal);
        if (controller.signal.aborted) return;
        setResult(validation);

        if (validation.ok) {
          // Only persist a key the provider has accepted.
          await setKey(providerId, candidate);
          setStored(candidate);
          setDraft('');
          const models = await provider.listModels(candidate, controller.signal);
          if (models.length) await upsertModels(db, providerId, models);
        }
      } catch {
        if (!controller.signal.aborted) {
          setResult({ ok: false, reason: 'network', message: 'Could not reach the provider.' });
        }
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    },
    [db, provider, providerId]
  );

  const onChange = (text: string) => {
    setDraft(text);
    setResult(null);
    if (timerRef.current) clearTimeout(timerRef.current);

    const trimmed = text.trim();
    if (!trimmed) return;

    // Cheap shape check first, so an obvious typo costs no request.
    if (!provider.keyPattern.test(trimmed)) {
      setResult({
        ok: false,
        reason: 'invalid_key',
        message: `That does not look like a ${provider.label} key (expected ${provider.keyHint}).`,
      });
      return;
    }
    timerRef.current = setTimeout(() => void validate(trimmed), VALIDATE_DEBOUNCE_MS);
  };

  return (
    <Card>
      <Row>
        <Text variant="h3" style={{ flex: 1 }}>
          API key
        </Text>
        <Pressable
          onPress={() => {
            tapFeedback();
            void WebBrowser.openBrowserAsync(provider.keyHelpUrl);
          }}
          hitSlop={8}
        >
          <Row gap={4}>
            <Text variant="smallStrong" tone="accent">
              Get a key
            </Text>
            <Ionicons name="open-outline" size={14} color={theme.colors.accentText} />
          </Row>
        </Pressable>
      </Row>

      {stored ? (
        <View style={{ gap: theme.space.md }}>
          <Row
            style={{
              backgroundColor: theme.colors.successSoft,
              padding: theme.space.md,
              borderRadius: theme.radius.md,
            }}
          >
            <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />
            <Text variant="smallStrong" style={{ flex: 1 }}>
              {maskKey(stored)}
            </Text>
          </Row>
          <Button
            title="Remove key"
            variant="danger"
            size="medium"
            onPress={() => {
              void deleteKey(providerId).then(() => {
                setStored(null);
                setResult(null);
              });
            }}
          />
        </View>
      ) : (
        <View style={{ gap: theme.space.md }}>
          <Row>
            <TextInput
              value={draft}
              onChangeText={onChange}
              placeholder={provider.keyHint}
              placeholderTextColor={theme.colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={{
                flex: 1,
                color: theme.colors.text,
                backgroundColor: theme.colors.surfaceAlt,
                borderRadius: theme.radius.md,
                paddingHorizontal: theme.space.md,
                height: 46,
                fontSize: 15,
              }}
            />
            <Pressable
              hitSlop={8}
              onPress={() => {
                tapFeedback();
                void Clipboard.getStringAsync().then((text) => text && onChange(text));
              }}
            >
              <Ionicons name="clipboard-outline" size={22} color={theme.colors.textMuted} />
            </Pressable>
          </Row>

          {checking ? (
            <Row>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text variant="small" tone="muted">
                Checking the key…
              </Text>
            </Row>
          ) : null}

          {result && !result.ok ? (
            <Row>
              <Ionicons name="alert-circle" size={18} color={theme.colors.danger} />
              <Text variant="small" tone="danger" style={{ flex: 1 }}>
                {result.message}
              </Text>
            </Row>
          ) : null}
        </View>
      )}

      {result?.ok ? (
        <Text variant="small" tone="success">
          {result.accountHint ?? 'Key accepted'}
          {result.creditsRemaining !== undefined
            ? ` · $${result.creditsRemaining.toFixed(2)} credit left`
            : ''}
        </Text>
      ) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function ModelSection({
  providerId,
  chatModel,
  structuredModel,
}: {
  providerId: ProviderId;
  chatModel: string | null;
  structuredModel: string | null;
}) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [segment, setSegment] = useState<'recommended' | 'all'>('recommended');
  const [slot, setSlot] = useState<'chat' | 'structured'>('chat');

  const models = useDbQuery(
    async (database) => sortModels(providerId, await getCachedModels(database, providerId)),
    { events: ['ai:changed'] }
  );

  const all = models.data ?? [];
  // The cached rows do not carry the `recommended` flag, so derive it from the id.
  const shown =
    segment === 'recommended' ? all.filter((model) => isRecommended(providerId, model.id)) : all;

  const selected = slot === 'chat' ? chatModel : structuredModel ?? chatModel;

  if (all.length === 0) {
    return (
      <Card>
        <Text variant="h3">Model</Text>
        <Text variant="small" tone="muted">
          {models.loading
            ? 'Loading…'
            : 'Add a valid key above and the available models will appear here.'}
        </Text>
      </Card>
    );
  }

  return (
    <Card>
      <Text variant="h3">Model</Text>
      <Text variant="small" tone="muted">
        Conversation and grading can use different models. A cheap fast model is fine
        for chat, which is by far the most frequent call.
      </Text>

      <Row style={{ gap: theme.space.sm }}>
        <Chip label="Conversation" selected={slot === 'chat'} onPress={() => setSlot('chat')} />
        <Chip
          label="Grading"
          selected={slot === 'structured'}
          onPress={() => setSlot('structured')}
        />
      </Row>

      <Separator />

      <Row style={{ gap: theme.space.sm }}>
        <Chip
          label="Recommended"
          selected={segment === 'recommended'}
          onPress={() => setSegment('recommended')}
        />
        <Chip label={`All (${all.length})`} selected={segment === 'all'} onPress={() => setSegment('all')} />
      </Row>

      <ScrollView style={{ maxHeight: 320 }} nestedScrollEnabled>
        <View style={{ gap: theme.space.sm }}>
          {shown.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              selected={selected === model.id}
              onPress={() => {
                if (slot === 'chat') void setChatModel(db, model.id);
                else void setStructuredModel(db, model.id);
              }}
            />
          ))}
          {shown.length === 0 ? (
            <Text variant="small" tone="muted">
              Nothing matched. Try the All tab.
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </Card>
  );
}

function ModelRow({
  model,
  selected,
  onPress,
}: {
  model: ModelInfo;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const price =
    model.inputPricePerM !== undefined
      ? `$${model.inputPricePerM.toFixed(2)} in / $${(model.outputPricePerM ?? 0).toFixed(2)} out per 1M tokens`
      : 'price not published by this provider';

  return (
    <Pressable
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        padding: theme.space.md,
        borderRadius: theme.radius.md,
        backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surfaceAlt,
        borderWidth: 1,
        borderColor: selected ? theme.colors.primary : 'transparent',
        opacity: pressed ? 0.8 : 1,
        gap: 2,
      })}
    >
      <Row>
        <Text variant="smallStrong" style={{ flex: 1 }} numberOfLines={1}>
          {model.label}
        </Text>
        {selected ? (
          <Ionicons name="checkmark-circle" size={18} color={theme.colors.primary} />
        ) : null}
      </Row>
      <Text variant="caption" tone="faint" numberOfLines={1}>
        {model.id}
      </Text>
      <Text variant="caption" tone="faint">
        {price}
      </Text>
    </Pressable>
  );
}
