/**
 * Google Gemini, via the Generative Language API.
 *
 * Two deliberate choices:
 *
 *  - The key goes in an `x-goog-api-key` header, not the `?key=` query parameter the
 *    docs lead with. Same authentication, but a secret in a URL ends up in logs,
 *    crash reports and network inspectors.
 *  - Streaming uses `?alt=sse`, so Gemini produces the same frame format as the other
 *    three and shares one parser. Its default streaming response is a JSON array,
 *    which would need a second, bespoke reader.
 */
import { requestJson, streamSse } from '@/ai/http';
import { toGeminiResponseSchema } from '@/ai/json-schema';
import { humaniseModelId, isLikelyChatModel, isRecommended, sortModels } from '@/ai/model-info';
import { failure } from '@/ai/providers/openai';
import { parseAgainst } from '@/ai/providers/openai-compatible';
import { AiStructuredError } from '@/ai/errors';
import type {
  AiProvider,
  CallCtx,
  ChatRequest,
  ChatResult,
  ModelInfo,
  StreamEvent,
  StructuredRequest,
  StructuredResult,
  Usage,
} from '@/ai/types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function headers(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-goog-api-key': apiKey };
}

/** Model ids come back as `models/gemini-...`; the URL path wants the bare id. */
export function bareModelId(id: string): string {
  return id.startsWith('models/') ? id.slice('models/'.length) : id;
}

type GeminiPart = { text?: string };
type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
  };
};

function readUsage(response: GeminiResponse): Usage {
  const usage = response.usageMetadata;
  if (!usage) return {};
  return {
    promptTokens: usage.promptTokenCount,
    completionTokens: usage.candidatesTokenCount,
    cachedTokens: usage.cachedContentTokenCount,
    reasoningTokens: usage.thoughtsTokenCount,
  };
}

function textOf(response: GeminiResponse): string {
  return (response.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('');
}

/** Gemini calls the assistant role "model", and takes the system prompt separately. */
function body(req: ChatRequest): Record<string, unknown> {
  const systemParts: string[] = [];
  const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];

  for (const message of req.messages) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }
    const role = message.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push({ text: message.content });
    } else {
      contents.push({ role, parts: [{ text: message.content }] });
    }
  }

  const generationConfig: Record<string, unknown> = {};
  if (req.maxTokens !== undefined) generationConfig.maxOutputTokens = req.maxTokens;
  if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
  if (req.stopSequences?.length) generationConfig.stopSequences = req.stopSequences;

  const payload: Record<string, unknown> = { contents };
  if (systemParts.length) {
    payload.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] };
  }
  if (Object.keys(generationConfig).length) payload.generationConfig = generationConfig;
  return payload;
}

type GeminiModel = {
  name?: string;
  displayName?: string;
  inputTokenLimit?: number;
  supportedGenerationMethods?: string[];
};
type ModelsResponse = { models?: GeminiModel[] };

export const geminiProvider: AiProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  keyHelpUrl: 'https://aistudio.google.com/apikey',
  keyPattern: /^AIza[A-Za-z0-9_-]{30,}$/,
  keyHint: 'AIza...',

  async validateKey(key, signal) {
    try {
      const { data } = await requestJson<ModelsResponse>(`${BASE_URL}/models?pageSize=200`, {
        method: 'GET',
        headers: headers(key),
        signal,
        provider: 'gemini',
      });
      const count = (data.models ?? []).length;
      return { ok: true, modelCount: count, accountHint: `${count} models available` };
    } catch (error) {
      return failure(error);
    }
  },

  async listModels(key, signal) {
    const { data } = await requestJson<ModelsResponse>(`${BASE_URL}/models?pageSize=200`, {
      method: 'GET',
      headers: headers(key),
      signal,
      provider: 'gemini',
    });
    const models: ModelInfo[] = (data.models ?? [])
      .filter((entry) => {
        const methods = entry.supportedGenerationMethods ?? [];
        // Only models that can actually answer a chat turn.
        return methods.length === 0 || methods.includes('generateContent');
      })
      .map((entry) => bareModelId(entry.name ?? ''))
      .filter((id) => id.length > 0 && isLikelyChatModel(id))
      .map((id) => ({
        id,
        label: humaniseModelId(id),
        supportsJsonSchema: true,
        supportsTools: true,
        supportsStreaming: true,
        recommended: isRecommended('gemini', id),
      }));
    return sortModels('gemini', models);
  },

  async chat(req, ctx): Promise<ChatResult> {
    const model = bareModelId(req.model);
    const { data } = await requestJson<GeminiResponse>(
      `${BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
      {
        headers: headers(ctx.apiKey),
        body: body(req),
        signal: ctx.signal,
        provider: 'gemini',
        model,
      }
    );
    return { text: textOf(data), usage: readUsage(data), raw: data };
  },

  async *streamChat(req, ctx): AsyncGenerator<StreamEvent, void, undefined> {
    const model = bareModelId(req.model);
    let text = '';
    let usage: Usage = {};

    for await (const payload of streamSse(
      `${BASE_URL}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      {
        headers: headers(ctx.apiKey),
        body: body(req),
        signal: ctx.signal,
        provider: 'gemini',
        model,
      }
    )) {
      let frame: GeminiResponse;
      try {
        frame = JSON.parse(payload) as GeminiResponse;
      } catch {
        continue;
      }
      if (frame.usageMetadata) usage = readUsage(frame);
      const delta = textOf(frame);
      if (delta) {
        text += delta;
        yield { type: 'delta', text: delta };
      }
    }

    yield { type: 'done', text, usage };
  },

  async structured<T>(req: StructuredRequest<T>, ctx: CallCtx): Promise<StructuredResult<T>> {
    const model = bareModelId(req.model);
    const base = body(req);
    const generationConfig = {
      ...((base.generationConfig as Record<string, unknown>) ?? {}),
      responseMimeType: 'application/json',
      responseSchema: toGeminiResponseSchema(req.schema),
    };

    const { data } = await requestJson<GeminiResponse>(
      `${BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
      {
        headers: headers(ctx.apiKey),
        body: { ...base, generationConfig },
        signal: ctx.signal,
        provider: 'gemini',
        model,
      }
    );

    const usage = readUsage(data);
    const text = textOf(data);
    const parsed = parseAgainst(req.schema, text);
    if (parsed.ok) {
      return { data: parsed.value, usage, strategy: 'native_schema', attempts: 1 };
    }

    // One repair round trip carrying Zod's path-annotated complaint.
    const repair = await requestJson<GeminiResponse>(
      `${BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
      {
        headers: headers(ctx.apiKey),
        body: {
          ...body({
            ...req,
            messages: [
              ...req.messages,
              { role: 'assistant', content: text.slice(0, 4000) },
              {
                role: 'user',
                content:
                  `That did not match the schema:\n${parsed.error}\n\n` +
                  'Reply with the corrected JSON object only.',
              },
            ],
          }),
          generationConfig,
        },
        signal: ctx.signal,
        provider: 'gemini',
        model,
      }
    ).catch(() => null);

    if (repair) {
      const retry = parseAgainst(req.schema, textOf(repair.data));
      if (retry.ok) {
        return {
          data: retry.value,
          usage: readUsage(repair.data),
          strategy: 'repair',
          attempts: 2,
        };
      }
    }

    throw new AiStructuredError(
      `Gemini could not produce valid ${req.schemaName}`,
      text,
      'native_schema',
      { provider: 'gemini', model }
    );
  },
};
