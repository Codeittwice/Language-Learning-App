/**
 * The one interface every AI provider implements.
 *
 * Screens never import a provider module directly -- they go through
 * `src/ai/registry.ts`. That keeps provider quirks (Gemini's schema dialect,
 * Anthropic's tool forcing, OpenRouter's capability probing) in one place.
 *
 * The three method shapes deliberately echo the Vercel AI SDK's generateText /
 * streamText / generateObject, so swapping to it later would be mechanical.
 */
import type { ZodType } from 'zod';

export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'openrouter';

export const PROVIDER_IDS: readonly ProviderId[] = [
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
] as const;

export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatMessage = { role: ChatRole; content: string };

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
};

export type StructuredRequest<T> = ChatRequest & {
  schema: ZodType<T>;
  /** Used as the JSON-schema name and the forced tool name. Keep it PascalCase. */
  schemaName: string;
  schemaDescription?: string;
};

export type Usage = {
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
};

export type ChatResult = { text: string; usage: Usage; raw: unknown };

export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string; usage: Usage };

/** Which rung of the structured-output ladder produced a result. */
export type SchemaStrategy = 'native_schema' | 'tool_force' | 'prompt_only' | 'repair';

export type StructuredResult<T> = {
  data: T;
  usage: Usage;
  strategy: SchemaStrategy;
  /** Including the first; 2 means one repair round trip was needed. */
  attempts: number;
};

/**
 * Everything a call needs that is not part of the prompt.
 *
 * Providers deliberately do no logging: `src/ai/call.ts` wraps every invocation and
 * writes the `ai_calls` row, so cost accounting cannot be forgotten in one provider.
 */
export type CallCtx = {
  apiKey: string;
  signal?: AbortSignal;
  /** Recorded on `ai_calls.purpose`, e.g. 'recall.evaluate'. */
  purpose: string;
  sessionId?: string;
  stage?: string;
};

export type CallMode = 'chat' | 'stream' | 'structured';

/** What the wrapper records about one completed (or failed) call. */
export type CallMeta = {
  provider: ProviderId;
  model: string;
  mode: CallMode;
  purpose: string;
  sessionId?: string;
  stage?: string;
  strategy?: SchemaStrategy;
  usage: Usage;
  latencyMs: number;
  httpStatus?: number;
  ok: boolean;
  retries: number;
  errorCode?: string;
  errorMessage?: string;
};

export type ModelInfo = {
  id: string;
  label: string;
  contextWindow?: number;
  supportsJsonSchema: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  inputPricePerM?: number;
  outputPricePerM?: number;
  /** Surfaced in the "Recommended" segment of the picker. */
  recommended?: boolean;
};

export type KeyValidation =
  | {
      ok: true;
      /** e.g. an account label or "12 models available". */
      accountHint?: string;
      creditsRemaining?: number;
      modelCount: number;
    }
  | {
      ok: false;
      reason: 'invalid_key' | 'no_access' | 'rate_limited' | 'network' | 'unknown';
      message: string;
    };

export interface AiProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** Where to get a key, shown next to the input. */
  readonly keyHelpUrl: string;
  /** A cheap sanity check on paste, before spending a request. */
  readonly keyPattern: RegExp;
  /** Shown as the input placeholder. */
  readonly keyHint: string;

  validateKey(key: string, signal?: AbortSignal): Promise<KeyValidation>;
  listModels(key: string, signal?: AbortSignal): Promise<ModelInfo[]>;
  chat(req: ChatRequest, ctx: CallCtx): Promise<ChatResult>;
  streamChat(req: ChatRequest, ctx: CallCtx): AsyncIterable<StreamEvent>;
  structured<T>(req: StructuredRequest<T>, ctx: CallCtx): Promise<StructuredResult<T>>;
}
