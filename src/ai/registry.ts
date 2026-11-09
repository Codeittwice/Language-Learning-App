/**
 * The only way the rest of the app reaches a provider.
 *
 * Screens import from here, never from `src/ai/providers/*`, so that provider quirks
 * stay contained and adding a fifth provider touches exactly one map.
 */
import { anthropicProvider } from '@/ai/providers/anthropic';
import { geminiProvider } from '@/ai/providers/gemini';
import { openaiProvider } from '@/ai/providers/openai';
import { openrouterProvider } from '@/ai/providers/openrouter';
import { type AiProvider, PROVIDER_IDS, type ProviderId } from '@/ai/types';

export const PROVIDERS: Record<ProviderId, AiProvider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  openrouter: openrouterProvider,
};

export function getProvider(id: ProviderId): AiProvider {
  return PROVIDERS[id];
}

export function allProviders(): AiProvider[] {
  return PROVIDER_IDS.map((id) => PROVIDERS[id]);
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}
