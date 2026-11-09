/**
 * Anthropic Messages API.
 *
 * Three things differ from the OpenAI shape and each one is a 400 if you get it wrong:
 *  - `system` is a top-level string, not a message with role 'system'.
 *  - `max_tokens` is required, not optional.
 *  - messages must alternate user/assistant and begin with user.
 *
 * Structured output is forced tool use, which is Anthropic's own mechanism for it and
 * the most reliable rung of the whole ladder.
 */
import { AiError, AiStructuredError } from '@/ai/errors';
import { requestJson, streamSse } from '@/ai/http';
import { toAnthropicToolSchema } from '@/ai/json-schema';
import { humaniseModelId, isRecommended, sortModels } from '@/ai/model-info';
import { failure } from '@/ai/providers/openai';
import { parseAgainst } from '@/ai/providers/openai-compatible';
import type {
  AiProvider,
  CallCtx,
  ChatMessage,
  ChatRequest,
  ChatResult,
  ModelInfo,
  StreamEvent,
  StructuredRequest,
  StructuredResult,
  Usage,
} from '@/ai/types';

const BASE_URL = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';

/** Anthropic requires this; 2048 is comfortably above anything we ask for. */
const DEFAULT_MAX_TOKENS = 2048;

function headers(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
  };
}

type TurnRole = 'user' | 'assistant';
type Turn = { role: TurnRole; content: string };

/**
 * Split out the system prompt and coerce the rest into a valid alternating sequence.
 * Consecutive same-role turns are merged rather than dropped, so nothing the learner
 * wrote is silently lost.
 */
