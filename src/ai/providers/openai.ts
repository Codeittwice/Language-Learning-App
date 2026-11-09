/**
 * OpenAI, over the chat-completions format.
 * Structured output uses `response_format: json_schema` with strict mode.
 */
import { AiError } from '@/ai/errors';
import { requestJson } from '@/ai/http';
import {
  assumedCapabilities,
  humaniseModelId,
  isLikelyChatModel,
  isRecommended,
  sortModels,
} from '@/ai/model-info';
import {
  type CompatConfig,
  compatChat,
  compatHeaders,
  compatStream,
  compatStructured,
} from '@/ai/providers/openai-compatible';
import type {
  AiProvider,
  CallCtx,
  ChatRequest,
  ChatResult,
  KeyValidation,
  ModelInfo,
  StreamEvent,
  StructuredRequest,
  StructuredResult,
} from '@/ai/types';

const CONFIG: CompatConfig = {
  id: 'openai',
  baseUrl: 'https://api.openai.com/v1',
};

type ModelListResponse = { data?: { id?: string }[] };

export const openaiProvider: AiProvider = {
  id: 'openai',
  label: 'OpenAI',
  keyHelpUrl: 'https://platform.openai.com/api-keys',
  keyPattern: /^sk-[A-Za-z0-9_-]{20,}$/,
  keyHint: 'sk-...',

  async validateKey(key, signal) {
    try {
      const { data } = await requestJson<ModelListResponse>(`${CONFIG.baseUrl}/models`, {
        method: 'GET',
        headers: compatHeaders(CONFIG, key),
        signal,
        provider: 'openai',
      });
      const count = (data.data ?? []).filter((m) => typeof m.id === 'string').length;
      return { ok: true, modelCount: count, accountHint: `${count} models available` };
    } catch (error) {
      return failure(error);
    }
  },

  async listModels(key, signal) {
    const { data } = await requestJson<ModelListResponse>(`${CONFIG.baseUrl}/models`, {
      method: 'GET',
      headers: compatHeaders(CONFIG, key),
      signal,
      provider: 'openai',
    });
    const models: ModelInfo[] = (data.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string' && isLikelyChatModel(id))
      .map((id) => ({
        id,
        label: humaniseModelId(id),
        ...assumedCapabilities(),
        recommended: isRecommended('openai', id),
      }));
    return sortModels('openai', models);
  },

  chat(req: ChatRequest, ctx: CallCtx): Promise<ChatResult> {
    return compatChat(CONFIG, req, ctx);
  },

  streamChat(req: ChatRequest, ctx: CallCtx): AsyncIterable<StreamEvent> {
    return compatStream(CONFIG, req, ctx);
  },

  structured<T>(req: StructuredRequest<T>, ctx: CallCtx): Promise<StructuredResult<T>> {
    return compatStructured(CONFIG, req, ctx, {
      supportsJsonSchema: true,
      supportsTools: true,
    });
  },
};

/** Map a thrown error onto the validation result the settings screen renders. */
export function failure(error: unknown): KeyValidation {
  if (error instanceof AiError) {
    const reason =
      error.code === 'invalid_key'
        ? 'invalid_key'
        : error.code === 'no_access'
          ? 'no_access'
          : error.code === 'rate_limited'
            ? 'rate_limited'
            : error.code === 'network' || error.code === 'timeout' || error.code === 'offline'
              ? 'network'
              : 'unknown';
    return { ok: false, reason, message: error.userMessage };
  }
  return { ok: false, reason: 'unknown', message: 'Could not reach the provider.' };
}
