/**
 * Cost estimation.
 *
 * Deliberately refuses to guess. OpenRouter publishes per-token prices in its model
 * list, so calls routed through it are costed exactly. The other three providers do
 * not expose pricing through their APIs, and shipping a hardcoded price table would
 * be stale within months and would present a made-up number as fact -- precisely the
 * fabricated precision the spec rules out. For those, the UI shows token counts and
 * says the cost is unknown.
 *
 * A price the learner enters themselves is treated as an estimate and labelled as one.
 */
import type { ModelInfo, Usage } from '@/ai/types';

export type CostResult = {
  /** Null when we have no price for this model; never a guess. */
  costUsd: number | null;
  /** True when the price came from the learner rather than the provider. */
  isEstimate: boolean;
};

export const UNKNOWN_COST: CostResult = { costUsd: null, isEstimate: true };

/**
 * Cost a single call. `model` is the cached `ai_models` row; when it carries no
 * prices we return null rather than zero, so an unpriced call is visibly unpriced
 * instead of silently free.
 */
export function costOf(usage: Usage, model: ModelInfo | null): CostResult {
  if (!model) return UNKNOWN_COST;
  const { inputPricePerM, outputPricePerM } = model;
  if (inputPricePerM === undefined && outputPricePerM === undefined) return UNKNOWN_COST;

  const promptTokens = usage.promptTokens ?? 0;
  const completionTokens = usage.completionTokens ?? 0;
  const input = ((inputPricePerM ?? 0) * promptTokens) / 1_000_000;
  const output = ((outputPricePerM ?? 0) * completionTokens) / 1_000_000;

  return { costUsd: input + output, isEstimate: false };
}

export function totalTokens(usage: Usage): number {
  return (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
}

/**
 * Format a cost for display. Sub-cent amounts get more decimals, because "$0.00"
 * reads as free when it is not.
 */
export function formatCost(costUsd: number | null): string {
  if (costUsd === null) return 'cost unknown';
  if (costUsd === 0) return '$0.00';
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`;
  if (costUsd < 1) return `$${costUsd.toFixed(3)}`;
  return `$${costUsd.toFixed(2)}`;
}

/**
 * Wording for a total that includes calls we could not price. Saying "at least"
 * keeps the number honest instead of implying it is complete.
 */
export function formatSpend(knownCostUsd: number, unpricedCalls: number): string {
  if (unpricedCalls === 0) return formatCost(knownCostUsd);
  if (knownCostUsd === 0) {
    return `${unpricedCalls} call${unpricedCalls === 1 ? '' : 's'}, cost not published by provider`;
  }
  return `at least ${formatCost(knownCostUsd)} (+${unpricedCalls} unpriced)`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}
