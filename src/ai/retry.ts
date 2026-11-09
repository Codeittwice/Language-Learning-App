/**
 * Retry policy.
 *
 * Only transient failures are retried. Retrying a 400 or 401 burns the learner's
 * quota while hiding the real error -- those are bugs or a bad key, and no number of
 * attempts will fix either.
 */
import { AiError } from '@/ai/errors';

export type RetryOptions = {
  /** Total attempts, including the first. */
  max?: number;
  signal?: AbortSignal;
  /** Called before each wait, for logging or UI. */
  onRetry?: (attempt: number, delayMs: number, error: AiError) => void;
};

const DEFAULT_MAX = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

/** Exponential backoff with full jitter, capped. */
export function backoffDelay(attempt: number): number {
  const ceiling = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return Math.round(Math.random() * ceiling);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AiError('aborted', 'Request cancelled'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new AiError('aborted', 'Request cancelled'));
    }
    signal?.addEventListener('abort', onAbort);
  });
}

/**
 * Run `fn`, retrying only retryable `AiError`s. `attempt` is 1-based so callers can
 * record how many tries a call took.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const max = options.max ?? DEFAULT_MAX;
  let lastError: unknown;

  for (let attempt = 1; attempt <= max; attempt += 1) {
    if (options.signal?.aborted) throw new AiError('aborted', 'Request cancelled');
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      const aiError = error instanceof AiError ? error : null;
      if (!aiError || !aiError.retryable || attempt === max) throw error;
      if (aiError.code === 'aborted') throw error;

      // Honour the provider's own backoff when it sends one.
      const delay = aiError.detail?.retryAfterMs ?? backoffDelay(attempt);
      options.onRetry?.(attempt, delay, aiError);
      await sleep(delay, options.signal);
    }
  }

  throw lastError;
}
