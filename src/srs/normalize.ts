/**
 * Comparing a typed Dutch answer against a target.
 *
 * This is the local grading path: it runs when the AI call fails, when the phone is
 * offline, and when the provider is rate-limiting. It has to be lenient about things
 * that do not change meaning (capitals, punctuation, a missing accent, a dropped
 * leading pronoun) and strict about everything else, because being wrong in the
 * generous direction teaches the wrong phrase.
 */

/** Strip combining marks: financiële -> financiele, één -> een. */
function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Reduce an answer to its comparable core.
 *
 * Deliberately does NOT remove negation, articles or prepositions: `niet`, `geen`,
 * `de`/`het` and the preposition in `zin hebben in` all change meaning or are exactly
 * what is being practised.
 */
export function normalizeDutch(input: string): string {
  let text = stripDiacritics(input.toLowerCase().trim());

  // Curly quotes and dashes, which phone keyboards insert automatically.
  text = text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-');

  // 't is a very common written contraction of het.
  text = text.replace(/(^|\s)'t(\s|$)/g, '$1het$2');

  // Drop punctuation but keep the apostrophe and hyphen inside words.
  text = text.replace(/[.,!?;:"()\[\]…]/g, ' ');

  text = text.replace(/\s+/g, ' ').trim();

  // A leading subject pronoun is frequently dropped in a drill answer, and its
  // absence does not mean the learner got the phrase wrong.
  text = text.replace(/^(ik|je|jij|we|wij|hij|zij|ze|u)\s+/, '');

  return text;
}

/**
 * Levenshtein distance, capped so a wildly different answer exits early rather than
 * filling a matrix we will throw away.
 */
export function editDistance(a: string, b: string, cap = 4): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowBest = current[0]!;

    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = previous[j]! + 1;
      const insertion = current[j - 1]! + 1;
      const best = Math.min(substitution, deletion, insertion);
      current[j] = best;
      if (best < rowBest) rowBest = best;
    }

    // Every path through the remaining rows can only grow, so we can stop here.
    if (rowBest > cap) return cap + 1;
    [previous, current] = [current, previous];
  }

  return previous[b.length]!;
}

export type LocalMatch = {
  /** Good enough to accept without the model. */
  accepted: boolean;
  /** Exact after normalisation, as opposed to accepted on a typo allowance. */
  exact: boolean;
  distance: number;
};

/**
 * Compare an answer to the target and any acceptable alternatives.
 *
 * The typo allowance scales with length: one character on a short phrase is a
 * different word, while one character in a long sentence is a slip.
 */
export function matchesLocally(
  answer: string,
  target: string,
  alternatives: readonly string[] = []
): LocalMatch {
  const normalizedAnswer = normalizeDutch(answer);
  if (!normalizedAnswer) return { accepted: false, exact: false, distance: Number.MAX_SAFE_INTEGER };

  const candidates = [target, ...alternatives].map(normalizeDutch).filter(Boolean);

  let best = Number.MAX_SAFE_INTEGER;
  for (const candidate of candidates) {
    if (candidate === normalizedAnswer) return { accepted: true, exact: true, distance: 0 };
    best = Math.min(best, editDistance(normalizedAnswer, candidate));
  }

  const longest = candidates.reduce((max, candidate) => Math.max(max, candidate.length), 0);
  const allowance = longest <= 8 ? 0 : longest <= 20 ? 1 : 2;

  return { accepted: best <= allowance, exact: false, distance: best };
}

/**
 * Blank out the target inside an example sentence to make a cloze prompt, without
 * calling a model for it.
 *
 * Returns null when the target does not appear, so the caller can fall back to a
 * different prompt kind rather than showing a sentence with nothing removed.
 */
export function buildCloze(
  example: string,
  target: string
): { prompt: string; answer: string } | null {
  // Try the most meaning-bearing words first, but fall through the rest: in an
  // expression like "zin hebben in" the longest word is an infinitive that appears
  // conjugated in the example ("heb"), so insisting on it would give up on a cloze
  // that "zin" produces perfectly well.
  const candidates = target
    .trim()
    .split(/\s+/)
    .map((word) => stripDiacritics(word.toLowerCase()).replace(/[^a-z'-]/g, ''))
    .filter((word) => word.length >= 3)
    .sort((a, b) => b.length - a.length);

  const haystack = stripDiacritics(example.toLowerCase());

  for (const word of candidates) {
    const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*`, 'i');
    const match = pattern.exec(haystack);
    if (!match) continue;

    const start = match.index;
    const end = start + match[0].length;
    return {
      prompt: `${example.slice(0, start)}____${example.slice(end)}`,
      answer: example.slice(start, end),
    };
  }

  return null;
}
