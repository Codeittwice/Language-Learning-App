import type { SQLiteDatabase } from 'expo-sqlite';

import { aiStructured } from '@/ai/call';
import type { DictionaryEntry } from '@/ai/schemas';
import { cacheEntry, readCachedEntry } from '@/db/repo/dictionary';
import { getProfile } from '@/db/repo/profile';
import { lookupDictionary } from '@/dictionary/lookup';

jest.mock('@/ai/call', () => ({ aiStructured: jest.fn() }));
jest.mock('@/db/repo/dictionary', () => ({
  normalizeQuery: jest.requireActual('@/db/repo/dictionary').normalizeQuery,
  readCachedEntry: jest.fn(),
  cacheEntry: jest.fn(),
}));
jest.mock('@/db/repo/profile', () => ({ getProfile: jest.fn() }));

const db = {} as SQLiteDatabase;
const entry: DictionaryEntry = {
  dutch: 'wedstrijd', wordClass: 'noun', article: 'de', plural: 'de wedstrijden',
  diminutive: null, meaningEn: 'match', meaningBg: null, register: 'neutral',
  exampleNl: 'Hoe laat is de wedstrijd?', exampleEn: 'What time is the match?',
  verbInfinitive: null, verbPresent3sg: null, verbPastSg: null, verbPastPl: null,
  verbParticiple: null, verbAux: null, verbSeparable: null, prepositions: [], notes: '',
  confidence: 'high',
};
const cached = { id: 1, entry, savedPhraseId: null };

it('returns a normalized cache hit before reading settings or contacting a provider', async () => {
  jest.mocked(readCachedEntry).mockResolvedValueOnce(cached);

  await expect(lookupDictionary(db, '  De   WEDSTRIJD ', 'nl')).resolves.toEqual(cached);

  expect(readCachedEntry).toHaveBeenCalledWith(db, 'de wedstrijd', 'nl');
  expect(getProfile).not.toHaveBeenCalled();
  expect(aiStructured).not.toHaveBeenCalled();
});

it('saves a new lookup under the explicitly chosen query language', async () => {
  jest.mocked(readCachedEntry).mockResolvedValueOnce(null);
  jest.mocked(getProfile).mockResolvedValueOnce({ explanationLanguage: 'en' } as Awaited<ReturnType<typeof getProfile>>);
  jest.mocked(aiStructured).mockResolvedValueOnce(entry);
  jest.mocked(cacheEntry).mockResolvedValueOnce(cached);

  await expect(lookupDictionary(db, ' match ', 'en')).resolves.toEqual(cached);

  expect(readCachedEntry).toHaveBeenCalledWith(db, 'match', 'en');
  expect(aiStructured).toHaveBeenCalledWith(db, expect.objectContaining({
    messages: [{ role: 'user', content: expect.stringContaining('Interpret the lookup as English') }],
  }));
  expect(cacheEntry).toHaveBeenCalledWith(db, 'match', 'en', entry);
});

it('keeps accents in lookup keys so distinct words do not share an entry', async () => {
  jest.mocked(readCachedEntry).mockResolvedValueOnce(cached).mockResolvedValueOnce(cached);

  await lookupDictionary(db, 'E\u0301E\u0301N', 'nl');
  await lookupDictionary(db, 'een', 'nl');

  expect(readCachedEntry).toHaveBeenNthCalledWith(1, db, 'één', 'nl');
  expect(readCachedEntry).toHaveBeenNthCalledWith(2, db, 'een', 'nl');
});
