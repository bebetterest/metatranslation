import http from 'node:http';

const port = Number(process.env.MOCK_TRANSLATION_PORT ?? 8787);

const FIXTURES = new Map([
  [
    'A Tiny Translation Fixture',
    {
      sourceLang: 'en',
      translatedText: '一个小翻译装置',
      alignments: [
        ['A', '一个'],
        ['Tiny', '小'],
        ['Translation', '翻译'],
        ['Fixture', '装置'],
      ],
    },
  ],
  [
    'I like you.',
    {
      sourceLang: 'en',
      translatedText: '我喜欢你。',
      alignments: [
        ['I', '我'],
        ['like', '喜欢'],
        ['you', '你'],
        ['.', '。'],
      ],
    },
  ],
  [
    'The sky is blue.',
    {
      sourceLang: 'en',
      translatedText: '天空是蓝色的。',
      alignments: [
        ['The', '天'],
        ['sky', '空'],
        ['is', '是'],
        ['blue', '蓝色的'],
        ['.', '。'],
      ],
    },
  ],
  [
    'We read books.',
    {
      sourceLang: 'en',
      translatedText: '我们读书。',
      alignments: [
        ['We', '我们'],
        ['read', '读'],
        ['books', '书'],
        ['.', '。'],
      ],
    },
  ],
  [
    'Do not translate this button label',
    {
      sourceLang: 'en',
      translatedText: '不要翻译这个按钮标签',
      alignments: [
        ['Do', '不要'],
        ['not', '翻'],
        ['translate', '译'],
        ['this', '这个'],
        ['button', '按钮'],
        ['label', '标签'],
      ],
    },
  ],
  [
    'Flexible text stays below.',
    {
      sourceLang: 'en',
      translatedText: '灵活文本保持在下方。',
      alignments: [
        ['Flexible', '灵活'],
        ['text', '文本'],
        ['stays', '保持'],
        ['below', '在下方'],
        ['.', '。'],
      ],
    },
  ],
  [
    'Do not translate this link text',
    {
      sourceLang: 'en',
      translatedText: '不要翻译这个链接文本',
      alignments: [
        ['Do', '不要'],
        ['not', '翻'],
        ['translate', '译'],
        ['this', '这个'],
        ['link', '链接'],
        ['text', '文本'],
      ],
    },
  ],
  [
    'Do not translate this input button',
    {
      sourceLang: 'en',
      translatedText: '不要翻译这个输入按钮',
      alignments: [
        ['Do', '不要'],
        ['not', '翻'],
        ['translate', '译'],
        ['this', '这个'],
        ['input', '输入'],
        ['button', '按钮'],
      ],
    },
  ],
]);

const server = http.createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end('Not Found');
    return;
  }

  const body = await readBody(request);
  const payload = JSON.parse(body);
  const userMessage = payload?.messages?.find?.((entry) => entry?.role === 'user')?.content ?? '';
  const blocks = extractBlocks(userMessage);

  const result = {
    blocks: blocks.map((block) => translateBlock(block)),
  };

  response.writeHead(200, {
    'Content-Type': 'application/json',
  });
  response.end(
    JSON.stringify({
      id: 'mock-chatcmpl',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            content: JSON.stringify(result),
          },
        },
      ],
    }),
  );
});

server.listen(port, () => {
  console.log(`Mock translation server listening on http://127.0.0.1:${port}/v1/chat/completions`);
});

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function extractBlocks(userMessage) {
  const marker = 'Payload: ';
  const index = String(userMessage).lastIndexOf(marker);
  if (index === -1) {
    return [];
  }

  return JSON.parse(String(userMessage).slice(index + marker.length));
}

function translateBlock(block) {
  const fixture = FIXTURES.get(block.text);
  if (!fixture) {
    return {
      id: block.id,
      translatedParts: buildIdentityTranslatedParts(block),
    };
  }

  return {
    id: block.id,
    translatedParts: buildMappedTranslatedParts(block, fixture.translatedText, fixture.alignments),
  };
}

function buildMappedTranslatedParts(block, translatedText, pairs) {
  let targetCursor = 0;
  const parts = [];

  for (const [sourcePart, targetPart] of pairs) {
    const targetStart = translatedText.indexOf(targetPart, targetCursor);

    if (targetStart === -1) {
      throw new Error(`Failed to align "${sourcePart}" -> "${targetPart}"`);
    }

    if (targetStart > targetCursor) {
      parts.push({ text: translatedText.slice(targetCursor, targetStart) });
    }

    const sourceSpanIds = findSourceSpanIds(block.sourceSpans ?? [], sourcePart);
    parts.push(
      sourceSpanIds.length > 0
        ? { text: targetPart, sourceSpanIds }
        : { text: targetPart },
    );
    targetCursor = targetStart + targetPart.length;
  }

  if (targetCursor < translatedText.length) {
    parts.push({ text: translatedText.slice(targetCursor) });
  }

  return parts;
}

function buildIdentityTranslatedParts(block) {
  const spans = block.sourceSpans ?? [];
  if (spans.length === 0) {
    return [{ text: block.text }];
  }

  let cursor = 0;
  const parts = [];

  for (const span of spans) {
    const start = Number.isInteger(span.start) ? span.start : block.text.indexOf(span.text, cursor);
    if (start === -1) {
      continue;
    }

    const end = Number.isInteger(span.end) ? span.end : start + String(span.text).length;
    if (start > cursor) {
      parts.push({ text: block.text.slice(cursor, start) });
    }
    parts.push({ text: span.text, sourceSpanIds: [span.id] });
    cursor = end;
  }

  if (cursor < block.text.length) {
    parts.push({ text: block.text.slice(cursor) });
  }

  return parts;
}

function findSourceSpanIds(sourceSpans, sourceText) {
  const direct = sourceSpans.find((span) => span.text === sourceText);
  if (direct) {
    return [direct.id];
  }

  const words = sourceText.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return [];
  }

  const ids = [];
  let searchFrom = 0;
  for (const word of words) {
    const index = sourceSpans.findIndex((span, spanIndex) => spanIndex >= searchFrom && span.text === word);
    if (index === -1) {
      return [];
    }
    ids.push(sourceSpans[index].id);
    searchFrom = index + 1;
  }
  return ids;
}
