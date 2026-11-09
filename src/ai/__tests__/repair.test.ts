/**
 * JSON extraction tests.
 *
 * Every case here is something a model actually does, and most of them break the
 * naive `indexOf('{')` / `lastIndexOf('}')` approach -- especially the ones where
 * Dutch example text contains braces or quotes.
 */
import { extractJson, findJsonSpan, stripCodeFences } from '@/ai/repair';

function value(text: string): unknown {
  const result = extractJson(text);
  if (!result.ok) throw new Error(`expected success, got ${result.reason}`);
  return result.value;
}

describe('stripCodeFences', () => {
  it('removes a closed json fence', () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('removes an unterminated fence, which truncated responses leave behind', () => {
    expect(stripCodeFences('```json\n{"a":1}')).toBe('{"a":1}');
  });

  it('leaves unfenced text alone', () => {
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe('extractJson', () => {
  it('parses a clean object', () => {
    expect(value('{"accepted":true}')).toEqual({ accepted: true });
  });

  it('parses a fenced object', () => {
    expect(value('```json\n{"accepted":false}\n```')).toEqual({ accepted: false });
  });

  it('ignores prose before and after the object', () => {
    const text = 'Sure! Here is the evaluation:\n{"accepted":true}\nLet me know if you need more.';
    expect(value(text)).toEqual({ accepted: true });
  });

  it('survives braces inside a Dutch string, which break naive scanning', () => {
    const text = '{"suggestedAnswer":"Ik heb geen zin in {dit}","accepted":false}';
    expect(value(text)).toEqual({
      suggestedAnswer: 'Ik heb geen zin in {dit}',
      accepted: false,
    });
  });

  it('survives an escaped quote inside a string', () => {
    const text = '{"explanation":"Say \\"even denken\\" to buy time."}';
    expect(value(text)).toEqual({ explanation: 'Say "even denken" to buy time.' });
  });

  it('survives a trailing brace in prose after the object', () => {
    // lastIndexOf('}') would swallow the stray brace and fail to parse.
    const text = '{"accepted":true}\n\nNote: the brace } above is literal.';
    expect(value(text)).toEqual({ accepted: true });
  });

  it('repairs a trailing comma', () => {
    const result = extractJson('{"a":1,"b":2,}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ a: 1, b: 2 });
      expect(result.repaired).toBe(true);
    }
  });

  it('repairs smart quotes around keys and values', () => {
    const result = extractJson('{\u201caccepted\u201d:\u201cyes\u201d}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ accepted: 'yes' });
  });

  it('repairs a literal newline inside a string', () => {
    const result = extractJson('{"explanation":"line one\nline two"}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ explanation: 'line one\nline two' });
  });

  it('parses a top-level array', () => {
    expect(value('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('handles nested objects', () => {
    expect(value('{"outer":{"inner":[1,2]}}')).toEqual({ outer: { inner: [1, 2] } });
  });

  it('reports a truncated object as unbalanced rather than guessing', () => {
    const result = extractJson('{"accepted":true,"explanation":"it got cut o');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unbalanced');
  });

  it('reports plain prose as having no object', () => {
    const result = extractJson('I am sorry, I cannot help with that.');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_object');
  });

  it('reports an empty response', () => {
    const result = extractJson('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_object');
  });
});

describe('findJsonSpan', () => {
  it('finds the first balanced span and stops there', () => {
    const text = 'x {"a":1} y {"b":2}';
    const span = findJsonSpan(text);
    expect(span).not.toBeNull();
    expect(text.slice(span!.start, span!.end)).toBe('{"a":1}');
  });

  it('does not treat a brace inside a string as structure', () => {
    const text = '{"a":"}"}';
    const span = findJsonSpan(text);
    expect(span).not.toBeNull();
    expect(text.slice(span!.start, span!.end)).toBe('{"a":"}"}');
  });

  it('returns null when nothing closes', () => {
    expect(findJsonSpan('{"a":1')).toBeNull();
  });
});
