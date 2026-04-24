import assert from 'node:assert/strict';
import { sanitizeTranslationResultBlock } from '../src/lib/alignment.ts';

const sourceBlock = {
  id: 'block-1',
  text: 'red car',
};

test('builds translated text and alignment ranges from translated parts', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      translatedParts: [
        { text: '汽车', sourceSpanIds: ['s1'] },
        { text: '红色', sourceSpanIds: ['s0'] },
      ],
    },
    sourceBlock,
    'en',
  );

  assert.equal(block?.id, sourceBlock.id);
  assert.equal(block?.sourceLang, 'en');
  assert.equal(block?.translatedText, '汽车红色');
  assert.deepEqual(block?.alignments, [
    expectedAlignment('block-1:0', [[4, 7]], 0, 2, 'car'),
    expectedAlignment('block-1:1', [[0, 3]], 2, 4, 'red'),
  ]);
});

test('resolves repeated target text by translated part order', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: 'repeat-target',
      translatedParts: [
        { text: '汤姆', sourceSpanIds: ['s0'] },
        { text: '喜欢', sourceSpanIds: ['s1'] },
        { text: '茶', sourceSpanIds: ['s2'] },
        { text: '，' },
        { text: '玛丽', sourceSpanIds: ['s4'] },
        { text: '喜欢', sourceSpanIds: ['s5'] },
        { text: '咖啡', sourceSpanIds: ['s6'] },
        { text: '。' },
      ],
    },
    {
      id: 'repeat-target',
      text: 'Tom likes tea and Mary likes coffee.',
    },
    'en',
  );

  assert.deepEqual(block?.alignments, [
    expectedAlignment('repeat-target:0', [[0, 3]], 0, 2, 'Tom'),
    expectedAlignment('repeat-target:1', [[4, 9]], 2, 4, 'likes'),
    expectedAlignment('repeat-target:2', [[10, 13]], 4, 5, 'tea'),
    expectedAlignment('repeat-target:4', [[18, 22]], 6, 8, 'Mary'),
    expectedAlignment('repeat-target:5', [[23, 28]], 8, 10, 'likes'),
    expectedAlignment('repeat-target:6', [[29, 35]], 10, 12, 'coffee'),
  ]);
});

test('allows adjacent CJK source spans to form one alignment', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: 'cjk-source',
      translatedParts: [
        { text: 'I', sourceSpanIds: ['s0'] },
        { text: ' ' },
        { text: 'like', sourceSpanIds: ['s1', 's2'] },
        { text: ' ' },
        { text: 'you', sourceSpanIds: ['s3'] },
        { text: '.' },
      ],
    },
    {
      id: 'cjk-source',
      text: '我喜欢你',
    },
    'zh-CN',
  );

  assert.equal(block?.translatedText, 'I like you.');
  assert.deepEqual(block?.alignments, [
    expectedAlignment('cjk-source:0', [[0, 1]], 0, 1, '我'),
    expectedAlignment('cjk-source:2', [[1, 3]], 2, 6, '喜欢'),
    expectedAlignment('cjk-source:4', [[3, 4]], 7, 10, '你'),
  ]);
});

test('allows non-contiguous source spans in one translated part', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: 'non-contiguous',
      translatedParts: [
        { text: '把' },
        { text: '它', sourceSpanIds: ['s1'] },
        { text: '捡起来', sourceSpanIds: ['s0', 's2'] },
      ],
    },
    {
      id: 'non-contiguous',
      text: 'pick it up',
    },
    'en',
  );

  assert.equal(block?.translatedText, '把它捡起来');
  assert.deepEqual(block?.alignments, [
    expectedAlignment('non-contiguous:1', [[5, 7]], 1, 2, 'it'),
    expectedAlignment('non-contiguous:2', [[0, 4], [8, 10]], 2, 5, 'pick up'),
  ]);
});

test('rejects reused source spans across translated parts', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      translatedParts: [
        { text: '红色', sourceSpanIds: ['s0'] },
        { text: '赤色', sourceSpanIds: ['s0'] },
      ],
    },
    sourceBlock,
  );

  assert.equal(block, null);
});

