/**
 * Shared implementation for the OpenAI chat-completions wire format, which both
 * OpenAI and OpenRouter speak. Everything provider-specific is passed in as config.
 */
import { AiError, AiStructuredError } from '@/ai/errors';
import { requestJson, streamSse } from '@/ai/http';
import { schemaAsPromptText, toOpenAiStrictSchema } from '@/ai/json-schema';
import { extractJson } from '@/ai/repair';
import type {
  CallCtx,
  ChatMessage,
  ChatRequest,
  ChatResult,
  ProviderId,
  SchemaStrategy,
  StreamEvent,
  StructuredRequest,
  StructuredResult,
  Usage,
} from '@/ai/types';
import { z } from 'zod';

export type CompatConfig = {
  id: ProviderId;
  baseUrl: string;
  /** Extra headers beyond content-type and Authorization. */
  extraHeaders?: Record<string, string>;
  /** Merged into every request body, e.g. OpenRouter's provider routing block. */
  extraBody?: Record<string, unknown>;
};

type CompletionChoice = {
  message?: { content?: string | null; tool_calls?: { function?: { arguments?: string } }[] };
  delta?: { content?: string | null };
  finish_reason?: string | null;
};

type CompletionResponse = {
  choices?: CompletionChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};

export function compatHeaders(config: CompatConfig, apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
    ...config.extraHeaders,
  };
}

function readUsage(response: CompletionResponse): Usage {
  const usage = response.usage;
  if (!usage) return {};
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
  };
}

function baseBody(config: CompatConfig, req: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    ...config.extraBody,
  };
  // Newer OpenAI models reject `max_tokens` in favour of this name.
  if (req.maxTokens !== undefined) body.max_completion_tokens = req.maxTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.stopSequences?.length) body.stop = req.stopSequences;
  return body;
}

/**
 * Some models reject parameters others require -- reasoning models refuse
 * `temperature`, older ones refuse `max_completion_tokens`. Rather than maintain a
 * per-model capability table that goes stale, drop the offending optional parameter
 * and retry once. Only ever drops parameters we added optionally.
 */
const DROPPABLE = ['temperature', 'max_completion_tokens', 'stop'] as const;

function offendingParameter(message: string): (typeof DROPPABLE)[number] | null {
  if (!/unsupported|not supported|unrecognized|unknown parameter|invalid_request/i.test(message)) {
    return null;
  }
  return DROPPABLE.find((name) => message.includes(name)) ?? null;
}

async function postCompletion(
  config: CompatConfig,
  body: Record<string, unknown>,
  ctx: CallCtx,
  model: string
): Promise<{ data: CompletionResponse; status: number }> {
  let attemptBody = body;

  for (let attempt = 0; attempt < DROPPABLE.length + 1; attempt += 1) {
    try {
      const result = await requestJson<CompletionResponse>(
        `${config.baseUrl}/chat/completions`,
        {
          headers: compatHeaders(config, ctx.apiKey),
          body: attemptBody,
          signal: ctx.signal,
          provider: config.id,
          model,
        }
      );
      return { data: result.data, status: result.status };
    } catch (error) {
      const dropped =
        error instanceof AiError && error.code === 'bad_request'
          ? offendingParameter(error.message)
          : null;
      if (!dropped || !(dropped in attemptBody)) throw error;
      const next = { ...attemptBody };
      delete next[dropped];
      attemptBody = next;
    }
  }
  throw new AiError('bad_request', `${config.id} rejected every parameter combination`, {
    provider: config.id,
    model,
  });
}

export async function compatChat(
  config: CompatConfig,
  req: ChatRequest,
  ctx: CallCtx
): Promise<ChatResult> {
  const { data } = await postCompletion(config, baseBody(config, req), ctx, req.model);
  const text = data.choices?.[0]?.message?.content ?? '';
  return { text, usage: readUsage(data), raw: data };
}

export async function* compatStream(
  config: CompatConfig,
  req: ChatRequest,
  ctx: CallCtx
): AsyncGenerator<StreamEvent, void, undefined> {
  const body = {
    ...baseBody(config, req),
    stream: true,
    // Without this, a streamed response reports no usage at all and we cannot cost it.
    stream_options: { include_usage: true },
  };

  let text = '';
  let usage: Usage = {};

  for await (const payload of streamSse(`${config.baseUrl}/chat/completions`, {
    headers: compatHeaders(config, ctx.apiKey),
    body,
    signal: ctx.signal,
    provider: config.id,
    model: req.model,
  })) {
    let frame: CompletionResponse;
    try {
      frame = JSON.parse(payload) as CompletionResponse;
    } catch {
      continue; // A keep-alive or a malformed frame is not fatal mid-stream.
    }
    if (frame.usage) usage = readUsage(frame);
    const delta = frame.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta.length > 0) {
      text += delta;
      yield { type: 'delta', text: delta };
    }
  }

  yield { type: 'done', text, usage };
}

