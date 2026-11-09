/**
 * Deciding which of a provider's models to show, and in what order.
 *
 * Deliberately pattern-based rather than a hardcoded list of model names and prices.
 * Model line-ups change every few months, so a baked-in list would be wrong by the
 * time the app is used -- and inventing a price per token would be exactly the kind
 * of fabricated precision the spec forbids. Prices are shown only when the provider's
 * own API reports them (today that means OpenRouter); otherwise the UI shows token
 * counts and says the cost is unknown.
 */
import type { ModelInfo, ProviderId } from '@/ai/types';

/** Model families that cannot hold a conversation: embeddings, audio, images, etc. */
const NON_CHAT = [
  'embedding',
  'embed',
  'whisper',
  'tts',
  'text-to-speech',
  'dall-e',
  'image',
  'imagen',
  'moderation',
  'rerank',
  'transcribe',
  'realtime',
  'audio',
  'veo',
  'search-',
  'codex-mini',
  'babbage',
  'davinci',
  'instruct-beta',
  'aqa',
  'guard',
  'vision-only',
] as const;

/** Suffixes that mark an alias or a snapshot we would rather not surface by default. */
const DEPRIORITISED = ['preview', 'exp', 'experimental', 'alpha', 'beta', 'latest', 'thinking'] as const;

export function isLikelyChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  return !NON_CHAT.some((needle) => lower.includes(needle));
}

/**
 * Patterns that identify a provider's general-purpose conversational line-up. Ordered
 * best-first within each provider; anything unmatched still appears under "All".
 */
const RECOMMENDED: Record<ProviderId, readonly RegExp[]> = {
  openai: [/^gpt-\d/i, /^o\d/i, /^chatgpt/i],
  anthropic: [/opus/i, /sonnet/i, /haiku/i],
  gemini: [/^gemini-[\d.]+-pro/i, /^gemini-[\d.]+-flash/i, /^gemini/i],
  openrouter: [/anthropic\//i, /openai\//i, /google\//i],
};

/** Lower sorts earlier. Unmatched models get a large rank so they fall to the end. */
export function recommendRank(provider: ProviderId, id: string): number {
  const patterns = RECOMMENDED[provider];
  const index = patterns.findIndex((pattern) => pattern.test(id));
  const base = index === -1 ? 500 : index * 10;
  const lower = id.toLowerCase();
  const penalty = DEPRIORITISED.some((needle) => lower.includes(needle)) ? 5 : 0;
  return base + penalty;
}

export function isRecommended(provider: ProviderId, id: string): boolean {
  return recommendRank(provider, id) < 500;
}

/**
 * Default capability assumptions for providers whose model list does not report them.
 *
 * Optimistic on purpose: the structured-output ladder degrades gracefully when an
 * assumption is wrong, and `src/ai/capabilities.ts` remembers the rejection so the
 * same request is not paid for twice.
 */
export function assumedCapabilities(): {
  supportsJsonSchema: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
} {
  return { supportsJsonSchema: true, supportsTools: true, supportsStreaming: true };
}

/** Sort a model list for the picker: recommended first, then alphabetically. */
export function sortModels(provider: ProviderId, models: ModelInfo[]): ModelInfo[] {
  return [...models].sort((a, b) => {
    const rank = recommendRank(provider, a.id) - recommendRank(provider, b.id);
    if (rank !== 0) return rank;
    return a.id.localeCompare(b.id);
  });
}

/** Turn a raw model id into something readable, without inventing a marketing name. */
export function humaniseModelId(id: string): string {
  const tail = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  return tail
    .replace(/[-_]/g, ' ')
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .trim();
}
