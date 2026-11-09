/**
 * OpenRouter. OpenAI-compatible on the wire, but structured-output support varies by
 * the model it routes to, so we read each model's `supported_parameters` instead of
 * discovering the limits by paying for a failed request.
 *
 * `require_parameters: true` in the provider block stops OpenRouter silently routing
 * to a backend that drops `response_format` -- which would return prose where we
 * expect JSON, with a 200 status and no hint that anything was ignored.
 */
import { requestJson } from '@/ai/http';
import { humaniseModelId, isLikelyChatModel, isRecommended, sortModels } from '@/ai/model-info';
import {
  type CompatConfig,
  compatChat,
  compatHeaders,
  compatStream,
  compatStructured,
} from '@/ai/providers/openai-compatible';
import { failure } from '@/ai/providers/openai';
import type {
  AiProvider,
  CallCtx,
  ChatRequest,
  ChatResult,
  ModelInfo,
  StreamEvent,
  StructuredRequest,
  StructuredResult,
} from '@/ai/types';

const BASE_URL = 'https://openrouter.ai/api/v1';

const CONFIG: CompatConfig = {
  id: 'openrouter',
  baseUrl: BASE_URL,
  extraHeaders: {
    // OpenRouter uses these for attribution in its dashboard. Neither identifies the
    // learner; no personal data is sent.
    'HTTP-Referer': 'https://github.com/dutch-with-friends',
    'X-Title': 'Dutch with Friends',
  },
  extraBody: {
    provider: { require_parameters: true },
  },
};

type OpenRouterModel = {
  id?: string;
  name?: string;
  context_length?: number;
  supported_parameters?: string[];
  pricing?: { prompt?: string; completion?: string };
};

type ModelsResponse = { data?: OpenRouterModel[] };

type KeyResponse = {
  data?: { label?: string; limit?: number | null; usage?: number; limit_remaining?: number | null };
};

/** OpenRouter quotes price per token as a decimal string; we display per million. */
function perMillion(price: string | undefined): number | undefined {
  if (!price) return undefined;
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value * 1_000_000;
}

function toModelInfo(entry: OpenRouterModel): ModelInfo | null {
  const id = entry.id;
  if (typeof id !== 'string' || !isLikelyChatModel(id)) return null;
  const params = entry.supported_parameters ?? [];
  return {
    id,
    label: entry.name ?? humaniseModelId(id),
    contextWindow: entry.context_length,
    supportsJsonSchema:
      params.includes('response_format') || params.includes('structured_outputs'),
    supportsTools: params.includes('tools') || params.includes('tool_choice'),
    supportsStreaming: true,
    inputPricePerM: perMillion(entry.pricing?.prompt),
    outputPricePerM: perMillion(entry.pricing?.completion),
    recommended: isRecommended('openrouter', id),
  };
}

/** The model list is public, so this works before a key is entered. */
export async function fetchOpenRouterModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  const { data } = await requestJson<ModelsResponse>(`${BASE_URL}/models`, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
    signal,
    provider: 'openrouter',
  });
  const models = (data.data ?? [])
    .map(toModelInfo)
    .filter((model): model is ModelInfo => model !== null);
  return sortModels('openrouter', models);
}

export const openrouterProvider: AiProvider = {
  id: 'openrouter',
  label: 'OpenRouter',
  keyHelpUrl: 'https://openrouter.ai/keys',
  keyPattern: /^sk-or-[A-Za-z0-9_-]{16,}$/,
  keyHint: 'sk-or-v1-...',

  async validateKey(key, signal) {
    try {
      const [keyInfo, models] = await Promise.all([
        requestJson<KeyResponse>(`${BASE_URL}/key`, {
          method: 'GET',
          headers: compatHeaders(CONFIG, key),
          signal,
          provider: 'openrouter',
        }),
        fetchOpenRouterModels(signal).catch(() => [] as ModelInfo[]),
      ]);
      const info = keyInfo.data.data;
      const remaining = info?.limit_remaining;
      return {
        ok: true,
        modelCount: models.length,
        accountHint: info?.label ?? undefined,
        creditsRemaining: typeof remaining === 'number' ? remaining : undefined,
      };
    } catch (error) {
      return failure(error);
    }
  },

  listModels(_key, signal) {
    return fetchOpenRouterModels(signal);
  },

  chat(req: ChatRequest, ctx: CallCtx): Promise<ChatResult> {
    return compatChat(CONFIG, req, ctx);
  },

  streamChat(req: ChatRequest, ctx: CallCtx): AsyncIterable<StreamEvent> {
    return compatStream(CONFIG, req, ctx);
  },

  structured<T>(req: StructuredRequest<T>, ctx: CallCtx): Promise<StructuredResult<T>> {
    // Capabilities come from the cached `ai_models` row via src/ai/call.ts, which
    // passes them through on the request. Defaulting both to true here only means the
    // ladder tries the better rung first and falls back if it is rejected.
    return compatStructured(CONFIG, req, ctx, {
      supportsJsonSchema: true,
      supportsTools: true,
    });
  },
};
