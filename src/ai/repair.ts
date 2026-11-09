/**
 * Getting a JSON object out of text a model wrote.
 *
 * The obvious implementation -- `text.indexOf('{')` to `text.lastIndexOf('}')` -- is
 * wrong in ways that bite specifically here: Dutch example sentences and explanations
 * contain braces and quotes, models append commentary after the object, and a
 * truncated response has an unbalanced tail. So we scan with a depth counter that
 * understands string literals and escapes.
 */

export type ExtractResult =
  | { ok: true; value: unknown; repaired: boolean }
  | { ok: false; reason: 'no_object' | 'unbalanced' | 'invalid_json' };

/** Strip a leading ```json fence and its closing fence, if present. */
export function stripCodeFences(text: string): string {
  const fenced = /^\s*```(?:json|JSON)?\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(text);
  if (fenced?.[1] !== undefined) return fenced[1];
  // An unterminated opening fence, which truncated responses often have.
  const opening = /^\s*```(?:json|JSON)?\s*\n([\s\S]*)$/.exec(text);
  if (opening?.[1] !== undefined) return opening[1].replace(/```\s*$/, '');
  return text;
}

/**
 * Find the first balanced `{...}` or `[...]` span, respecting string literals.
 * Returns null when there is no complete structure.
 */
export function findJsonSpan(text: string): { start: number; end: number } | null {
  const openIndex = (() => {
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{' || ch === '[') return i;
    }
    return -1;
  })();
  if (openIndex === -1) return null;

  const openChar = text[openIndex]!;
  const closeChar = openChar === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i]!;

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return { start: openIndex, end: i + 1 };
    }
  }
  return null;
}

/**
 * Conservative fixes for the mistakes models actually make. Each is shape-preserving
 * -- nothing here can change a value, only make malformed syntax parseable.
 */
function applyRepairs(candidate: string): string {
  let out = candidate;

  // Smart quotes used as JSON string delimiters.
  out = out.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  // Trailing commas before a closing brace or bracket.
  out = out.replace(/,(\s*[}\]])/g, '$1');

  // Literal newlines inside a string, which JSON forbids. Walk the text so we only
  // touch newlines that are genuinely inside a string literal.
  let rebuilt = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < out.length; i += 1) {
    const ch = out[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        rebuilt += ch;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        rebuilt += ch;
        continue;
      }
      if (ch === '"') {
        inString = false;
        rebuilt += ch;
        continue;
      }
      if (ch === '\n') {
        rebuilt += '\\n';
        continue;
      }
      if (ch === '\r') continue;
      if (ch === '\t') {
        rebuilt += '\\t';
        continue;
      }
      rebuilt += ch;
      continue;
    }
    if (ch === '"') inString = true;
    rebuilt += ch;
  }

  return rebuilt;
}

/**
 * Pull a JSON value out of model output, repairing only if a clean parse fails.
 * `repaired` tells the caller whether we had to intervene, which is worth logging.
 */
export function extractJson(text: string): ExtractResult {
  const body = stripCodeFences(text).trim();
  if (!body) return { ok: false, reason: 'no_object' };

  // The happy path: the whole body is valid JSON.
  try {
    return { ok: true, value: JSON.parse(body), repaired: false };
  } catch {
    // Keep going.
  }

  const span = findJsonSpan(body);
  if (!span) {
    return { ok: false, reason: body.includes('{') || body.includes('[') ? 'unbalanced' : 'no_object' };
  }

  const candidate = body.slice(span.start, span.end);
  try {
    return { ok: true, value: JSON.parse(candidate), repaired: false };
  } catch {
    // Fall through to repairs.
  }

  try {
    return { ok: true, value: JSON.parse(applyRepairs(candidate)), repaired: true };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}
