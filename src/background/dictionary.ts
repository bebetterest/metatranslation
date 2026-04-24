import type {
  DictionaryEntry,
  DictionaryLookupRequest,
  DictionaryLookupResult,
  DictionaryProvider,
  ExtensionSettings,
} from '../lib/types';
import { getCachedDictionary, putCachedDictionary } from './db.ts';

const DICTIONARY_CACHE_SCHEMA_VERSION = 'dictionary-v1';
const DICTIONARY_TIMEOUT_MS = 8000;
const WIKTAPI_BASE_URL = 'https://api.wiktapi.dev';
const FREE_DICTIONARY_BASE_URL = 'https://freedictionaryapi.com/api/v1';

export async function lookupDictionary(
  settings: ExtensionSettings,
  request: DictionaryLookupRequest,
): Promise<DictionaryLookupResult> {
  const provider = settings.dictionaryProvider;
  const normalizedWord = normalizeDictionaryWord(request.word);
  const sourceLang = normalizeLanguageCode(request.sourceLang);
  const targetLang = normalizeLanguageCode(request.targetLang);

  if (!normalizedWord || provider === 'off') {
    return createEmptyResult(provider, normalizedWord, sourceLang, targetLang);
  }

  const edition = normalizeDictionaryEdition(settings.dictionaryEdition);
  const cacheKey = buildDictionaryCacheKey(provider, edition, normalizedWord, sourceLang, targetLang);
  const cached = await getCachedDictionary(cacheKey);
  if (cached) {
    return cached;
  }

  const result =
    provider === 'wiktapi'
      ? await lookupWiktApi(normalizedWord, sourceLang, targetLang, edition)
      : await lookupFreeDictionaryApi(normalizedWord, sourceLang, targetLang);

  await putCachedDictionary(cacheKey, result);
  return result;
}

export function buildDictionaryCacheKey(
  provider: Exclude<DictionaryProvider, 'off'>,
  edition: string,
  word: string,
  sourceLang: string,
  targetLang: string,
): string {
  return [
    DICTIONARY_CACHE_SCHEMA_VERSION,
    provider,
    edition,
    sourceLang || 'all',
    targetLang || 'all',
    word.toLowerCase(),
  ].join('::');
}

export function buildDictionaryUrl(
  provider: Exclude<DictionaryProvider, 'off'>,
  word: string,
  sourceLang: string,
  edition = 'en',
): string {
  if (provider === 'wiktapi') {
    const url = new URL(`/v1/${encodeURIComponent(edition)}/word/${encodeURIComponent(word)}`, WIKTAPI_BASE_URL);
    if (sourceLang) {
      url.searchParams.set('lang', sourceLang);
    }
    return url.toString();
  }

  const language = sourceLang || 'all';
  const url = new URL(
    `/api/v1/entries/${encodeURIComponent(language)}/${encodeURIComponent(word)}`,
    'https://freedictionaryapi.com',
  );
  url.searchParams.set('translations', 'true');
  return url.toString();
}

export function parseWiktApiResult(
  payload: unknown,
  word: string,
  sourceLang: string,
  targetLang: string,
  edition = 'en',
): DictionaryLookupResult {
  const entries = isPlainObject(payload) && Array.isArray(payload.entries) ? payload.entries : [];
  const sourceUrl = buildWiktionaryUrl(edition, word);
  return {
    provider: 'wiktapi',
    word,
    normalizedWord: normalizeDictionaryWord(word),
    sourceLang,
    targetLang,
    entries: entries
      .map((entry) => parseWiktApiEntry(entry, word, sourceLang, targetLang, sourceUrl))
      .filter((entry): entry is DictionaryEntry => Boolean(entry))
      .slice(0, 4),
    sourceUrl,
    attribution: 'WiktApi / Wiktionary data',
    fetchedAt: Date.now(),
  };
}

