/**
 * The `ai_calls` ledger and the `ai_models` capability/pricing cache.
 *
 * Every provider call -- success or failure -- leaves a row here. That is what makes
 * the cost screen honest and what lets the app remember that a given model rejected
 * a structured-output strategy, instead of paying for the same failed request again.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { redact } from '@/ai/errors';
import type { CallMeta, ModelInfo, ProviderId, SchemaStrategy } from '@/ai/types';
import { count, toDb } from '@/db';
import { emit } from '@/db/events';
import { type DayKey, nowIso } from '@/time/day';

export async function logAiCall(
  db: SQLiteDatabase,
  meta: CallMeta,
  cost: { costUsd: number | null; isEstimate: boolean },
  dayKey: DayKey
): Promise<void> {
  await db.runAsync(
    `INSERT INTO ai_calls (
       provider, model, purpose, mode, schema_strategy, session_id, stage,
       prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens,
       cost_usd, cost_is_estimate, latency_ms, http_status, ok,
       error_code, error_message, retries, day_key, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      meta.provider,
      meta.model,
      meta.purpose,
      meta.mode,
      meta.strategy ?? null,
      meta.sessionId ?? null,
      meta.stage ?? null,
      meta.usage.promptTokens ?? null,
      meta.usage.completionTokens ?? null,
      meta.usage.cachedTokens ?? null,
      meta.usage.reasoningTokens ?? null,
      cost.costUsd,
      toDb(cost.isEstimate),
      meta.latencyMs,
      meta.httpStatus ?? null,
      toDb(meta.ok),
      meta.errorCode ?? null,
      // Belt and braces: this string is already redacted upstream.
      meta.errorMessage ? redact(meta.errorMessage).slice(0, 500) : null,
      meta.retries,
      dayKey,
      nowIso(),
    ]
  );
  emit('ai:changed');
}

export type SpendSummary = {
  callCount: number;
  failedCount: number;
  promptTokens: number;
  completionTokens: number;
  /** Sum of the calls whose cost we actually know. */
  knownCostUsd: number;
  /** How many calls had no price available, so the total is a floor, not a total. */
  unpricedCalls: number;
};

export async function getSpend(
  db: SQLiteDatabase,
  range?: { fromDayKey: DayKey; toDayKey: DayKey }
): Promise<SpendSummary> {
  const where = range ? 'WHERE day_key BETWEEN ? AND ?' : '';
  const args = range ? [range.fromDayKey, range.toDayKey] : [];
  const row = await db.getFirstAsync<{
    call_count: number;
    failed_count: number;
    prompt_tokens: number;
    completion_tokens: number;
    known_cost: number;
    unpriced: number;
  }>(
    `SELECT COUNT(*) AS call_count,
            COALESCE(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) AS failed_count,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(cost_usd), 0) AS known_cost,
            COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS unpriced
       FROM ai_calls ${where}`,
    args
  );
  return {
    callCount: row?.call_count ?? 0,
    failedCount: row?.failed_count ?? 0,
    promptTokens: row?.prompt_tokens ?? 0,
    completionTokens: row?.completion_tokens ?? 0,
    knownCostUsd: row?.known_cost ?? 0,
    unpricedCalls: row?.unpriced ?? 0,
  };
}

export async function getDailySpend(
  db: SQLiteDatabase,
  fromDayKey: DayKey,
  toDayKey: DayKey
): Promise<{ dayKey: DayKey; costUsd: number; callCount: number }[]> {
  const rows = await db.getAllAsync<{ day_key: string; cost: number; n: number }>(
    `SELECT day_key, COALESCE(SUM(cost_usd), 0) AS cost, COUNT(*) AS n
       FROM ai_calls WHERE day_key BETWEEN ? AND ?
      GROUP BY day_key ORDER BY day_key`,
    [fromDayKey, toDayKey]
  );
  return rows.map((row) => ({ dayKey: row.day_key, costUsd: row.cost, callCount: row.n }));
}

