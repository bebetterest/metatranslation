import assert from 'node:assert/strict';
import {
  buildDictionaryCacheKey,
  buildDictionaryLookupCandidates,
  buildDictionaryUrl,
  parseFreeDictionaryApiResult,
  parseWiktApiResult,
} from '../src/background/dictionary.ts';

test('builds WiktApi lookup urls with edition and source language', () => {
  assert.equal(
    buildDictionaryUrl('wiktapi', 'like', 'en', 'en'),
    'https://api.wiktapi.dev/v1/en/word/like?lang=en',
  );
});

test('builds FreeDictionaryAPI lookup urls with translations enabled', () => {
  assert.equal(
    buildDictionaryUrl('freedictionaryapi', 'like', 'en'),
    'https://freedictionaryapi.com/api/v1/entries/en/like?translations=true',
  );
});

test('uses stable dictionary cache keys', () => {
  assert.equal(
    buildDictionaryCacheKey('wiktapi', 'en', 'like', 'en', 'zh'),
    'dictionary-v3::wiktapi::en::en::zh::like',
  );
  assert.equal(
    buildDictionaryCacheKey('wiktapi', 'en', 'Claude', 'zh', 'zh'),
    'dictionary-v3::wiktapi::en::zh::zh::Claude',
  );
});

test('queries Latin words in English before all-language fallback', () => {
  assert.deepEqual(buildDictionaryLookupCandidates('with', 'zh'), [
    { word: 'with', sourceLang: 'en' },
    { word: 'with', sourceLang: '' },
  ]);
});

test('preserves case before lowercase fallback for proper nouns', () => {
  assert.deepEqual(buildDictionaryLookupCandidates('Claude', 'zh'), [
    { word: 'Claude', sourceLang: 'en' },
    { word: 'claude', sourceLang: 'en' },
    { word: 'Claude', sourceLang: '' },
    { word: 'claude', sourceLang: '' },
  ]);
});

test('does not hard-filter Latin lookups by page source language', () => {
  assert.deepEqual(buildDictionaryLookupCandidates('avec', 'fr'), [
    { word: 'avec', sourceLang: 'en' },
    { word: 'avec', sourceLang: '' },
  ]);
});

test('uses all-language lookup for non-Latin words', () => {
  assert.deepEqual(buildDictionaryLookupCandidates('中文', 'zh'), [
    { word: '中文', sourceLang: '' },
  ]);
});

test('parses WiktApi entries into normalized dictionary results', () => {
  const result = parseWiktApiResult(
    {
      entries: [
        {
          word: 'like',
          lang_code: 'en',
          pos: 'verb',
          senses: [
            {
              glosses: ['To enjoy or approve of something.'],
              examples: [{ text: 'I like tea.' }],
            },
          ],
          sounds: [{ ipa: '/laɪk/' }],
          translations: [
            { lang_code: 'zh', word: '喜欢' },
            { lang_code: 'fr', word: 'aimer' },
          ],
        },
      ],
    },
    'like',
    'en',
    'zh',
    'en',
  );

  assert.equal(result.provider, 'wiktapi');
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].partOfSpeech, 'verb');
  assert.deepEqual(result.entries[0].definitions, ['To enjoy or approve of something.']);
  assert.deepEqual(result.entries[0].examples, ['I like tea.']);
  assert.deepEqual(result.entries[0].pronunciations, ['/laɪk/']);
  assert.deepEqual(result.entries[0].translations, ['喜欢']);
  assert.equal(result.sourceUrl, 'https://en.wiktionary.org/wiki/like');
});

test('parses FreeDictionaryAPI entries into normalized dictionary results', () => {
  const result = parseFreeDictionaryApiResult(
    {
      word: 'like',
      source: {
        url: 'https://en.wiktionary.org/wiki/like',
        license: { name: 'CC BY-SA 4.0' },
      },
      entries: [
        {
          language: { code: 'en', name: 'English' },
          partOfSpeech: 'verb',
          pronunciations: [{ type: 'ipa', text: '/laɪk/', tags: [] }],
          senses: [
            {
              definition: 'To enjoy.',
              examples: ['I like tea.'],
              translations: [
                { language: { code: 'zh', name: 'Chinese' }, word: '喜欢' },
                { language: { code: 'fr', name: 'French' }, word: 'aimer' },
              ],
              subsenses: [],
            },
          ],
        },
      ],
    },
    'like',
    'en',
    'zh',
  );

  assert.equal(result.provider, 'freedictionaryapi');
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.entries[0].definitions, ['To enjoy.']);
  assert.deepEqual(result.entries[0].translations, ['喜欢']);
  assert.equal(result.attribution, 'FreeDictionaryAPI / Wiktionary data (CC BY-SA 4.0)');
});

test('ranks all-language FreeDictionaryAPI entries by likely source language', () => {
  const result = parseFreeDictionaryApiResult(
    {
      source: {
        url: 'https://en.wiktionary.org/wiki/me',
        license: { name: 'CC BY-SA 4.0' },
      },
      entries: [
        {
          language: { code: 'fr', name: 'French' },
          partOfSpeech: 'pronoun',
          senses: [{ definition: 'French me.', subsenses: [] }],
        },
        {
          language: { code: 'en', name: 'English' },
          partOfSpeech: 'pronoun',
          senses: [{ definition: 'English me.', subsenses: [] }],
        },
        {
          language: { code: 'zh', name: 'Chinese' },
          partOfSpeech: 'romanization',
          senses: [{ definition: 'Pinyin me.', subsenses: [] }],
        },
      ],
    },
    'me',
    '',
    'zh',
    ['en', 'zh'],
  );

  assert.deepEqual(result.entries.map((entry) => entry.sourceLang), ['en', 'zh', 'fr']);
});

function test(name, callback) {
  callback();
  console.log(`ok - ${name}`);
}
