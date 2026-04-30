import assert from 'node:assert/strict';
import {
  appendTestLogEntry,
  buildTestLogEntry,
} from '../src/background/testLogs.ts';

test('sanitizes test log details before storage', () => {
  const entry = buildTestLogEntry(
    {
      level: 'error',
      source: 'content',
      event: 'translation_failed',
      pageUrl: 'https://example.test/article?access_token=page-token&keep=1',
      details: {
        apiKey: 'sk-live-secret-key',
        Authorization: 'Bearer provider-token',
        message: 'failed with Bearer inline-token',
        callbackUrl: 'https://provider.example/callback?api_key=query-secret&ok=1',
        nested: {
          token: 'plain-token',
        },
      },
    },
    123,
  );

  assert.equal(entry.timestamp, 123);
  assert.equal(entry.level, 'error');
  assert.equal(entry.source, 'content');
  assert.equal(entry.event, 'translation_failed');
  assert.equal(entry.pageUrl, 'https://example.test/article?access_token=[redacted]&keep=1');
  assert.equal(entry.details.apiKey, '[redacted]');
  assert.equal(entry.details.Authorization, '[redacted]');
  assert.equal(entry.details.message, 'failed with Bearer [redacted]');
  assert.equal(entry.details.callbackUrl, 'https://provider.example/callback?api_key=[redacted]&ok=1');
  assert.deepEqual(entry.details.nested, {
    token: '[redacted]',
  });
});

test('keeps test logs in a bounded ring buffer', () => {
  const logs = [
    buildTestLogEntry({ level: 'info', source: 'background', event: 'one' }, 1),
    buildTestLogEntry({ level: 'info', source: 'background', event: 'two' }, 2),
  ];
  const next = buildTestLogEntry({ level: 'info', source: 'background', event: 'three' }, 3);

  const result = appendTestLogEntry(logs, next, 2);

  assert.deepEqual(
    result.map((entry) => entry.event),
    ['two', 'three'],
  );
});

test('falls back to the default log limit when given an invalid limit', () => {
  const logs = [
    buildTestLogEntry({ level: 'info', source: 'background', event: 'one' }, 1),
  ];
  const next = buildTestLogEntry({ level: 'info', source: 'background', event: 'two' }, 2);

  const result = appendTestLogEntry(logs, next, Number.NaN);

  assert.deepEqual(
    result.map((entry) => entry.event),
    ['one', 'two'],
  );
});

function test(name, callback) {
  callback();
  console.log(`ok - ${name}`);
}