export type CompatCapabilities = {
  supportsJsonSchema: boolean;
  supportsTools: boolean;
  /**
   * Called when a rung is rejected outright, so the caller can remember this model
   * cannot do it and stop paying for the same failed request next time.
   */
  onStrategyRejected?: (strategy: SchemaStrategy) => void;
};

export async function compatStructured<T>(
  config: CompatConfig,
  req: StructuredRequest<T>,
  ctx: CallCtx,
  capabilities: CompatCapabilities
): Promise<StructuredResult<T>> {
  const attempts: { strategy: SchemaStrategy; body: Record<string, unknown> }[] = [];
  const base = baseBody(config, req);

  if (capabilities.supportsJsonSchema) {
    attempts.push({
      strategy: 'native_schema',
      body: {
        ...base,
        response_format: {
          type: 'json_schema',
          json_schema: toOpenAiStrictSchema(req.schema, req.schemaName),
        },
      },
    });
  }

  if (capabilities.supportsTools) {
    const strict = toOpenAiStrictSchema(req.schema, req.schemaName);
    const toolName = `emit_${req.schemaName}`;
    attempts.push({
      strategy: 'tool_force',
      body: {
        ...base,
        tools: [
          {
            type: 'function',
            function: {
              name: toolName,
              description:
                req.schemaDescription ?? `Return the ${req.schemaName} result exactly once.`,
              parameters: strict.schema,
              strict: true,
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: toolName } },
      },
    });
  }

  attempts.push({
    strategy: 'prompt_only',
    body: {
      ...base,
      messages: withSchemaInstruction(req.messages, schemaAsPromptText(req.schema, req.schemaName)),
      response_format: { type: 'json_object' },
    },
  });

  let lastText = '';
  let lastStrategy: SchemaStrategy = 'prompt_only';
  let lastUsage: Usage = {};
  let calls = 0;

  for (const attempt of attempts) {
    calls += 1;
    lastStrategy = attempt.strategy;
    let data: CompletionResponse;
    try {
      ({ data } = await postCompletion(config, attempt.body, ctx, req.model));
    } catch (error) {
      // A 400 here usually means the model does not support this rung; try the next.
      if (error instanceof AiError && error.code === 'bad_request') {
        capabilities.onStrategyRejected?.(attempt.strategy);
        continue;
      }
      throw error;
    }

    lastUsage = readUsage(data);
    const choice = data.choices?.[0];
    lastText =
      choice?.message?.tool_calls?.[0]?.function?.arguments ?? choice?.message?.content ?? '';

    const parsed = parseAgainst(req.schema, lastText);
    if (parsed.ok) {
      return { data: parsed.value, usage: lastUsage, strategy: attempt.strategy, attempts: calls };
    }

    // One repair round trip, carrying Zod's path-annotated complaint.
    calls += 1;
    const repair = await postCompletion(
      config,
      {
        ...base,
        messages: [
          ...req.messages,
          { role: 'assistant' as const, content: lastText.slice(0, 4000) },
          {
            role: 'user' as const,
            content:
              `That did not match the schema:\n${parsed.error}\n\n` +
              'Reply with the corrected JSON object only.',
          },
        ],
        response_format: { type: 'json_object' },
      },
      ctx,
      req.model
    ).catch(() => null);

    if (repair) {
      lastUsage = readUsage(repair.data);
      lastText = repair.data.choices?.[0]?.message?.content ?? '';
      const retry = parseAgainst(req.schema, lastText);
      if (retry.ok) {
        return { data: retry.value, usage: lastUsage, strategy: 'repair', attempts: calls };
      }
    }
  }

  throw new AiStructuredError(
    `${config.id} could not produce valid ${req.schemaName}`,
    lastText,
    lastStrategy,
    { provider: config.id, model: req.model }
  );
}

/** Append the schema instruction to the system turn, or add one if there is none. */
export function withSchemaInstruction(
  messages: ChatMessage[],
  instruction: string
): ChatMessage[] {
  const systemIndex = messages.findIndex((m) => m.role === 'system');
  if (systemIndex === -1) {
    return [{ role: 'system', content: instruction }, ...messages];
  }
  return messages.map((message, index) =>
    index === systemIndex
      ? { ...message, content: `${message.content}\n\n${instruction}` }
      : message
  );
}

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** Extract JSON from model output and validate it, returning a readable error. */
export function parseAgainst<T>(schema: z.ZodType<T>, text: string): ParseOutcome<T> {
  const extracted = extractJson(text);
  if (!extracted.ok) {
    return { ok: false, error: `Response was not valid JSON (${extracted.reason}).` };
  }
  const result = schema.safeParse(extracted.value);
  if (!result.success) return { ok: false, error: z.prettifyError(result.error) };
  return { ok: true, value: result.data };
}