export async function countCallsToday(db: SQLiteDatabase, dayKey: DayKey): Promise<number> {
  return count(db, 'SELECT COUNT(*) AS n FROM ai_calls WHERE day_key = ?', [dayKey]);
}

/* Model cache -------------------------------------------------------------- */

export async function upsertModels(
  db: SQLiteDatabase,
  provider: ProviderId,
  models: readonly ModelInfo[]
): Promise<void> {
  const fetchedAt = nowIso();
  await db.withTransactionAsync(async () => {
    for (const model of models) {
      await db.runAsync(
        `INSERT INTO ai_models (
           provider, model_id, label, context_window,
           supports_json_schema, supports_tools, supports_streaming,
           input_price_per_m, output_price_per_m, raw_json, fetched_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, model_id) DO UPDATE SET
           label = excluded.label,
           context_window = excluded.context_window,
           supports_json_schema = excluded.supports_json_schema,
           supports_tools = excluded.supports_tools,
           supports_streaming = excluded.supports_streaming,
           input_price_per_m = excluded.input_price_per_m,
           output_price_per_m = excluded.output_price_per_m,
           fetched_at = excluded.fetched_at`,
        [
          provider,
          model.id,
          model.label,
          model.contextWindow ?? null,
          toDb(model.supportsJsonSchema),
          toDb(model.supportsTools),
          toDb(model.supportsStreaming),
          model.inputPricePerM ?? null,
          model.outputPricePerM ?? null,
          null,
          fetchedAt,
        ]
      );
    }
  });
  emit('ai:changed');
}

type ModelRow = {
  model_id: string;
  label: string | null;
  context_window: number | null;
  supports_json_schema: number | null;
  supports_tools: number | null;
  supports_streaming: number | null;
  input_price_per_m: number | null;
  output_price_per_m: number | null;
};

function toModelInfo(provider: ProviderId, row: ModelRow): ModelInfo {
  return {
    id: row.model_id,
    label: row.label ?? row.model_id,
    contextWindow: row.context_window ?? undefined,
    supportsJsonSchema: row.supports_json_schema !== 0,
    supportsTools: row.supports_tools !== 0,
    supportsStreaming: row.supports_streaming !== 0,
    inputPricePerM: row.input_price_per_m ?? undefined,
    outputPricePerM: row.output_price_per_m ?? undefined,
  };
}

export async function getCachedModels(
  db: SQLiteDatabase,
  provider: ProviderId
): Promise<ModelInfo[]> {
  const rows = await db.getAllAsync<ModelRow>(
    `SELECT model_id, label, context_window, supports_json_schema, supports_tools,
            supports_streaming, input_price_per_m, output_price_per_m
       FROM ai_models WHERE provider = ? ORDER BY model_id`,
    [provider]
  );
  return rows.map((row) => toModelInfo(provider, row));
}

export async function getCachedModel(
  db: SQLiteDatabase,
  provider: ProviderId,
  modelId: string
): Promise<ModelInfo | null> {
  const row = await db.getFirstAsync<ModelRow>(
    `SELECT model_id, label, context_window, supports_json_schema, supports_tools,
            supports_streaming, input_price_per_m, output_price_per_m
       FROM ai_models WHERE provider = ? AND model_id = ?`,
    [provider, modelId]
  );
  return row ? toModelInfo(provider, row) : null;
}

/**
 * Remember that a model rejected a structured-output strategy, so the ladder starts
 * one rung lower next time instead of repeating a request we know will 400.
 */
export async function markStrategyUnsupported(
  db: SQLiteDatabase,
  provider: ProviderId,
  modelId: string,
  strategy: SchemaStrategy
): Promise<void> {
  const column =
    strategy === 'native_schema'
      ? 'supports_json_schema'
      : strategy === 'tool_force'
        ? 'supports_tools'
        : null;
  if (!column) return;

  await db.runAsync(
    `INSERT INTO ai_models (provider, model_id, ${column}, fetched_at)
     VALUES (?, ?, 0, ?)
     ON CONFLICT(provider, model_id) DO UPDATE SET ${column} = 0`,
    [provider, modelId, nowIso()]
  );
  emit('ai:changed');
}
