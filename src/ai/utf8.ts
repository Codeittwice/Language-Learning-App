/**
 * Incremental UTF-8 decoding for streamed responses.
 *
 * Two reasons this is hand-written rather than assumed or polyfilled:
 *
 * 1. A global `TextDecoder` is not guaranteed across Hermes versions, and when it is
 *    missing the failure is a crash in a release build only.
 * 2. SSE frames split mid-character constantly. Decoding each chunk independently
 *    mangles exactly the characters Dutch needs -- the e-diaeresis in `financiële`,
 *    the e-acute in `één` -- into replacement characters. A stateful decoder must
 *    carry an incomplete multi-byte sequence across the chunk boundary.
 */

export interface IncrementalDecoder {
  /** Decode a chunk, holding back any trailing incomplete sequence. */
  decode(chunk: Uint8Array): string;
  /** Flush at end of stream; emits U+FFFD for anything still incomplete. */
  flush(): string;
}

const REPLACEMENT = '�';

/** Expected total length of a sequence from its lead byte, or 0 if not a lead byte. */
function sequenceLength(lead: number): number {
  if (lead <= 0x7f) return 1;
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0; // continuation byte, or an overlong/invalid lead
}

function isContinuation(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

/**
 * How many bytes at the end of `bytes` belong to a sequence that is not yet complete.
 * Returns 0 when the buffer ends on a character boundary.
 */
function incompleteTailLength(bytes: Uint8Array): number {
  const max = Math.min(4, bytes.length);
  for (let back = 1; back <= max; back += 1) {
    const index = bytes.length - back;
    const byte = bytes[index]!;
    if (isContinuation(byte)) continue; // keep walking back to the lead byte
    const needed = sequenceLength(byte);
    // An invalid lead byte is not "incomplete" -- let the decoder emit U+FFFD for it.
    if (needed === 0) return 0;
    return needed > back ? back : 0;
  }
  // Four continuation bytes in a row is malformed, not incomplete.
  return 0;
}

/** Decode a buffer that is known to end on a character boundary. */
function decodeComplete(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const lead = bytes[i]!;
    const needed = sequenceLength(lead);

    if (needed === 0) {
      out += REPLACEMENT;
      i += 1;
      continue;
    }
    if (needed === 1) {
      out += String.fromCharCode(lead);
      i += 1;
      continue;
    }
    if (i + needed > bytes.length) {
      out += REPLACEMENT;
      i += 1;
      continue;
    }

    let valid = true;
    let codePoint = lead & (needed === 2 ? 0x1f : needed === 3 ? 0x0f : 0x07);
    for (let k = 1; k < needed; k += 1) {
      const next = bytes[i + k]!;
      if (!isContinuation(next)) {
        valid = false;
        break;
      }
      codePoint = (codePoint << 6) | (next & 0x3f);
    }

    // Reject surrogates and out-of-range code points so we never produce lone halves.
    if (
      !valid ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      codePoint > 0x10ffff
    ) {
      out += REPLACEMENT;
      i += 1;
      continue;
    }

    out += String.fromCodePoint(codePoint);
    i += needed;
  }
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const merged = new Uint8Array(a.length + b.length);
  merged.set(a, 0);
  merged.set(b, a.length);
  return merged;
}

type NativeTextDecoder = {
  decode(input?: Uint8Array, options?: { stream?: boolean }): string;
};

/**
 * Prefer the platform decoder when it exists and genuinely supports streaming;
 * otherwise fall back to the manual implementation above.
 */
export function createUtf8Decoder(): IncrementalDecoder {
  const Ctor = (globalThis as { TextDecoder?: new (label?: string) => NativeTextDecoder })
    .TextDecoder;

  if (typeof Ctor === 'function') {
    try {
      const native = new Ctor('utf-8');
      // Probe: feed the first byte of a two-byte sequence. A streaming decoder holds
      // it back and returns ''. A non-streaming one emits U+FFFD immediately, which
      // would corrupt split characters, so we reject it.
      const probe = native.decode(new Uint8Array([0xc3]), { stream: true });
      if (probe === '') {
        const tail = native.decode(new Uint8Array([0xa9]), { stream: true });
        if (tail === 'é') {
          return {
            decode: (chunk) => native.decode(chunk, { stream: true }),
            flush: () => native.decode(),
          };
        }
      }
    } catch {
      // Fall through to the manual decoder.
    }
  }

  let pending = new Uint8Array(0);
  return {
    decode(chunk) {
      const bytes = concat(pending, chunk);
      const hold = incompleteTailLength(bytes);
      const splitAt = bytes.length - hold;
      pending = hold > 0 ? bytes.slice(splitAt) : new Uint8Array(0);
      return splitAt > 0 ? decodeComplete(bytes.subarray(0, splitAt)) : '';
    },
    flush() {
      if (pending.length === 0) return '';
      pending = new Uint8Array(0);
      return REPLACEMENT;
    },
  };
}

/** One-shot decode of a complete buffer. */
export function decodeUtf8(bytes: Uint8Array): string {
  const decoder = createUtf8Decoder();
  return decoder.decode(bytes) + decoder.flush();
}

/** Encode to UTF-8 without assuming a global `TextEncoder`. */
export function encodeUtf8(text: string): Uint8Array {
  const Ctor = (globalThis as { TextEncoder?: new () => { encode(s: string): Uint8Array } })
    .TextEncoder;
  if (typeof Ctor === 'function') return new Ctor().encode(text);

  const bytes: number[] = [];
  for (const char of text) {
    let code = char.codePointAt(0)!;
    if (code <= 0x7f) {
      bytes.push(code);
    } else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code <= 0xffff) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
    code = 0;
  }
  return new Uint8Array(bytes);
}