test('ignores source span ids on pure punctuation translated parts', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      translatedParts: [
        { text: '红色', sourceSpanIds: ['s0'] },
        { text: '，', sourceSpanIds: ['s1'] },
        { text: '汽车', sourceSpanIds: ['s1'] },
      ],
    },
    sourceBlock,
  );

  assert.equal(block?.translatedText, '红色，汽车');
  assert.deepEqual(block?.alignments, [
    expectedAlignment('block-1:0', [[0, 3]], 0, 2, 'red'),
    expectedAlignment('block-1:2', [[4, 7]], 3, 5, 'car'),
  ]);
});

test('rejects missing translated part text', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      translatedParts: [{ sourceSpanIds: ['s0'] }],
    },
    sourceBlock,
  );

  assert.equal(block, null);
});

test('rejects translated parts with invalid source span ids', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      translatedParts: [{ text: '蓝色', sourceSpanIds: ['s999'] }],
    },
    sourceBlock,
  );

  assert.equal(block, null);
});

test('rejects malformed sourceSpanIds in strict translated-part output', () => {
  const nonStringIds = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      translatedParts: [{ text: '红色', sourceSpanIds: [123] }],
    },
    sourceBlock,
  );
  const emptyIds = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      translatedParts: [{ text: '红色', sourceSpanIds: [] }],
    },
    sourceBlock,
  );

  assert.equal(nonStringIds, null);
  assert.equal(emptyIds, null);
});

test('tolerant mode keeps text and ignores invalid source span ids', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      translatedParts: [
        { text: '红色', sourceSpanIds: ['s0'] },
        { text: '蓝色', sourceSpanIds: ['s999'] },
        { text: '汽车', sourceSpanIds: ['s1'] },
      ],
    },
    sourceBlock,
    {
      sourceLangHint: 'en',
      tolerantProviderOutput: true,
    },
  );

  assert.equal(block?.translatedText, '红色蓝色汽车');
  assert.deepEqual(block?.alignments, [
    expectedAlignment('block-1:0', [[0, 3]], 0, 2, 'red'),
    expectedAlignment('block-1:2', [[4, 7]], 4, 6, 'car'),
  ]);
});

test('tolerant mode can return unaligned translation text', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      translatedParts: [{ text: '蓝色', sourceSpanIds: ['s999'] }],
    },
    sourceBlock,
    {
      sourceLangHint: 'en',
      tolerantProviderOutput: true,
    },
  );

  assert.equal(block?.translatedText, '蓝色');
  assert.deepEqual(block?.alignments, []);
});

test('tolerant mode keeps text and ignores malformed sourceSpanIds', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      translatedParts: [
        { text: '红色', sourceSpanIds: [123] },
        { text: '汽车', sourceSpanIds: ['s1'] },
      ],
    },
    sourceBlock,
    {
      sourceLangHint: 'en',
      tolerantProviderOutput: true,
    },
  );

  assert.equal(block?.translatedText, '红色汽车');
  assert.deepEqual(block?.alignments, [
    expectedAlignment('block-1:1', [[4, 7]], 2, 4, 'car'),
  ]);
});

test('tolerant mode ignores duplicate source-span reuse after first alignment', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      translatedParts: [
        { text: '红色', sourceSpanIds: ['s0'] },
        { text: '赤色', sourceSpanIds: ['s0'] },
        { text: '汽车', sourceSpanIds: ['s1'] },
      ],
    },
    sourceBlock,
    {
      sourceLangHint: 'en',
      tolerantProviderOutput: true,
    },
  );

  assert.equal(block?.translatedText, '红色赤色汽车');
  assert.deepEqual(block?.alignments, [
    expectedAlignment('block-1:0', [[0, 3]], 0, 2, 'red'),
    expectedAlignment('block-1:2', [[4, 7]], 4, 6, 'car'),
  ]);
});

test('rejects singular sourceSpanId in translated parts', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      translatedParts: [{ text: '红色', sourceSpanId: 's0' }],
    },
    sourceBlock,
  );

  assert.equal(block, null);
});

test('rejects extra fields in translated parts', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      translatedParts: [{ text: '红色', sourceSpanIds: ['s0'], alignmentId: 'model-owned' }],
    },
    sourceBlock,
  );

  assert.equal(block, null);
});

test('accepts valid reordered legacy target ranges', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      sourceLang: 'en',
      translatedText: '汽车红色',
      alignments: [
        legacyAlignment('color', 0, 3, 2, 4, 'red'),
        legacyAlignment('vehicle', 4, 7, 0, 2, 'car'),
      ],
    },
    sourceBlock,
  );

  assert.equal(block?.alignments.length, 2);
  assert.deepEqual(
    block?.alignments.map((entry) => entry.alignmentId),
    ['color', 'vehicle'],
  );
});

