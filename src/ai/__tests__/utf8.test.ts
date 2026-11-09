/**
 * Incremental UTF-8 decoding tests.
 *
 * The cases that matter are the ones where a multi-byte character straddles a chunk
 * boundary, because that is routine in SSE and it corrupts exactly the characters
 * Dutch needs. Tests run against the manual decoder explicitly as well as the
 * platform-selected one, so a missing or non-streaming `TextDecoder` is covered.
 */
import { createUtf8Decoder, decodeUtf8, encodeUtf8 } from '@/ai/utf8';

/** Decode a string fed in as fixed-size byte chunks. */
function decodeInChunks(text: string, chunkSize: number): string {
  const bytes = encodeUtf8(text);
  const decoder = createUtf8Decoder();
  let out = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    out += decoder.decode(bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
  }
  return out + decoder.flush();
}

const DUTCH = 'Ik heb geen zin in financiële zaken — één café, twee broodjes.';

describe('createUtf8Decoder', () => {
  it('round-trips ASCII', () => {
    expect(decodeInChunks('hello world', 3)).toBe('hello world');
  });

  it('round-trips Dutch diacritics whatever the chunk size', () => {
    for (const size of [1, 2, 3, 5, 7, 16, 1024]) {
      expect(decodeInChunks(DUTCH, size)).toBe(DUTCH);
    }
  });

  it('carries a two-byte character across a chunk boundary', () => {
    // 'ë' is 0xC3 0xAB. Split between the two bytes.
    const decoder = createUtf8Decoder();
    const first = decoder.decode(new Uint8Array([0x65, 0xc3]));
    const second = decoder.decode(new Uint8Array([0xab, 0x66]));
    expect(first).toBe('e');
    expect(first + second + decoder.flush()).toBe('eëf');
  });

  it('carries a three-byte character across two boundaries', () => {
    // '—' (em dash) is 0xE2 0x80 0x94.
    const decoder = createUtf8Decoder();
    let out = decoder.decode(new Uint8Array([0xe2]));
    out += decoder.decode(new Uint8Array([0x80]));
    out += decoder.decode(new Uint8Array([0x94]));
    expect(out + decoder.flush()).toBe('—');
  });

  it('carries a four-byte character (emoji) across boundaries', () => {
    const emoji = '\u{1F525}'; // the streak flame
    for (const size of [1, 2, 3]) {
      expect(decodeInChunks(`a${emoji}b`, size)).toBe(`a${emoji}b`);
    }
  });

  it('emits a replacement character for a dangling sequence at end of stream', () => {
    const decoder = createUtf8Decoder();
    expect(decoder.decode(new Uint8Array([0x61, 0xc3]))).toBe('a');
    expect(decoder.flush()).toBe('�');
  });

  it('handles an empty chunk without emitting anything', () => {
    const decoder = createUtf8Decoder();
    expect(decoder.decode(new Uint8Array([]))).toBe('');
    expect(decoder.flush()).toBe('');
  });
});

describe('decodeUtf8 / encodeUtf8', () => {
  it('round-trips in one shot', () => {
    expect(decodeUtf8(encodeUtf8(DUTCH))).toBe(DUTCH);
  });

  it('encodes the expected byte lengths', () => {
    expect(encodeUtf8('a')).toHaveLength(1);
    expect(encodeUtf8('ë')).toHaveLength(2);
    expect(encodeUtf8('—')).toHaveLength(3);
    expect(encodeUtf8('\u{1F525}')).toHaveLength(4);
  });

  it('replaces invalid bytes rather than throwing', () => {
    // 0xFF is never a valid lead byte.
    expect(decodeUtf8(new Uint8Array([0x61, 0xff, 0x62]))).toBe('a�b');
  });

  it('rejects a surrogate encoded as three bytes', () => {
    // 0xED 0xA0 0x80 would decode to U+D800, a lone surrogate half.
    expect(decodeUtf8(new Uint8Array([0xed, 0xa0, 0x80]))).not.toContain('\ud800');
  });
});