export function parseFreeDictionaryApiResult(
  payload: unknown,
  word: string,
  sourceLang: string,
  targetLang: string,
): DictionaryLookupResult {
  const entries = isPlainObject(payload) && Array.isArray(payload.entries) ? payload.entries : [];
  const source = isPlainObject(payload) && isPlainObject(payload.source) ? payload.source : {};
  const sourceUrl = typeof source.url === 'string' ? source.url : buildWiktionaryUrl(sourceLang || 'en', word);
  const license = isPlainObject(source.license) && typeof source.license.name === 'string'
    ? source.license.name
    : 'CC BY-SA';

  return {
    provider: 'freedictionaryapi',
    word,
    normalizedWord: normalizeDictionaryWord(word),
    sourceLang,
    targetLang,
    entries: entries
      .map((entry) => parseFreeDictionaryEntry(entry, word, sourceLang, targetLang, sourceUrl, license))
      .filter((entry): entry is DictionaryEntry => Boolean(entry))
      .slice(0, 4),
    sourceUrl,
    attribution: `FreeDictionaryAPI / Wiktionary data (${license})`,
    fetchedAt: Date.now(),
  };
}

function createEmptyResult(
  provider: DictionaryProvider,
  normalizedWord: string,
  sourceLang: string,
  targetLang: string,
): DictionaryLookupResult {
  return {
    provider,
    word: normalizedWord,
    normalizedWord,
    sourceLang,
    targetLang,
    entries: [],
    sourceUrl: '',
    attribution: '',
    fetchedAt: Date.now(),
  };
}

async function lookupWiktApi(
  word: string,
  sourceLang: string,
  targetLang: string,
  edition: string,
): Promise<DictionaryLookupResult> {
  const payload = await fetchJson(buildDictionaryUrl('wiktapi', word, sourceLang, edition));
  return parseWiktApiResult(payload, word, sourceLang, targetLang, edition);
}

async function lookupFreeDictionaryApi(
  word: string,
  sourceLang: string,
  targetLang: string,
): Promise<DictionaryLookupResult> {
  const payload = await fetchJson(buildDictionaryUrl('freedictionaryapi', word, sourceLang));
  return parseFreeDictionaryApiResult(payload, word, sourceLang, targetLang);
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DICTIONARY_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      if (response.status === 404) {
        return {};
      }
      throw new Error(`Dictionary API failed with status ${response.status}.`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function parseWiktApiEntry(
  value: unknown,
  word: string,
  sourceLang: string,
  targetLang: string,
  sourceUrl: string,
): DictionaryEntry | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const definitions = collectWiktApiDefinitions(value.senses);
  const translations = collectWiktApiTranslations(value.translations, targetLang);
  const pronunciations = collectWiktApiPronunciations(value.sounds);
  if (definitions.length === 0 && translations.length === 0 && pronunciations.length === 0) {
    return null;
  }

  return {
    provider: 'wiktapi',
    word: typeof value.word === 'string' ? value.word : word,
    sourceLang: typeof value.lang_code === 'string' ? value.lang_code : sourceLang,
    partOfSpeech: typeof value.pos === 'string' ? value.pos : '',
    pronunciations,
    definitions,
    examples: collectWiktApiExamples(value.senses),
    translations,
    sourceUrl,
    license: 'Wiktionary / CC BY-SA',
  };
}

function parseFreeDictionaryEntry(
  value: unknown,
  word: string,
  sourceLang: string,
  targetLang: string,
  sourceUrl: string,
  license: string,
): DictionaryEntry | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const definitions = collectFreeDictionaryDefinitions(value.senses);
  const translations = collectFreeDictionaryTranslations(value.senses, targetLang);
  const pronunciations = Array.isArray(value.pronunciations)
    ? uniqueStrings(
        value.pronunciations
          .filter(isPlainObject)
          .map((item) => (typeof item.text === 'string' ? item.text : '')),
      )
    : [];

  if (definitions.length === 0 && translations.length === 0 && pronunciations.length === 0) {
    return null;
  }

  const language = isPlainObject(value.language) ? value.language : {};
  return {
    provider: 'freedictionaryapi',
    word,
    sourceLang: typeof language.code === 'string' ? language.code : sourceLang,
    partOfSpeech: typeof value.partOfSpeech === 'string' ? value.partOfSpeech : '',
    pronunciations,
    definitions,
    examples: collectFreeDictionaryExamples(value.senses),
    translations,
    sourceUrl,
    license,
  };
}

