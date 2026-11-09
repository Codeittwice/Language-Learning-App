/**
 * AI error taxonomy, and the redaction that keeps API keys out of logs.
 *
 * Keys turn up inside error objects far more often than people expect -- echoed in a
 * provider's error body, embedded in a request URL, attached to a thrown Request.
 * Everything that reaches `console` or the `ai_calls` table goes through `redact`.
 */
import type { ProviderId, SchemaStrategy } from '@/ai/types';

export type AiErrorCode =
  | 'invalid_key'
  | 'no_access'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'bad_request'
  | 'server_error'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'offline'
  | 'bad_response'
  | 'schema_failed'
  | 'unknown';

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly detail?: {
      provider?: ProviderId;
      model?: string;
      httpStatus?: number;
      retryAfterMs?: number;
      cause?: unknown;
    }
  ) {
    super(redact(message));
    this.name = 'AiError';
  }

  /** True when retrying the same request could plausibly succeed. */
  get retryable(): boolean {
    return (
      this.code === 'rate_limited' ||
      this.code === 'server_error' ||
      this.code === 'network' ||
      this.code === 'timeout'
    );
  }

  /** Wording shown to the learner. Never leaks a key or a stack. */
  get userMessage(): string {
    switch (this.code) {
      case 'invalid_key':
        return 'That API key was rejected. Check it in Settings.';
      case 'no_access':
        return 'Your key does not have access to this model. Pick another in Settings.';
      case 'rate_limited':
        return 'The provider is rate-limiting us. Give it a moment.';
      case 'quota_exceeded':
        return 'Your provider account is out of credit.';
      case 'offline':
      case 'network':
        return 'No connection. Practice still works offline, just without new AI content.';
      case 'timeout':
        return 'The provider took too long to answer.';
      case 'aborted':
        return 'Cancelled.';
      case 'schema_failed':
        return 'The model could not give a usable answer, so we will grade this locally.';
      case 'bad_request':
      case 'bad_response':
      case 'server_error':
      case 'unknown':
      default:
        return 'Something went wrong talking to the AI provider.';
    }
  }
}

/** Raised when all four rungs of the structured-output ladder fail. */
export class AiStructuredError extends AiError {
  constructor(
    message: string,
    readonly rawText: string,
    readonly lastStrategy: SchemaStrategy,
    detail?: { provider?: ProviderId; model?: string }
  ) {
    super('schema_failed', message, detail);
    this.name = 'AiStructuredError';
  }
}

/**
 * Patterns for the key formats we handle, plus a generic long-token catch-all.
 * Order matters: specific prefixes first so the generic rule does not mask them.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-proj-[A-Za-z0-9_-]{8,}/g,
  /sk-or-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /AIza[A-Za-z0-9_-]{10,}/g,
  // key=... in a query string, which is how Gemini documents auth and why we send a
  // header instead.
  /([?&](?:key|api_key|apikey|access_token)=)[^&\s"']+/gi,
  /(Bearer\s+)[A-Za-z0-9._-]{12,}/gi,
  /(x-api-key["'\s:=]+)[A-Za-z0-9._-]{12,}/gi,
];

/**
 * Strip anything that looks like a credential. Applied to every message we log or
 * persist -- cheap insurance against a provider echoing the key back at us.
 */
export function redact(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix?: string) =>
      prefix ? `${prefix}[REDACTED]` : '[REDACTED]'
    );
  }
  return out;
}

/** Redact an arbitrary thrown value down to a loggable string. */
export function redactUnknown(error: unknown): string {
  if (error instanceof Error) return redact(`${error.name}: ${error.message}`);
  try {
    return redact(typeof error === 'string' ? error : JSON.stringify(error));
  } catch {
    return 'unserialisable error';
  }
}

/** Map an HTTP status onto our taxonomy. */
export function codeForStatus(status: number): AiErrorCode {
  if (status === 401 || status === 403) return 'invalid_key';
  if (status === 404) return 'no_access';
  if (status === 429) return 'rate_limited';
  if (status === 402) return 'quota_exceeded';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'bad_request';
  return 'unknown';
}

/** Turn a fetch rejection or an abort into an AiError. */
export function wrapTransportError(error: unknown, provider?: ProviderId): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new AiError('aborted', 'Request cancelled', { provider, cause: error });
  }
  return new AiError('network', redactUnknown(error), { provider, cause: error });
}

/**
 * Parse `Retry-After`, which providers send as either seconds or an HTTP date.
 * Returns null when absent or unparseable.
 */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}
