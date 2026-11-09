/**
 * Which provider and models are active, and resolving a call's credentials.
 *
 * Two model slots: `chatModel` drives conversation, `structuredModel` grades and
 * generates. They default to the same value, but splitting them lets a cheap fast
 * model handle Friend Mode (by far the highest-volume path) while something stronger
 * evaluates recall.
 */
import { getKey } from '@/ai/keys';
import { getProvider } from '@/ai/registry';
import type { AiProvider, ProviderId } from '@/ai/types';
import { AiError } from '@/ai/errors';
import {
  getNumberSetting,
  getSetting,
  getStringSetting,
  ProviderIdSchema,
  SETTING_KEYS,
  setSetting,
} from '@/db/repo/settings';
import type { SQLiteDatabase } from 'expo-sqlite';

export const DEFAULT_DAILY_CAP_USD = 0.5;

export type AiConfig = {
  provider: ProviderId | null;
  chatModel: string | null;
  structuredModel: string | null;
  dailyCapUsd: number;
};

export async function readAiConfig(db: SQLiteDatabase): Promise<AiConfig> {
  const [provider, chatModel, structuredModel, dailyCapUsd] = await Promise.all([
    getSetting(db, SETTING_KEYS.aiProvider, ProviderIdSchema.nullable(), null),
    getStringSetting(db, SETTING_KEYS.aiChatModel),
    getStringSetting(db, SETTING_KEYS.aiStructuredModel),
    getNumberSetting(db, SETTING_KEYS.aiDailyCapUsd, DEFAULT_DAILY_CAP_USD),
  ]);
  return { provider, chatModel, structuredModel, dailyCapUsd };
}

export async function setActiveProvider(
  db: SQLiteDatabase,
  provider: ProviderId
): Promise<void> {
  await setSetting(db, SETTING_KEYS.aiProvider, provider);
}

/** Setting the chat model also sets the structured model until one is chosen. */
export async function setChatModel(db: SQLiteDatabase, modelId: string): Promise<void> {
  await setSetting(db, SETTING_KEYS.aiChatModel, modelId);
  const existing = await getStringSetting(db, SETTING_KEYS.aiStructuredModel);
  if (!existing) await setSetting(db, SETTING_KEYS.aiStructuredModel, modelId);
}

export async function setStructuredModel(
  db: SQLiteDatabase,
  modelId: string
): Promise<void> {
  await setSetting(db, SETTING_KEYS.aiStructuredModel, modelId);
}

export async function setDailyCap(db: SQLiteDatabase, usd: number): Promise<void> {
  await setSetting(db, SETTING_KEYS.aiDailyCapUsd, Math.max(0, usd));
}

export type ResolvedCall = {
  provider: AiProvider;
  providerId: ProviderId;
  apiKey: string;
  model: string;
};

/** True when the app has everything it needs to make an AI call. */
export async function isAiReady(db: SQLiteDatabase): Promise<boolean> {
  const config = await readAiConfig(db);
  if (!config.provider || !config.chatModel) return false;
  return (await getKey(config.provider)) !== null;
}

/**
 * Resolve the provider, key and model for a call. Throws a user-presentable AiError
 * when the app is not configured, which every call site turns into a prompt to open
 * Settings rather than a crash.
 */
export async function resolveCall(
  db: SQLiteDatabase,
  slot: 'chat' | 'structured'
): Promise<ResolvedCall> {
  const config = await readAiConfig(db);
  if (!config.provider) {
    throw new AiError('invalid_key', 'No AI provider chosen yet. Open Settings to add a key.');
  }
  const model = slot === 'structured' ? config.structuredModel ?? config.chatModel : config.chatModel;
  if (!model) {
    throw new AiError('no_access', 'No model chosen yet. Open Settings to pick one.');
  }
  const apiKey = await getKey(config.provider);
  if (!apiKey) {
    throw new AiError('invalid_key', 'No API key stored. Open Settings to add one.');
  }
  return {
    provider: getProvider(config.provider),
    providerId: config.provider,
    apiKey,
    model,
  };
}