function collectWiktApiDefinitions(senses: unknown): string[] {
  if (!Array.isArray(senses)) {
    return [];
  }

  return uniqueStrings(
    senses.flatMap((sense) =>
      isPlainObject(sense) && Array.isArray(sense.glosses)
        ? sense.glosses.filter((gloss): gloss is string => typeof gloss === 'string')
        : [],
    ),
  ).slice(0, 5);
}

function collectWiktApiExamples(senses: unknown): string[] {
  if (!Array.isArray(senses)) {
    return [];
  }

  return uniqueStrings(
    senses.flatMap((sense) =>
      isPlainObject(sense) && Array.isArray(sense.examples)
        ? sense.examples.map((example) => extractExampleText(example)).filter(Boolean)
        : [],
    ),
  ).slice(0, 3);
}

function collectWiktApiPronunciations(sounds: unknown): string[] {
  if (!Array.isArray(sounds)) {
    return [];
  }

  return uniqueStrings(
    sounds
      .filter(isPlainObject)
      .map((sound) => (typeof sound.ipa === 'string' ? sound.ipa : '')),
  ).slice(0, 3);
}

function collectWiktApiTranslations(translations: unknown, targetLang: string): string[] {
  if (!Array.isArray(translations)) {
    return [];
  }

  const exact = translations
    .filter(isPlainObject)
    .filter((translation) => !targetLang || translation.lang_code === targetLang)
    .map((translation) => (typeof translation.word === 'string' ? translation.word : ''));

  const fallback = translations
    .filter(isPlainObject)
    .map((translation) => (typeof translation.word === 'string' ? translation.word : ''));

  return uniqueStrings(exact.length > 0 ? exact : fallback).slice(0, 6);
}

function collectFreeDictionaryDefinitions(senses: unknown): string[] {
  return collectSenses(senses, (sense) =>
    typeof sense.definition === 'string' ? [sense.definition] : [],
  ).slice(0, 5);
}

function collectFreeDictionaryExamples(senses: unknown): string[] {
  return collectSenses(senses, (sense) =>
    Array.isArray(sense.examples)
      ? sense.examples.filter((example): example is string => typeof example === 'string')
      : [],
  ).slice(0, 3);
}

function collectFreeDictionaryTranslations(senses: unknown, targetLang: string): string[] {
  const translations = collectSenses(senses, (sense) => {
    if (!Array.isArray(sense.translations)) {
      return [];
    }

    const exact = sense.translations
      .filter(isPlainObject)
      .filter((translation) => {
        const language = isPlainObject(translation.language) ? translation.language : {};
        return !targetLang || language.code === targetLang;
      })
      .map((translation) => (typeof translation.word === 'string' ? translation.word : ''));

    if (exact.length > 0) {
      return exact;
    }

    return sense.translations
      .filter(isPlainObject)
      .map((translation) => (typeof translation.word === 'string' ? translation.word : ''));
  });

  return translations.slice(0, 6);
}

function collectSenses(
  senses: unknown,
  picker: (sense: Record<string, unknown>) => string[],
): string[] {
  if (!Array.isArray(senses)) {
    return [];
  }

  const values: string[] = [];
  const visit = (sense: unknown): void => {
    if (!isPlainObject(sense)) {
      return;
    }

    values.push(...picker(sense));
    if (Array.isArray(sense.subsenses)) {
      for (const subsense of sense.subsenses) {
        visit(subsense);
      }
    }
  };

  for (const sense of senses) {
    visit(sense);
  }

  return uniqueStrings(values);
}

function extractExampleText(example: unknown): string {
  if (typeof example === 'string') {
    return example;
  }
  if (isPlainObject(example) && typeof example.text === 'string') {
    return example.text;
  }
  return '';
}

function normalizeDictionaryWord(value: string): string {
  return value
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .toLowerCase();
}

function normalizeLanguageCode(value: string): string {
  const normalized = value.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return /^[a-z]{2,3}$/.test(normalized) ? normalized : '';
}

function normalizeDictionaryEdition(value: string): string {
  const normalized = normalizeLanguageCode(value);
  return normalized || 'en';
}

function buildWiktionaryUrl(edition: string, word: string): string {
  return `https://${normalizeDictionaryEdition(edition)}.wiktionary.org/wiki/${encodeURIComponent(word)}`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized || seen.has(normalized.toLowerCase())) {
      continue;
    }

    seen.add(normalized.toLowerCase());
    result.push(normalized);
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
