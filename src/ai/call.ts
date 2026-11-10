/**
 * The call wrapper every feature uses.
 *
 * It owns the things that must never be forgotten in one provider or one screen:
 * resolving the active provider and key, retrying only transient failures, costing
 * the call, writing the `ai_calls` row on success *and* failure, and remembering when
 * a model rejects a structured-output strategy.
 *
 * Features call `aiChat`, `aiStream` or `aiStructured` and nothing else.
 */
import { costOf } from '@/ai/cost';
import { AiError, redactUnknown, wrapTransportError } from '@/ai/errors';
import { resolveCall } from '@/ai/config';
import { withRetry } from '@/ai/retry';
import type {
  CallMeta,
  CallMode,
  ChatMessage,
  SchemaStrategy,
  StreamEvent,
  Usage,
} from '@/ai/types';
import { getCachedModel, logAiCall, markStrategyUnsupported } from '@/db/repo/ai-calls';
import { currentDayKey } from '@/db/repo/profile';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { ZodType } from 'zod';

export type AiCallOptions = {
  purpose: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  sessionId?: string;
  stage?: string;
  onCallLogged?: (id: number) => void;
};

/**
 * Log one attempt. Never throws: a failed write to the ledger must not turn a working
 * AI response into an error the learner sees.
 */
async function record(
  db: SQLiteDatabase,
  meta: CallMeta,
  usage: Usage,
  onCallLogged?: (id: number) => void
): Promise<void> {
  try {
    const model = await getCachedModel(db, meta.provider, meta.model);
    const cost = costOf(usage, model);
    const dayKey = await currentDayKey(db);
    const id = await logAiCall(db, meta, cost, dayKey);
    onCallLogged?.(id);
  } catch (error) {
    console.warn('[ai] could not record call in the ledger', redactUnknown(error));
  }
}

type RunResult<T> = { value: T; usage: Usage; strategy?: SchemaStrategy };

/** Shared timing, retry, logging and error mapping around one provider method. */
async function run<T>(
  db: SQLiteDatabase,
  mode: CallMode,
  options: AiCallOptions,
  slot: 'chat' | 'structured',
  invoke: (resolved: Awaited<ReturnType<typeof resolveCall>>) => Promise<RunResult<T>>
): Promise<T> {
  const resolved = await resolveCall(db, slot);
  const startedAt = Date.now();
  let retries = 0;

  const base: Omit<CallMeta, 'usage' | 'latencyMs' | 'ok' | 'retries'> = {
    provider: resolved.providerId,
    model: resolved.model,
    mode,
    purpose: options.purpose,
    sessionId: options.sessionId,
    stage: options.stage,
  };

  try {
    const result = await withRetry(
      async () => invoke(resolved),
      {
        signal: options.signal,
        onRetry: () => {
          retries += 1;
        },
      }
    );

    await record(
      db,
      {
        ...base,
        strategy: result.strategy,
        usage: result.usage,
        latencyMs: Date.now() - startedAt,
        ok: true,
        retries,
      },
      result.usage,
      options.onCallLogged
    );
    return result.value;
  } catch (error) {
    const aiError = error instanceof AiError ? error : wrapTransportError(error, resolved.providerId);
    await record(
      db,
      {
        ...base,
        usage: {},
        latencyMs: Date.now() - startedAt,
        ok: false,
        retries,
        httpStatus: aiError.detail?.httpStatus,
        errorCode: aiError.code,
        errorMessage: aiError.message,
      },
      {}
    );
    throw aiError;
  }
}

/** A single non-streaming completion. Returns the text. */
export async function aiChat(db: SQLiteDatabase, options: AiCallOptions): Promise<string> {
  return run(db, 'chat', options, 'chat', async (resolved) => {
    const result = await resolved.provider.chat(
      {
        model: resolved.model,
        messages: options.messages,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
      },
      {
        apiKey: resolved.apiKey,
        signal: options.signal,
        purpose: options.purpose,
        sessionId: options.sessionId,
        stage: options.stage,
      }
    );
    return { value: result.text, usage: result.usage };
  });
}

/**
 * A streaming completion.
 *
 * Not routed through `run`, because a stream cannot be retried once bytes have
 * reached the UI -- restarting would replay text the learner has already read. It
 * does its own timing and logging instead.
 */
export async function* aiStream(
  db: SQLiteDatabase,
  options: AiCallOptions
): AsyncGenerator<StreamEvent, void, undefined> {
  const resolved = await resolveCall(db, 'chat');
  const startedAt = Date.now();

  const base: Omit<CallMeta, 'usage' | 'latencyMs' | 'ok' | 'retries'> = {
    provider: resolved.providerId,
    model: resolved.model,
    mode: 'stream',
    purpose: options.purpose,
    sessionId: options.sessionId,
    stage: options.stage,
  };

  let usage: Usage = {};
  try {
    const stream = resolved.provider.streamChat(
      {
        model: resolved.model,
        messages: options.messages,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
      },
      {
        apiKey: resolved.apiKey,
        signal: options.signal,
        purpose: options.purpose,
        sessionId: options.sessionId,
        stage: options.stage,
      }
    );

    for await (const event of stream) {
      if (event.type === 'done') usage = event.usage;
      yield event;
    }

    await record(
      db,
      { ...base, usage, latencyMs: Date.now() - startedAt, ok: true, retries: 0 },
      usage,
      options.onCallLogged
    );
  } catch (error) {
    const aiError =
      error instanceof AiError ? error : wrapTransportError(error, resolved.providerId);
    await record(
      db,
      {
        ...base,
        usage,
        latencyMs: Date.now() - startedAt,
        ok: false,
        retries: 0,
        httpStatus: aiError.detail?.httpStatus,
        errorCode: aiError.code,
        errorMessage: aiError.message,
      },
      usage
    );
    throw aiError;
  }
}

export type StructuredOptions<T> = AiCallOptions & {
  schema: ZodType<T>;
  schemaName: string;
  schemaDescription?: string;
};

/**
 * A validated structured response.
 *
 * Throws `AiStructuredError` when every rung of the ladder fails. Call sites must
 * catch it and fall back to deterministic local behaviour -- self-grading for recall,
 * raw text for writing feedback, a SQLite-built wrap-up summary -- so that a model
 * which cannot follow a schema never leaves the learner at a dead end.
 */
export async function aiStructured<T>(
  db: SQLiteDatabase,
  options: StructuredOptions<T>
): Promise<T> {
  return run(db, 'structured', options, 'structured', async (resolved) => {
    const result = await resolved.provider.structured(
      {
        model: resolved.model,
        messages: options.messages,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        schema: options.schema,
        schemaName: options.schemaName,
        schemaDescription: options.schemaDescription,
      },
      {
        apiKey: resolved.apiKey,
        signal: options.signal,
        purpose: options.purpose,
        sessionId: options.sessionId,
        stage: options.stage,
      }
    );

    // If the ladder had to drop a rung, remember it so the next call starts lower.
    if (result.strategy === 'prompt_only' || result.strategy === 'repair') {
      await markStrategyUnsupported(
        db,
        resolved.providerId,
        resolved.model,
        'native_schema'
      ).catch(() => undefined);
    }

    return { value: result.data, usage: result.usage, strategy: result.strategy };
  });
}
