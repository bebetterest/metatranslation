import assert from 'node:assert/strict';
import { normalizeSettings } from '../src/lib/settings.ts';

test('normalizes dirty settings from storage', () => {
  const settings = normalizeSettings({
    baseUrl: ' https://provider.example/v1/ ',
    apiKey: ' key ',
    model: ' model ',
    targetLang: ' ',
    timeoutMs: -1,
    requestChunkSize: 99,
    requestConcurrency: 99,
    contextWindowChars: 2500,
    translationRetryCount: 99,
    dictionaryProvider: 'freedictionaryapi',
    dictionaryEdition: ' fr ',
    dictionaryHoverHoldMs: 9999,
    tolerantProviderOutput: true,
  });

  assert.equal(settings.baseUrl, 'https://provider.example/v1');
  assert.equal(settings.apiKey, 'key');
  assert.equal(settings.model, 'model');
  assert.equal(settings.targetLang, 'zh-CN');
  assert.equal(settings.timeoutMs, 30000);
  assert.equal(settings.requestChunkSize, 10);
  assert.equal(settings.requestConcurrency, 64);
  assert.equal(settings.contextWindowChars, 1000);
  assert.equal(settings.translationRetryCount, 10);
  assert.equal(settings.dictionaryProvider, 'freedictionaryapi');
  assert.equal(settings.dictionaryEdition, 'en');
  assert.equal(settings.dictionaryHoverHoldMs, 5000);
  assert.equal(settings.tolerantProviderOutput, true);
});

test('floors fractional parallel request settings', () => {
  const settings = normalizeSettings({
    requestConcurrency: 2.9,
  });

  assert.equal(settings.requestConcurrency, 2);
});

test('falls back when stored values have wrong types', () => {
  const settings = normalizeSettings({
    baseUrl: 1,
    apiKey: null,
    model: {},
    targetLang: [],
    timeoutMs: Number.NaN,
    requestChunkSize: '4',
    requestConcurrency: 0,
    contextWindowChars: '200',
    translationRetryCount: '2',
    dictionaryProvider: 'invalid',
    dictionaryEdition: ' ',
    dictionaryHoverHoldMs: '1000',
    tolerantProviderOutput: 'true',
  });

  assert.equal(settings.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(settings.apiKey, '');
  assert.equal(settings.model, 'x-ai/grok-4.1-fast');
  assert.equal(settings.targetLang, 'zh-CN');
  assert.equal(settings.timeoutMs, 30000);
  assert.equal(settings.requestChunkSize, 1);
  assert.equal(settings.requestConcurrency, 64);
  assert.equal(settings.contextWindowChars, 100);
  assert.equal(settings.translationRetryCount, 2);
  assert.equal(settings.dictionaryProvider, 'wiktapi');
  assert.equal(settings.dictionaryEdition, 'en');
  assert.equal(settings.dictionaryHoverHoldMs, 1000);
  assert.equal(settings.tolerantProviderOutput, true);
});

test('allows zero retry count to disable retry passes', () => {
  const settings = normalizeSettings({
    translationRetryCount: 0,
  });

  assert.equal(settings.translationRetryCount, 0);
});

test('allows zero context window to disable adjacent context', () => {
  const settings = normalizeSettings({
    contextWindowChars: 0,
  });

  assert.equal(settings.contextWindowChars, 0);
});

test('allows zero dictionary hover hold to disable tooltip keepalive', () => {
  const settings = normalizeSettings({
    dictionaryHoverHoldMs: 0,
  });

  assert.equal(settings.dictionaryHoverHoldMs, 0);
});

test('falls back when base url only contains slashes', () => {
  const settings = normalizeSettings({
    baseUrl: '///',
  });

  assert.equal(settings.baseUrl, 'https://openrouter.ai/api/v1');
});

function test(name, callback) {
  callback();
  console.log(`ok - ${name}`);
}
