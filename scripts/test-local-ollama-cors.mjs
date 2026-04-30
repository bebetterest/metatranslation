import assert from 'node:assert/strict';
import {
  buildLocalOllamaCorsBypassRules,
  isLocalOllamaBaseUrl,
  LOCAL_OLLAMA_CORS_BYPASS_RULE_IDS,
} from '../src/background/localOllamaCors.ts';

let importCounter = 0;

await test('does not create local Ollama CORS rules for remote providers', () => {
  assert.deepEqual(buildLocalOllamaCorsBypassRules('https://openrouter.ai/api/v1'), []);
  assert.deepEqual(buildLocalOllamaCorsBypassRules('https://provider.example/v1'), []);
  assert.deepEqual(buildLocalOllamaCorsBypassRules('https://localhost:11434/v1'), []);
  assert.deepEqual(buildLocalOllamaCorsBypassRules('http://localhost:9999/v1'), []);
  assert.equal(isLocalOllamaBaseUrl('https://openrouter.ai/api/v1'), false);
});

await test('removes Origin only for extension background requests to local Ollama', () => {
  const [rule] = buildLocalOllamaCorsBypassRules('http://127.0.0.1:11434/v1', -1);

  assert.equal(rule.id, LOCAL_OLLAMA_CORS_BYPASS_RULE_IDS[0]);
  assert.equal(rule.action.type, 'modifyHeaders');
  assert.deepEqual(rule.action.requestHeaders, [
    {
      header: 'origin',
      operation: 'remove',
    },
  ]);
  assert.equal(rule.condition.urlFilter, '|http://127.0.0.1:11434/');
  assert.deepEqual(rule.condition.tabIds, [-1]);
  assert.deepEqual(rule.condition.requestMethods, ['options', 'post']);
  assert.deepEqual(rule.condition.resourceTypes, ['xmlhttprequest', 'other']);
  assert.equal(isLocalOllamaBaseUrl('http://127.0.0.1:11434/v1'), true);
});

await test('supports common local Ollama host aliases', () => {
  assert.equal(
    buildLocalOllamaCorsBypassRules('http://localhost:11434/v1/chat/completions')[0].condition.urlFilter,
    '|http://localhost:11434/',
  );
  assert.equal(
    buildLocalOllamaCorsBypassRules('http://0.0.0.0:11434/v1')[0].condition.urlFilter,
    '|http://0.0.0.0:11434/',
  );
  assert.equal(
    buildLocalOllamaCorsBypassRules('http://[::1]:11434/v1')[0].condition.urlFilter,
    '|http://[::1]:11434/',
  );
});

await test('configures and clears the session rule when provider settings change', async () => {
  const calls = [];

  await withChromeMock(
    {
      updateSessionRules: async (options) => {
        calls.push(options);
      },
    },
    async () => {
      const module = await importFreshLocalOllamaCors();
      await module.configureLocalOllamaCorsBypass('http://localhost:11434/v1');
      await module.configureLocalOllamaCorsBypass('http://localhost:11434/v1');
      await module.configureLocalOllamaCorsBypass('https://openrouter.ai/api/v1');
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].addRules.length, 1);
  assert.equal(calls[0].addRules[0].condition.urlFilter, '|http://localhost:11434/');
  assert.deepEqual(calls[1], {
    removeRuleIds: LOCAL_OLLAMA_CORS_BYPASS_RULE_IDS,
    addRules: [],
  });
});

await test('does not block translation if Chrome rejects the session rule update', async () => {
  let callCount = 0;

  await withConsoleWarnCapture(async (warnings) => {
    await withChromeMock(
      {
        updateSessionRules: async () => {
          callCount += 1;
          throw new Error('mock DNR failure');
        },
      },
      async () => {
        const module = await importFreshLocalOllamaCors();
        await assert.doesNotReject(
          module.configureLocalOllamaCorsBypass('http://127.0.0.1:11434/v1'),
        );
      },
    );

    assert.equal(callCount, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Failed to update local Ollama request rules/);
  });
});

async function importFreshLocalOllamaCors() {
  importCounter += 1;
  return import(`../src/background/localOllamaCors.ts?test=${importCounter}`);
}

async function withChromeMock(declarativeNetRequest, callback) {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    declarativeNetRequest,
    tabs: {
      TAB_ID_NONE: -1,
    },
  };

  try {
    await callback();
  } finally {
    if (typeof originalChrome === 'undefined') {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = originalChrome;
    }
  }
}

async function withConsoleWarnCapture(callback) {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => {
    warnings.push(args.map((entry) => String(entry)).join(' '));
  };

  try {
    await callback(warnings);
  } finally {
    console.warn = originalWarn;
  }
}

async function test(name, callback) {
  await callback();
  console.log(`ok - ${name}`);
}
