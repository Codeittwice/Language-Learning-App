/**
 * Local answer-matching tests.
 *
 * This is the grading path when the model is unavailable or the phone is offline, so
 * the balance matters: forgiving about typing, strict about meaning.
 */
import { buildCloze, editDistance, matchesLocally, normalizeDutch } from '@/srs/normalize';

describe('normalizeDutch', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeDutch('  Hoe   WAS  je dag?  ')).toBe('hoe was je dag');
  });

  it('strips diacritics so a missing accent is not a wrong answer', () => {
    expect(normalizeDutch('financiële')).toBe('financiele');
    expect(normalizeDutch('één')).toBe('een');
  });

  it('normalises curly quotes from phone keyboards', () => {
    expect(normalizeDutch('het’s')).toBe(normalizeDutch("het's"));
  });

  it("expands 't to het", () => {
    expect(normalizeDutch("'t is goed")).toBe('het is goed');
  });

  it('drops a leading subject pronoun', () => {
    expect(normalizeDutch('Ik heb geen zin')).toBe('heb geen zin');
    expect(normalizeDutch('heb geen zin')).toBe('heb geen zin');
  });

  it('keeps negation, which changes meaning', () => {
    expect(normalizeDutch('Ik heb geen zin')).not.toBe(normalizeDutch('Ik heb zin'));
    expect(normalizeDutch('Dat is niet waar')).not.toBe(normalizeDutch('Dat is waar'));
  });

  it('keeps articles, which are the point of de/het practice', () => {
    expect(normalizeDutch('het team')).not.toBe(normalizeDutch('de team'));
  });

  it('keeps the preposition in a fixed expression', () => {
    expect(normalizeDutch('zin hebben in')).not.toBe(normalizeDutch('zin hebben aan'));
  });
});

describe('editDistance', () => {
  it('is zero for identical strings', () => {
    expect(editDistance('hallo', 'hallo')).toBe(0);
  });

  it('counts single edits', () => {
    expect(editDistance('hallo', 'hallos')).toBe(1);
    expect(editDistance('hallo', 'hall')).toBe(1);
    expect(editDistance('hallo', 'hbllo')).toBe(1);
  });

  it('caps out instead of computing a useless large distance', () => {
    expect(editDistance('kort', 'een heel lange zin hier', 4)).toBeGreaterThan(4);
  });
});

describe('matchesLocally', () => {
  it('accepts an exact answer', () => {
    const result = matchesLocally('Hoe was je dag?', 'Hoe was je dag?');
    expect(result.accepted).toBe(true);
    expect(result.exact).toBe(true);
  });

  it('accepts differences in case, punctuation and accents', () => {
    expect(matchesLocally('hoe was je dag', 'Hoe was je dag?').accepted).toBe(true);
    expect(matchesLocally('een', 'één').accepted).toBe(true);
  });

  it('accepts a listed alternative', () => {
    const result = matchesLocally('Alles goed?', 'Hoe gaat het?', ['Alles goed?']);
    expect(result.accepted).toBe(true);
  });

  it('forgives one typo in a long sentence', () => {
    expect(matchesLocally('Daar ben ik het niet mee eenz', 'Daar ben ik het niet mee eens').accepted).toBe(
      true
    );
  });

  it('does not forgive a changed short word, which is a different word', () => {
    // 'de' vs 'het' is one edit but an entirely different answer.
    expect(matchesLocally('de team', 'het team').accepted).toBe(false);
  });

  it('rejects a dropped negation even though it is a small edit', () => {
    expect(matchesLocally('Ik heb zin', 'Ik heb geen zin').accepted).toBe(false);
  });

  it('rejects an empty answer', () => {
    expect(matchesLocally('   ', 'Hoe was je dag?').accepted).toBe(false);
  });

  it('rejects an unrelated answer', () => {
    expect(matchesLocally('Tot morgen', 'Hoe was je dag?').accepted).toBe(false);
  });
});

describe('buildCloze', () => {
  it('blanks the longest word of the target inside the example', () => {
    const cloze = buildCloze('Ik heb vandaag geen zin om te trainen.', 'zin hebben in');
    expect(cloze).not.toBeNull();
    expect(cloze!.prompt).toContain('____');
    expect(cloze!.prompt).not.toContain('hebben');
  });

  it('matches inflected forms of the keyword', () => {
    const cloze = buildCloze('Zullen we iets afspreken voor zaterdag?', 'afspreken');
    expect(cloze).not.toBeNull();
    expect(cloze!.answer.toLowerCase()).toBe('afspreken');
  });

  it('ignores accents when locating the keyword', () => {
    const cloze = buildCloze('Er was maar één bal.', 'één');
    expect(cloze).not.toBeNull();
    expect(cloze!.answer).toBe('één');
  });

  it('returns null when the target is not in the example, so the caller can fall back', () => {
    expect(buildCloze('Hoe was je dag?', 'afspreken')).toBeNull();
  });

  it('returns null for a target too short to blank usefully', () => {
    expect(buildCloze('Ik ga er nu heen.', 'ga')).toBeNull();
  });
});