export function normaliseMessages(messages: ChatMessage[]): {
  system: string | undefined;
  turns: Turn[];
} {
  const systemParts: string[] = [];
  const turns: Turn[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }
    const role: TurnRole = message.role === 'assistant' ? 'assistant' : 'user';
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n\n${message.content}`;
    } else {
      turns.push({ role, content: message.content });
    }
  }

  // The sequence must open with a user turn.
  while (turns.length > 0 && turns[0]!.role === 'assistant') turns.shift();
  if (turns.length === 0) turns.push({ role: 'user', content: 'Begin.' });

  return { system: systemParts.length ? systemParts.join('\n\n') : undefined, turns };
}

type ContentBlock =
  | { type: 'text'; text?: string }
  | { type: 'tool_use'; name?: string; input?: unknown }
  | { type: string; [key: string]: unknown };

type MessagesResponse = {
  content?: ContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

function readUsage(response: MessagesResponse): Usage {
  const usage = response.usage;
  if (!usage) return {};
  return {
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    cachedTokens: usage.cache_read_input_tokens,
  };
}

function textOf(response: MessagesResponse): string {
  return (response.content ?? [])
    .filter((block): block is { type: 'text'; text?: string } => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
}

function body(req: ChatRequest): Record<string, unknown> {
  const { system, turns } = normaliseMessages(req.messages);
  const payload: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: turns,
  };
  if (system) payload.system = system;
  if (req.temperature !== undefined) payload.temperature = req.temperature;
  if (req.stopSequences?.length) payload.stop_sequences = req.stopSequences;
  return payload;
}

type AnthropicModel = { id?: string; display_name?: string };
type ModelsResponse = { data?: AnthropicModel[] };

export const anthropicProvider: AiProvider = {
  id: 'anthropic',
  label: 'Anthropic',
  keyHelpUrl: 'https://console.anthropic.com/settings/keys',
  keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
  keyHint: 'sk-ant-...',

  async validateKey(key, signal) {
    try {
      const { data } = await requestJson<ModelsResponse>(`${BASE_URL}/models`, {
        method: 'GET',
        headers: headers(key),
        signal,
        provider: 'anthropic',
      });
      const count = (data.data ?? []).filter((m) => typeof m.id === 'string').length;
      return { ok: true, modelCount: count, accountHint: `${count} models available` };
    } catch (error) {
      return failure(error);
    }
  },

  async listModels(key, signal) {
    const { data } = await requestJson<ModelsResponse>(`${BASE_URL}/models?limit=100`, {
      method: 'GET',
      headers: headers(key),
      signal,
      provider: 'anthropic',
    });
    const models: ModelInfo[] = (data.data ?? [])
      .filter((entry): entry is { id: string; display_name?: string } => typeof entry.id === 'string')
      .map((entry) => ({
        id: entry.id,
        label: entry.display_name ?? humaniseModelId(entry.id),
        supportsJsonSchema: false, // Anthropic uses forced tool use instead.
        supportsTools: true,
        supportsStreaming: true,
        recommended: isRecommended('anthropic', entry.id),
      }));
    return sortModels('anthropic', models);
  },

  async chat(req, ctx): Promise<ChatResult> {
    const { data } = await requestJson<MessagesResponse>(`${BASE_URL}/messages`, {
      headers: headers(ctx.apiKey),
      body: body(req),
      signal: ctx.signal,
      provider: 'anthropic',
      model: req.model,
    });
    return { text: textOf(data), usage: readUsage(data), raw: data };
  },

  async *streamChat(req, ctx): AsyncGenerator<StreamEvent, void, undefined> {
    let text = '';
    const usage: Usage = {};

    for await (const payload of streamSse(`${BASE_URL}/messages`, {
      headers: headers(ctx.apiKey),
      body: { ...body(req), stream: true },
      signal: ctx.signal,
      provider: 'anthropic',
      model: req.model,
    })) {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }

      const type = frame.type;

      if (type === 'content_block_delta') {
        const delta = frame.delta as { type?: string; text?: string } | undefined;
        if (delta?.type === 'text_delta' && delta.text) {
          text += delta.text;
          yield { type: 'delta', text: delta.text };
        }
        continue;
      }
      // Input tokens arrive with message_start, output tokens with message_delta.
      if (type === 'message_start') {
        const message = frame.message as MessagesResponse | undefined;
        const seed = message ? readUsage(message) : {};
        if (seed.promptTokens !== undefined) usage.promptTokens = seed.promptTokens;
        if (seed.cachedTokens !== undefined) usage.cachedTokens = seed.cachedTokens;
        continue;
      }
      if (type === 'message_delta') {
        const delta = frame.usage as { output_tokens?: number } | undefined;
        if (delta?.output_tokens !== undefined) usage.completionTokens = delta.output_tokens;
        continue;
      }
      if (type === 'error') {
        const error = frame.error as { message?: string } | undefined;
        throw new AiError('bad_response', error?.message ?? 'Anthropic stream error', {
          provider: 'anthropic',
          model: req.model,
        });
      }
    }

    yield { type: 'done', text, usage };
  },

  async structured<T>(req: StructuredRequest<T>, ctx: CallCtx): Promise<StructuredResult<T>> {
    const tool = toAnthropicToolSchema(req.schema, req.schemaName, req.schemaDescription);

    const { data } = await requestJson<MessagesResponse>(`${BASE_URL}/messages`, {
      headers: headers(ctx.apiKey),
      body: {
        ...body(req),
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
      },
      signal: ctx.signal,
      provider: 'anthropic',
      model: req.model,
    });

    const usage = readUsage(data);
    const toolUse = (data.content ?? []).find(
      (block): block is { type: 'tool_use'; name?: string; input?: unknown } =>
        block.type === 'tool_use'
    );

    if (toolUse) {
      const parsed = req.schema.safeParse(toolUse.input);
      if (parsed.success) {
        return { data: parsed.data, usage, strategy: 'tool_force', attempts: 1 };
      }
    }

    // Forced tool use almost never fails, but if it does, try parsing the text body
    // before giving up so the caller still gets a usable answer.
    const fallback = parseAgainst(req.schema, textOf(data));
    if (fallback.ok) {
      return { data: fallback.value, usage, strategy: 'prompt_only', attempts: 1 };
    }

    throw new AiStructuredError(
      `Anthropic could not produce valid ${req.schemaName}`,
      JSON.stringify(toolUse?.input ?? textOf(data)).slice(0, 2000),
      'tool_force',
      { provider: 'anthropic', model: req.model }
    );
  },
};
