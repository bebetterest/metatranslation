import assert from 'node:assert/strict';
import { translateBlocks } from '../src/background/openai.ts';

const baseSettings = {
  baseUrl: 'https://provider.example/v1',
  apiKey: 'test-key',
  model: 'test-model',
  targetLang: 'zh-CN',
  timeoutMs: 1000,
  requestChunkSize: 1,
  requestConcurrency: 64,
  contextWindowChars: 100,
  translationRetryCount: 2,
  tolerantProviderOutput: false,
};

const baseRequest = {
  targetLang: 'zh-CN',
  pageUrl: 'https://example.test/article',
  sourceLang: 'en',
  blocks: [
    {
      id: 'b1',
      text: 'I read books in the library.',
      contextBefore: 'This sentence describes a quiet afternoon.',
      contextAfter: 'The library closes at six.',
    },
  ],
};

await test('sends generic reasoning none request body', async () => {
  const calls = [];

  await withMockFetch(calls, [chatResponse(fencedJson(validPayload()))], async () => {
    const result = await translateBlocks(baseSettings, baseRequest);

    assert.equal(result.blocks.length, 1);
    assert.equal(result.blocks[0].translatedText, '我在图书馆读书。');
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://provider.example/v1/chat/completions');
  assert.deepEqual(calls[0].body.reasoning, { effort: 'none' });
  assert.equal(calls[0].body.response_format.type, 'json_schema');
  assert.equal(calls[0].body.response_format.json_schema.strict, true);
  assert.equal(calls[0].body.response_format.json_schema.schema.required[0], 'blocks');
  assert.ok(
    calls[0].body.response_format.json_schema.schema.properties.blocks.items.required.includes(
      'translatedParts',
    ),
  );
  assert.deepEqual(calls[0].body.response_format.json_schema.schema.properties.blocks.items.required, [
    'id',
    'translatedParts',
  ]);
  assert.equal(calls[0].body.response_format.json_schema.schema.properties.blocks.items.properties.id.type, 'string');
  assert.equal(calls[0].body.response_format.json_schema.schema.properties.blocks.items.properties.sourceLang, undefined);
  assert.ok(
    calls[0].body.response_format.json_schema.schema.properties.blocks.items.properties.translatedParts.items.required.includes(
      'text',
    ),
  );
  assert.equal(calls[0].headers.Authorization, 'Bearer test-key');
  assert.equal(calls[0].headers['HTTP-Referer'], undefined);
  assert.match(calls[0].body.messages[1].content, /Output JSON:/);
  assert.match(calls[0].body.messages[1].content, /Configured target language: zh-CN \(Chinese \/ Simplified Chinese\)/);
  assert.match(calls[0].body.messages[1].content, /same id as one Payload block/);
  assert.match(calls[0].body.messages[1].content, /Do not split one input block into multiple output blocks/);
  assert.match(calls[0].body.messages[1].content, /Examples:/);
  assert.match(calls[0].body.messages[1].content, /format examples only/);
  assert.match(calls[0].body.messages[1].content, /always use the configured target language above/);
  assert.match(calls[0].body.messages[1].content, /sourceSpans/);
  assert.match(calls[0].body.messages[1].content, /translatedParts/);
  assert.match(calls[0].body.messages[1].content, /finest reliable alignment/);
  assert.match(calls[0].body.messages[1].content, /Prefer one sourceSpanId per aligned part/);
  assert.match(calls[0].body.messages[1].content, /Do not align a whole clause or sentence to one part/);
  assert.match(calls[0].body.messages[1].content, /Each sourceSpanId may appear at most once/);
  assert.match(calls[0].body.messages[1].content, /Never attach the same id to both punctuation\/filler and a translated word/);
  assert.match(calls[0].body.messages[1].content, /contextBefore\/contextAfter only for meaning/);
  assert.match(calls[0].body.messages[1].content, /context guides meaning; context is not translated/);
  assert.match(calls[0].body.messages[1].content, /CJK source characters can be grouped/);
  assert.match(calls[0].body.messages[1].content, /long sentence uses fine-grained word and term alignment/);
  assert.match(calls[0].body.messages[1].content, /decomposed/);
  assert.match(calls[0].body.messages[1].content, /function words and punctuation do not reuse source spans/);
  assert.match(calls[0].body.messages[1].content, /one translated part from non-contiguous source spans/);
  assert.match(calls[0].body.messages[1].content, /natural target order can differ from source order/);
  assert.match(calls[0].body.messages[1].content, /natural repeated target text stays separate by part order/);
  const promptBlocks = extractPromptBlocks(calls[0].body.messages[1].content);
  assert.equal(promptBlocks.length, 1);
  assert.equal(promptBlocks[0].id, 'b1');
  assert.equal(promptBlocks[0].text, 'I read books in the library.');
  assert.equal(promptBlocks[0].contextBefore, 'This sentence describes a quiet afternoon.');
  assert.equal(promptBlocks[0].contextAfter, 'The library closes at six.');
  assert.deepEqual(
    promptBlocks[0].sourceSpans.map((span) => span.id),
    ['s0', 's1', 's2', 's3', 's4', 's5'],
  );
  assert.deepEqual(
    promptBlocks[0].sourceSpans.map((span) => Object.keys(span)),
    [
      ['id', 'text'],
      ['id', 'text'],
      ['id', 'text'],
      ['id', 'text'],
      ['id', 'text'],
      ['id', 'text'],
    ],
  );
  assert.doesNotMatch(calls[0].body.messages[1].content, /targetOccurrence/);
  assert.doesNotMatch(calls[0].body.messages[1].content, /targetText/);
  assert.doesNotMatch(calls[0].body.messages[1].content, /sourceText/);
  assert.doesNotMatch(calls[0].body.messages[1].content, /alignmentId/);
  assert.doesNotMatch(calls[0].body.messages[1].content, /"start"/);
  assert.doesNotMatch(calls[0].body.messages[1].content, /"end"/);
  assert.match(calls[0].body.messages[1].content, /"id":"block-id"/);
  assert.doesNotMatch(calls[0].body.messages[1].content, /"sourceLang"/);
  assert.equal(
    calls[0].body.messages[1].content.includes(String.fromCharCode(115, 111, 117, 114, 99, 101, 84, 111, 107, 101, 110)),
    false,
  );
});

await test('injects non-default target language into prompt', async () => {
  const calls = [];

  await withMockFetch(calls, [chatResponse(JSON.stringify(validPayload()))], async () => {
    await translateBlocks(
      baseSettings,
      {
        ...baseRequest,
        targetLang: 'ja-JP',
      },
    );
  });

  assert.match(calls[0].body.messages[1].content, /Configured target language: ja-JP \(Japanese\)/);
  assert.doesNotMatch(calls[0].body.messages[1].content, /Configured target language: zh-CN/);
});

await test('keeps OpenRouter compatibility in headers only', async () => {
  const calls = [];

  await withMockFetch(
    calls,
    [chatResponse(JSON.stringify(validPayload()))],
    async () => {
      await translateBlocks(
        {
          ...baseSettings,
          baseUrl: 'https://openrouter.ai/api/v1',
        },
        baseRequest,
      );
    },
  );

  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.deepEqual(calls[0].body.reasoning, { effort: 'none' });
  assert.equal(calls[0].headers['HTTP-Referer'], 'https://codex.local');
  assert.equal(calls[0].headers['X-Title'], 'metatranslation');
});

await test('strict retry recovers invalid alignments', async () => {
  const calls = [];

  await withMockFetch(
    calls,
    [
      chatResponse(JSON.stringify(invalidPayload())),
      chatResponse(JSON.stringify(invalidPayload())),
      chatResponse(JSON.stringify(validPayload())),
    ],
    async () => {
      const result = await translateBlocks(baseSettings, baseRequest);
      assert.equal(result.blocks.length, 1);
      assert.equal(result.diagnostics.outputFailures, 2);
      assert.equal(result.diagnostics.lastOutputError, 'Translation API returned invalid or empty model output.');
    },
  );

  assert.equal(calls.length, 3);
  assert.match(calls[0].body.messages[0].content, /Return JSON only\.$/);
  assert.match(calls[2].body.messages[0].content, /previous output failed validation/);
});

await test('parse failures fall through to strict retry instead of failing the chunk', async () => {
  const calls = [];

  await withMockFetch(
    calls,
    [
      chatResponse('not json'),
      chatResponse('still not json'),
      chatResponse(JSON.stringify(validPayload())),
    ],
    async () => {
      const result = await translateBlocks(baseSettings, baseRequest);
      assert.equal(result.blocks.length, 1);
      assert.equal(result.diagnostics.outputFailures, 2);
      assert.equal(result.diagnostics.lastOutputError, 'Translation API did not return a parsable JSON object.');
    },
  );

  assert.equal(calls.length, 3);
  assert.match(calls[2].body.messages[0].content, /previous output failed validation/);
});

await test('strict mode rejects extra output blocks and retries', async () => {
  const calls = [];

  await withMockFetch(
    calls,
    [
      chatResponse(JSON.stringify(extraBlockPayload())),
      chatResponse(JSON.stringify(extraBlockPayload())),
      chatResponse(JSON.stringify(extraBlockPayload())),
    ],
    async () => {
      const result = await translateBlocks(baseSettings, baseRequest);
      assert.equal(result.blocks.length, 0);
      assert.equal(result.diagnostics.outputFailures, 3);
      assert.equal(result.diagnostics.lastOutputError, 'Translation API returned output blocks with missing, duplicate, or unexpected ids.');
    },
  );

  assert.equal(calls.length, 3);
});

await test('tolerant mode ignores extra output blocks', async () => {
  const calls = [];

  await withMockFetch(calls, [chatResponse(JSON.stringify(extraBlockPayload()))], async () => {
    const result = await translateBlocks(
      {
        ...baseSettings,
        tolerantProviderOutput: true,
      },
      baseRequest,
    );
    assert.equal(result.blocks.length, 1);
    assert.equal(result.blocks[0].translatedText, '我在图书馆读书。');
    assert.equal(result.diagnostics.outputFailures, 0);
    assert.equal(result.diagnostics.lastOutputError, '');
  });

  assert.equal(calls.length, 1);
});

await test('tolerant mode retries only missing output blocks', async () => {
  const calls = [];
  const request = {
    ...baseRequest,
    blocks: [
      baseRequest.blocks[0],
      {
        id: 'b2',
        text: 'Tom likes tea.',
      },
    ],
  };

  await withMockFetch(
    calls,
    [
      chatResponse(JSON.stringify(validPayload())),
      chatResponse(JSON.stringify(validPayloadForB2())),
    ],
    async () => {
      const result = await translateBlocks(
        {
          ...baseSettings,
          tolerantProviderOutput: true,
        },
        request,
      );
      assert.equal(result.blocks.length, 2);
      assert.deepEqual(result.blocks.map((block) => block.id), ['b1', 'b2']);
      assert.equal(result.diagnostics.outputFailures, 1);
      assert.equal(result.diagnostics.lastOutputError, 'Translation API returned fewer usable output blocks than requested.');
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(extractPromptBlocks(calls[0].body.messages[1].content).length, 2);
  const retryPromptBlocks = extractPromptBlocks(calls[1].body.messages[1].content);
  assert.equal(retryPromptBlocks.length, 1);
  assert.equal(retryPromptBlocks[0].id, 'b2');
});

await test('configured retry count can disable output retries', async () => {
  const calls = [];

  await withMockFetch(calls, [chatResponse(JSON.stringify(invalidPayload()))], async () => {
    const result = await translateBlocks(
      {
        ...baseSettings,
        translationRetryCount: 0,
      },
      baseRequest,
    );
    assert.equal(result.blocks.length, 0);
    assert.equal(result.diagnostics.outputFailures, 1);
    assert.equal(result.diagnostics.lastOutputError, 'Translation API returned invalid or empty model output.');
  });

  assert.equal(calls.length, 1);
});

await test('strict mode rejects missing output ids and retries', async () => {
  const calls = [];

  await withMockFetch(
    calls,
    [
      chatResponse(JSON.stringify(missingIdPayload())),
      chatResponse(JSON.stringify(missingIdPayload())),
      chatResponse(JSON.stringify(missingIdPayload())),
    ],
    async () => {
      const result = await translateBlocks(baseSettings, baseRequest);
      assert.equal(result.blocks.length, 0);
      assert.equal(result.diagnostics.outputFailures, 3);
      assert.equal(result.diagnostics.lastOutputError, 'Translation API returned output blocks with missing, duplicate, or unexpected ids.');
    },
  );

  assert.equal(calls.length, 3);
});

await test('strict mode rejects duplicate output ids and retries', async () => {
  const calls = [];

  await withMockFetch(
    calls,
    [
      chatResponse(JSON.stringify(duplicateIdPayload())),
      chatResponse(JSON.stringify(duplicateIdPayload())),
      chatResponse(JSON.stringify(duplicateIdPayload())),
    ],
    async () => {
      const result = await translateBlocks(baseSettings, baseRequest);
      assert.equal(result.blocks.length, 0);
      assert.equal(result.diagnostics.outputFailures, 3);
      assert.equal(result.diagnostics.lastOutputError, 'Translation API returned output blocks with missing, duplicate, or unexpected ids.');
    },
  );

  assert.equal(calls.length, 3);
});

async function withMockFetch(calls, responses, callback) {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const bodyText = String(init.body ?? '');
    calls.push({
      url: String(url),
      headers: init.headers ?? {},
      body: JSON.parse(bodyText),
    });

    const response = responses.shift();
    if (!response) {
      throw new Error('Unexpected fetch call.');
    }
    return response;
  };

  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function chatResponse(content) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content,
          },
        },
      ],
    }),
  };
}