test('rejects overlapping legacy target ranges', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      sourceLang: 'en',
      translatedText: '红色车',
      alignments: [
        legacyAlignment('color', 0, 3, 0, 2, 'red'),
        legacyAlignment('vehicle', 4, 7, 1, 3, 'car'),
      ],
    },
    sourceBlock,
  );

  assert.equal(block, null);
});

test('rejects overlapping legacy source ranges', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      sourceLang: 'en',
      translatedText: '红色车',
      alignments: [
        legacyAlignment('color', 0, 3, 0, 2, 'red'),
        legacyAlignment('vehicle', 2, 7, 2, 3, 'd car'),
      ],
    },
    sourceBlock,
  );

  assert.equal(block, null);
});

test('rejects duplicate legacy alignment ids', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      sourceLang: 'en',
      translatedText: '红色车',
      alignments: [
        legacyAlignment('dup', 0, 3, 0, 2, 'red'),
        legacyAlignment('dup', 4, 7, 2, 3, 'car'),
      ],
    },
    sourceBlock,
  );

  assert.equal(block, null);
});

test('repairs recoverable legacy offsets from exact source and target text', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      sourceLang: 'en',
      translatedText: '汽车红色',
      alignments: [
        legacyAlignment('color', 0, 99, 99, 101, 'red', '红色'),
        legacyAlignment('vehicle', 4, 8, 0, 99, 'car', '汽车'),
      ],
    },
    sourceBlock,
  );

  assert.deepEqual(block?.alignments, [
    expectedAlignment('color', [[0, 3]], 2, 4, 'red'),
    expectedAlignment('vehicle', [[4, 7]], 0, 2, 'car'),
  ]);
});

test('rejects unrecoverable ambiguous legacy text repairs', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: 'repeated',
      sourceLang: 'en',
      translatedText: '红色红色',
      alignments: [legacyAlignment('ambiguous', 99, 100, 99, 100, 'red', '红色')],
    },
    {
      id: 'repeated',
      text: 'red red',
    },
  );

  assert.equal(block, null);
});

test('rejects blocks with any invalid legacy alignment', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      sourceLang: 'en',
      translatedText: '红色车',
      alignments: [
        legacyAlignment('color', 0, 3, 0, 2, 'red'),
        legacyAlignment('vehicle', 4, 99, 2, 3, 'truck'),
      ],
    },
    sourceBlock,
  );

  assert.equal(block, null);
});

test('rejects missing legacy alignment ids', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      sourceLang: 'en',
      translatedText: '红色车',
      alignments: [
        {
          sourceStart: 0,
          sourceEnd: 3,
          targetStart: 0,
          targetEnd: 2,
          sourceText: 'red',
        },
      ],
    },
    sourceBlock,
  );

  assert.equal(block, null);
});

test('uses auto source language when no hint is available', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      translatedParts: [{ text: '红色', sourceSpanIds: ['s0'] }],
    },
    sourceBlock,
  );

  assert.equal(block?.sourceLang, 'auto');
});

test('rejects extra block fields in translated-part output', () => {
  const block = sanitizeTranslationResultBlock(
    {
      id: sourceBlock.id,
      sourceLang: 'en',
      translatedParts: [{ text: '红色', sourceSpanIds: ['s0'] }],
    },
    sourceBlock,
    'en',
  );

  assert.equal(block, null);
});

function expectedAlignment(alignmentId, sourceRanges, targetStart, targetEnd, sourceText) {
  return {
    alignmentId,
    sourceRanges: sourceRanges.map(([start, end]) => ({ start, end })),
    targetStart,
    targetEnd,
    sourceText,
  };
}

function legacyAlignment(
  alignmentId,
  sourceStart,
  sourceEnd,
  targetStart,
  targetEnd,
  sourceText,
  targetText,
) {
  const result = {
    alignmentId,
    sourceStart,
    sourceEnd,
    targetStart,
    targetEnd,
    sourceText,
  };
  if (targetText !== undefined) {
    result.targetText = targetText;
  }
  return result;
}

function test(name, callback) {
  callback();
  console.log(`ok - ${name}`);
}
