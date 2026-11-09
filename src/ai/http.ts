/**
 * The single place the app talks HTTP to an AI provider.
 *
 * Everything funnels through here so that error mapping, `Retry-After` handling and
 * key redaction happen exactly once. `expo/fetch` is used rather than the global
 * fetch because it is the only one in React Native whose `response.body` actually
 * streams -- RN's built-in fetch buffers the whole response, which would make
 * streaming chat pointless.
 */
import { fetch as expoFetch } from 'expo/fetch';

import {
  AiError,
  codeForStatus,
  parseRetryAfter,
  redact,
  wrapTransportError,
} from '@/ai/errors';
import type { ProviderId } from '@/ai/types';
import { createUtf8Decoder } from '@/ai/utf8';

/** Default ceiling for a single request. Streaming calls get their own, longer, cap. */
const DEFAULT_TIMEOUT_MS = 60_000;
const STREAM_TIMEOUT_MS = 180_000;

export type RequestOptions = {
  method?: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  provider: ProviderId;
  model?: string;
  timeoutMs?: number;
};

/**
 * Combine a caller's abort signal with our own timeout.
 * Returns the signal to pass to fetch plus a cleanup to stop the timer.
 */
function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let didTimeout = false;

  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
    timedOut: () => didTimeout,
  };
}

/** Read an error body and build the best AiError we can from it. */
async function errorFromResponse(
  response: { status: number; headers: { get(name: string): string | null }; text(): Promise<string> },
  provider: ProviderId,
  model?: string
): Promise<AiError> {
  let detail = '';
  try {
    const text = await response.text();
    detail = extractProviderMessage(text);
  } catch {
    // A body we cannot read is not worth failing differently over.
  }
  const code = codeForStatus(response.status);
  const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
  const message = detail
    ? `${provider} ${response.status}: ${detail}`
    : `${provider} returned HTTP ${response.status}`;
  return new AiError(code, message, {
    provider,
    model,
    httpStatus: response.status,
    retryAfterMs: retryAfterMs ?? undefined,
  });
}

/**
 * Pull the human-readable part out of a provider error body. All four wrap it
 * differently; this keeps the surfaced message short and redacted either way.
 */
export function extractProviderMessage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const candidates: unknown[] = [];
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const error = obj.error;
      if (typeof error === 'string') candidates.push(error);
      if (error && typeof error === 'object') {
        candidates.push((error as Record<string, unknown>).message);
      }
      candidates.push(obj.message, obj.detail);
    }
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return redact(candidate.trim()).slice(0, 300);
      }
    }
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return redact(trimmed).slice(0, 300);
}

export type JsonResponse<T> = { data: T; status: number; latencyMs: number };

/** A JSON request/response round trip. Throws `AiError` on any non-2xx. */
export async function requestJson<T>(
  url: string,
  options: RequestOptions
): Promise<JsonResponse<T>> {
  const { signal, cleanup, timedOut } = withTimeout(
    options.signal,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  const startedAt = Date.now();

  try {
    const response = await expoFetch(url, {
      method: options.method ?? 'POST',
      headers: options.headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal,
    });

    if (!response.ok) {
      throw await errorFromResponse(response, options.provider, options.model);
    }

    const text = await response.text();
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      throw new AiError('bad_response', `${options.provider} returned a non-JSON body`, {
        provider: options.provider,
        model: options.model,
        httpStatus: response.status,
      });
    }
    return { data, status: response.status, latencyMs: Date.now() - startedAt };
  } catch (error) {
    if (timedOut()) {
      throw new AiError('timeout', `${options.provider} did not respond in time`, {
        provider: options.provider,
        model: options.model,
      });
    }
    throw wrapTransportError(error, options.provider);
  } finally {
    cleanup();
  }
}

/**
 * Yield the payload of each `data:` frame from a server-sent-events response, in
 * order, stopping at `[DONE]`.
 *
 * Frames are separated by a blank line and a single frame may carry several `data:`
 * lines, which the spec says to join with a newline. Buffering on `\n` and tracking
 * the current frame is what makes a chunk boundary mid-frame harmless.
 */
export async function* streamSse(
  url: string,
  options: RequestOptions
): AsyncGenerator<string, void, undefined> {
  const { signal, cleanup, timedOut } = withTimeout(
    options.signal,
    options.timeoutMs ?? STREAM_TIMEOUT_MS
  );

  try {
    const response = await expoFetch(url, {
      method: options.method ?? 'POST',
      headers: { ...options.headers, accept: 'text/event-stream' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal,
    });

    if (!response.ok) {
      throw await errorFromResponse(response, options.provider, options.model);
    }
    if (!response.body) {
      throw new AiError('bad_response', `${options.provider} returned no response body`, {
        provider: options.provider,
        model: options.model,
      });
    }

    const reader = response.body.getReader();
    const decoder = createUtf8Decoder();
    let buffered = '';
    let frame: string[] = [];

    const flushFrame = (): string | null => {
      if (frame.length === 0) return null;
      const payload = frame.join('\n');
      frame = [];
      return payload;
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value);

        let newline: number;
        while ((newline = buffered.indexOf('\n')) !== -1) {
          // Tolerate CRLF as well as LF.
          const line = buffered.slice(0, newline).replace(/\r$/, '');
          buffered = buffered.slice(newline + 1);

          if (line === '') {
            const payload = flushFrame();
            if (payload !== null) {
              if (payload === '[DONE]') return;
              yield payload;
            }
            continue;
          }
          // Comment / keep-alive line.
          if (line.startsWith(':')) continue;

          if (line.startsWith('data:')) {
            frame.push(line.slice(5).replace(/^ /, ''));
            continue;
          }
          // `event:`, `id:` and `retry:` carry nothing we act on.
        }
      }

      // Some providers end without a trailing blank line.
      buffered += decoder.flush();
      if (buffered.trim().startsWith('data:')) {
        frame.push(buffered.trim().slice(5).replace(/^ /, ''));
      }
      const tail = flushFrame();
      if (tail !== null && tail !== '[DONE]') yield tail;
    } finally {
      // Releasing the reader stops the provider billing us for tokens we discard.
      try {
        await reader.cancel();
      } catch {
        // Already closed.
      }
    }
  } catch (error) {
    if (timedOut()) {
      throw new AiError('timeout', `${options.provider} stream stalled`, {
        provider: options.provider,
        model: options.model,
      });
    }
    throw wrapTransportError(error, options.provider);
  } finally {
    cleanup();
  }
}