function fencedJson(payload) {
  return `<think>not part of the answer</think>\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
}

function validPayload() {
  return {
    blocks: [
      {
        id: 'b1',
        translatedParts: [
          { text: '我', sourceSpanIds: ['s0'] },
          { text: '在', sourceSpanIds: ['s3'] },
          { text: '图书馆', sourceSpanIds: ['s5'] },
          { text: '读', sourceSpanIds: ['s1'] },
          { text: '书', sourceSpanIds: ['s2'] },
          { text: '。' },
        ],
      },
    ],
  };
}

function validPayloadForB2() {
  return {
    blocks: [
      {
        id: 'b2',
        translatedParts: [
          { text: '汤姆', sourceSpanIds: ['s0'] },
          { text: '喜欢', sourceSpanIds: ['s1'] },
          { text: '茶', sourceSpanIds: ['s2'] },
          { text: '。' },
        ],
      },
    ],
  };
}

function invalidPayload() {
  return {
    blocks: [
      {
        id: 'b1',
        translatedParts: [{ text: '蓝色', sourceSpanIds: ['s999'] }],
      },
    ],
  };
}

function extraBlockPayload() {
  return {
    blocks: [
      validPayload().blocks[0],
      {
        id: 'extra',
        translatedParts: [
          { text: '多余', sourceSpanIds: ['s0'] },
        ],
      },
    ],
  };
}

function missingIdPayload() {
  return {
    blocks: [
      {
        translatedParts: [
          { text: '我', sourceSpanIds: ['s0'] },
          { text: '读', sourceSpanIds: ['s1'] },
        ],
      },
    ],
  };
}

function duplicateIdPayload() {
  return {
    blocks: [
      validPayload().blocks[0],
      {
        id: 'b1',
        translatedParts: [
          { text: '重复', sourceSpanIds: ['s0'] },
        ],
      },
    ],
  };
}

function extractPromptBlocks(prompt) {
  const marker = 'Payload: ';
  const index = prompt.lastIndexOf(marker);
  assert.notEqual(index, -1);
  return JSON.parse(prompt.slice(index + marker.length));
}

async function test(name, callback) {
  await callback();
  console.log(`ok - ${name}`);
}
