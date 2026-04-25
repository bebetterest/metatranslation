import assert from 'node:assert/strict';
import fs from 'node:fs';

const LOCALE_FILES = {
  en: 'public/_locales/en/messages.json',
  zh_CN: 'public/_locales/zh_CN/messages.json',
};

const SOURCE_FILES = [
  'manifest.config.ts',
  'src/background/index.ts',
  'src/content/injected.ts',
  'src/options/index.html',
  'src/options/main.ts',
];

const locales = Object.fromEntries(
  Object.entries(LOCALE_FILES).map(([locale, filePath]) => [
    locale,
    JSON.parse(fs.readFileSync(filePath, 'utf8')),
  ]),
);

test('locale files expose the same non-empty message keys', () => {
  const [baseLocale, ...otherLocales] = Object.keys(locales);
  const baseKeys = Object.keys(locales[baseLocale]).sort();

  assert.ok(baseKeys.length > 0, 'expected at least one locale key');

  for (const locale of otherLocales) {
    assert.deepEqual(Object.keys(locales[locale]).sort(), baseKeys, `${locale} key mismatch`);
  }

  for (const [locale, messages] of Object.entries(locales)) {
    for (const [key, entry] of Object.entries(messages)) {
      assert.equal(typeof entry.message, 'string', `${locale}.${key} message must be a string`);
      assert.ok(entry.message.trim(), `${locale}.${key} message must not be empty`);
    }
  }
});

test('localized messages keep matching placeholder indexes', () => {
  const keys = Object.keys(locales.en);

  for (const key of keys) {
    const enPlaceholders = collectPlaceholders(locales.en[key].message);
    const zhPlaceholders = collectPlaceholders(locales.zh_CN[key].message);
    assert.deepEqual(zhPlaceholders, enPlaceholders, `${key} placeholder mismatch`);
  }
});

test('all source i18n references exist and locale keys stay used', () => {
  const source = SOURCE_FILES.map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n');
  const referencedKeys = collectReferencedKeys(source);
  const localeKeys = new Set(Object.keys(locales.en));

  assert.ok(referencedKeys.size > 0, 'expected source files to reference locale keys');

  const missingKeys = [...referencedKeys].filter((key) => !localeKeys.has(key));
  assert.deepEqual(missingKeys, [], 'source references missing locale keys');

  const unusedKeys = [...localeKeys].filter((key) => !referencedKeys.has(key));
  assert.deepEqual(unusedKeys, [], 'locale keys should be referenced by source');
});

function collectReferencedKeys(source) {
  const keys = new Set();

  for (const match of source.matchAll(/__MSG_([A-Za-z0-9_]+?)__/g)) {
    keys.add(match[1]);
  }

  for (const match of source.matchAll(/getUiMessage\(\s*['"]([^'"]+)['"]/g)) {
    keys.add(match[1]);
  }

  for (const match of source.matchAll(/data-i18n(?:-placeholder)?=["']([^"']+)["']/g)) {
    keys.add(match[1]);
  }

  return keys;
}

function collectPlaceholders(message) {
  return [...new Set([...message.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])))]
    .sort((left, right) => left - right);
}

async function test(name, fn) {
  await fn();
  console.log(`ok - ${name}`);
}
