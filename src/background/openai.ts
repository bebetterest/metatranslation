import { sanitizeTranslationResultBlock, type RawTranslationBlockLike } from '../lib/alignment.ts';
import { buildSourceSpans } from '../lib/sourceSpans.ts';
import type {
  ExtensionSettings,
  TranslationBlockRequest,
  TranslationDiagnostics,
  TranslationRequest,
  TranslationResponse,
  TranslationResultBlock,
} from '../lib/types.ts';

const DEFAULT_CHUNK_SIZE = 6;

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

class TranslationOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranslationOutputError';
  }
}

export async function translateBlocks(
  settings: ExtensionSettings,
  request: TranslationRequest,
): Promise<TranslationResponse> {
  const diagnostics = createDiagnostics();
  const retryCount = normalizeRetryCount(settings.translationRetryCount);
  const merged = new Map<string, TranslationResultBlock>();
  let missingBlocks = request.blocks.filter((block) => !merged.has(block.id));
  let attempt = 0;

  while (missingBlocks.length > 0) {
    const isRetry = attempt > 0;
    const isFinalAttempt = attempt === retryCount;
    const pass = await translatePass(
      settings,
      {
        ...request,
        blocks: missingBlocks,
      },
      isRetry && isFinalAttempt,
      isRetry ? 1 : DEFAULT_CHUNK_SIZE,
      diagnostics,
    );

    for (const [id, block] of pass.entries()) {
      merged.set(id, block);
    }

    missingBlocks = request.blocks.filter((block) => !merged.has(block.id));
    if (missingBlocks.length === 0 || attempt >= retryCount) {
      break;
    }
    attempt += 1;
  }

  return {
    blocks: request.blocks
      .map((block) => merged.get(block.id))
      .filter((block): block is TranslationResultBlock => Boolean(block)),
    diagnostics,
  };
}

function isOpenRouterBaseUrl(baseUrl: string): boolean {
  return /openrouter\.ai/i.test(baseUrl);
}

async function translatePass(
  settings: ExtensionSettings,
  request: TranslationRequest,
  strictRetry: boolean,
  chunkSize: number,
  diagnostics: TranslationDiagnostics,
): Promise<Map<string, TranslationResultBlock>> {
  const responseMap = new Map<string, TranslationResultBlock>();
  const chunks = chunkArray(request.blocks, chunkSize);

  for (const chunk of chunks) {
    let rawBlocks: RawTranslationBlockLike[];
    try {
      rawBlocks = await requestTranslationChunk(settings, request, chunk, strictRetry);
    } catch (error) {
      if (error instanceof TranslationOutputError) {
        diagnostics.outputFailures += chunk.length;
        diagnostics.lastOutputError = truncateErrorText(error.message);
        console.warn('[metatranslation]', error);
        continue;
      }

      throw error;
    }

    const matchedRawBlocks = matchRawBlocksToChunk(
      rawBlocks,
      chunk,
      settings.tolerantProviderOutput,
    );
    if (!matchedRawBlocks) {
      diagnostics.outputFailures += chunk.length;
      diagnostics.lastOutputError = 'Translation API returned output blocks with missing, duplicate, or unexpected ids.';
      continue;
    }

    if (matchedRawBlocks.length < chunk.length) {
      diagnostics.outputFailures += chunk.length - matchedRawBlocks.length;
      diagnostics.lastOutputError = 'Translation API returned fewer usable output blocks than requested.';
    }

    for (const { rawBlock, sourceBlock } of matchedRawBlocks) {
      const sanitized = sanitizeTranslationResultBlock(
        rawBlock,
        sourceBlock,
        {
          sourceLangHint: request.sourceLang ?? 'auto',
          tolerantProviderOutput: settings.tolerantProviderOutput,
        },
      );
      if (sanitized) {
        responseMap.set(sanitized.id, sanitized);
      } else {
        diagnostics.outputFailures += 1;
        diagnostics.lastOutputError = 'Translation API returned invalid or empty model output.';
      }
    }
  }

  return responseMap;
}

function normalizeRetryCount(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.min(10, Math.floor(value)) : 2;
}

function matchRawBlocksToChunk(
  rawBlocks: RawTranslationBlockLike[],
  chunk: TranslationBlockRequest[],
  tolerantProviderOutput: boolean,
): Array<{ rawBlock: RawTranslationBlockLike; sourceBlock: TranslationBlockRequest }> | null {
  const sourceById = new Map(chunk.map((sourceBlock) => [sourceBlock.id, sourceBlock]));
  const rawById = new Map<string, RawTranslationBlockLike>();

  for (const rawBlock of rawBlocks) {
    const rawId = getRawBlockId(rawBlock);
    if (!rawId || rawById.has(rawId) || !sourceById.has(rawId)) {
      if (tolerantProviderOutput) {
        continue;
      }
      return null;
    }

    rawById.set(rawId, rawBlock);
  }

  if (!tolerantProviderOutput && rawById.size !== chunk.length) {
    return null;
  }

  if (tolerantProviderOutput && rawById.size !== chunk.length) {
    console.warn(
      `[metatranslation] Translation API returned ${rawById.size} matching blocks for ${chunk.length} input blocks; missing or extra ids were ignored because tolerant provider output is enabled.`,
    );
  }

  return chunk
    .map((sourceBlock) => {
      const rawBlock = rawById.get(sourceBlock.id);
      return rawBlock ? { rawBlock, sourceBlock } : null;
    })
    .filter((entry): entry is { rawBlock: RawTranslationBlockLike; sourceBlock: TranslationBlockRequest } =>
      Boolean(entry),
    );
}

function getRawBlockId(rawBlock: RawTranslationBlockLike): string | null {
  return isPlainObject(rawBlock) && typeof rawBlock.id === 'string' && rawBlock.id
    ? rawBlock.id
    : null;
}

async function requestTranslationChunk(
  settings: ExtensionSettings,
  request: TranslationRequest,
  blocks: TranslationBlockRequest[],
  strictRetry: boolean,
): Promise<RawTranslationBlockLike[]> {
  ensureSettings(settings);

  let lastError: unknown;
  const maxAttempts = normalizeRetryCount(settings.translationRetryCount) + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), settings.timeoutMs);

    try {
      const response = await fetch(resolveChatCompletionsUrl(settings.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
          ...buildProviderHeaders(settings),
        },
        body: JSON.stringify(buildRequestBody(settings, request, blocks, strictRetry)),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (attempt < maxAttempts - 1 && shouldRetryStatus(response.status)) {
          await sleep(250 * (attempt + 1));
          continue;
        }
        const errorText = await readResponseText(response);
        throw new Error(
          `Translation API failed with status ${response.status}${errorText ? `: ${errorText}` : ''}.`,
        );
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const text = extractMessageText(payload);
      const parsed = parseJsonObject(text);

      if (!isPlainObject(parsed) || !Array.isArray(parsed.blocks)) {
        throw new TranslationOutputError('Translation API returned JSON without a blocks array.');
      }

      return parsed.blocks as RawTranslationBlockLike[];
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts - 1 || !shouldRetryError(error)) {
        throw error;
      }
      await sleep(250 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Translation request failed.');
}

function buildRequestBody(
  settings: ExtensionSettings,
  request: TranslationRequest,
  blocks: TranslationBlockRequest[],
  strictRetry: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: settings.model,
    temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'dual_line_translation_response',
        strict: true,
        schema: buildTranslationResponseSchema(),
      },
    },
    reasoning: {
      effort: 'none',
    },
    messages: buildMessages(request, blocks, strictRetry),
  };

  return body;
}

function buildProviderHeaders(settings: ExtensionSettings): Record<string, string> {
  if (!isOpenRouterBaseUrl(settings.baseUrl)) {
    return {};
  }

  return {
    'HTTP-Referer': 'https://codex.local',
    'X-Title': 'metatranslation',
  };
}

function buildMessages(
  request: TranslationRequest,
  blocks: TranslationBlockRequest[],
  strictRetry: boolean,
): Array<{ role: 'system' | 'user'; content: string }> {
  const system = strictRetry
    ? 'You translate source blocks and align translated parts to source spans. Return JSON only. The previous output failed validation.'
    : 'You translate source blocks and align translated parts to source spans. Return JSON only.';

  const user = [
    'Task: translate Payload blocks into the configured target language.',
    `Configured target language: ${describeTargetLanguage(request.targetLang)}`,
    'Output JSON:',
    '{"blocks":[{"id":"block-id","translatedParts":[{"text":"string","sourceSpanIds":["s0"]},{"text":"string"}]}]}',
    'Rules:',
    '1. Return one JSON object only. Each output block must include the same id as one Payload block.',
    '2. Return exactly one output block for each Payload block. Do not split one input block into multiple output blocks.',
    '3. Each output block contains only id and translatedParts. Do not return sourceLang, translatedText, offsets, alignment ids, or extra fields.',
    '4. Join translatedParts[].text to form the full translation. Include punctuation and spaces as text parts. Omit sourceSpanIds for unaligned parts.',
    '5. Use contextBefore/contextAfter only for meaning; translate only text.',
    '6. sourceSpanIds must be arrays of ids from the same block sourceSpans. Do not invent ids, split a span, or use singular sourceSpanId.',
    '7. Use the finest reliable alignment: split translatedParts by source word, term, or short phrase whenever possible. Prefer one sourceSpanId per aligned part when meaning allows; group sourceSpanIds only for phrases, idioms, CJK words, or non-contiguous constructions. Do not align a whole clause or sentence to one part if smaller source spans can be mapped.',
    '8. A translated part may reference adjacent or non-contiguous spans, for example ["s1","s5"]. Each sourceSpanId may appear at most once in the whole output block.',
    '9. Punctuation, spaces, and target-language grammar filler such as 的, 了, 把, 一个, commas, and periods should usually be separate parts without sourceSpanIds. Never attach the same id to both punctuation/filler and a translated word.',
    '10. Every block needs at least one translated part with sourceSpanIds. If text already matches the target language, still align it.',
    'Examples are format examples only. They do not set the target language. For Payload, always use the configured target language above.',
    `Examples: ${JSON.stringify(buildPromptExamples())}`,
    `Page URL: ${request.pageUrl}`,
    `Source language hint: ${request.sourceLang ?? 'auto-detect'}`,
    `Payload: ${JSON.stringify(buildPromptBlocks(blocks))}`,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function describeTargetLanguage(targetLang: string): string {
  const trimmed = targetLang.trim();
  const normalized = trimmed.toLowerCase();
  const descriptions: Record<string, string> = {
    zh: 'Chinese',
    'zh-cn': 'Chinese / Simplified Chinese',
    'zh-hans': 'Chinese / Simplified Chinese',
    'zh-tw': 'Chinese / Traditional Chinese',
    'zh-hant': 'Chinese / Traditional Chinese',
    chinese: 'Chinese',
    中文: 'Chinese',
    ja: 'Japanese',
    'ja-jp': 'Japanese',
    japanese: 'Japanese',
    ko: 'Korean',
    'ko-kr': 'Korean',
    korean: 'Korean',
    en: 'English',
    'en-us': 'English',
    'en-gb': 'English',
    english: 'English',
    fr: 'French',
    'fr-fr': 'French',
    french: 'French',
    de: 'German',
    'de-de': 'German',
    german: 'German',
    es: 'Spanish',
    'es-es': 'Spanish',
    spanish: 'Spanish',
  };
  const description = descriptions[normalized];
  return description ? `${trimmed} (${description})` : trimmed;
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

function shouldRetryError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }

  if (error instanceof Error) {
    return /failed to fetch/i.test(error.message);
  }

  return false;
}

function extractMessageText(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }

  throw new Error('Translation API returned an empty message.');
}

function buildTranslationResponseSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['blocks'],
    properties: {
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'translatedParts'],
          properties: {
            id: { type: 'string', minLength: 1 },
            translatedParts: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['text'],
                properties: {
                  text: { type: 'string' },
                  sourceSpanIds: {
                    type: 'array',
                    minItems: 1,
                    items: { type: 'string', minLength: 1 },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function buildPromptBlocks(blocks: TranslationBlockRequest[]): Array<
  TranslationBlockRequest & {
    sourceSpans: Array<{
      id: string;
      text: string;
    }>;
  }
> {
  return blocks.map((block) => ({
    ...block,
    sourceSpans: buildSourceSpans(block.text).map(({ id, text }) => ({ id, text })),
  }));
}

function buildPromptExamples(): Array<{
  case: string;
  input: {
    id: string;
    text: string;
    contextBefore?: string;
    contextAfter?: string;
    sourceSpans: Array<{ id: string; text: string }>;
  };
  output: {
    id: string;
    translatedParts: Array<{ text: string; sourceSpanIds?: string[] }>;
  };
}> {
  return [
    {
      case: 'basic words plus punctuation',
      input: {
        id: 'ex-1',
        text: 'I like you.',
        sourceSpans: [
          { id: 's0', text: 'I' },
          { id: 's1', text: 'like' },
          { id: 's2', text: 'you' },
        ],
      },
      output: {
        id: 'ex-1',
        translatedParts: [
          { text: '我', sourceSpanIds: ['s0'] },
          { text: '喜欢', sourceSpanIds: ['s1'] },
          { text: '你', sourceSpanIds: ['s2'] },
          { text: '。' },
        ],
      },
    },
    {
      case: 'context guides meaning; context is not translated',
      input: {
        id: 'ex-2',
        contextBefore: 'He deposited cash yesterday.',
        text: 'bank',
        contextAfter: 'The teller smiled.',
        sourceSpans: [{ id: 's0', text: 'bank' }],
      },
      output: {
        id: 'ex-2',
        translatedParts: [{ text: '银行', sourceSpanIds: ['s0'] }],
      },
    },
    {
      case: 'natural target order can differ from source order',
      input: {
        id: 'ex-3',
        text: 'I read books in the library.',
        sourceSpans: [
          { id: 's0', text: 'I' },
          { id: 's1', text: 'read' },
          { id: 's2', text: 'books' },
          { id: 's3', text: 'in' },
          { id: 's4', text: 'the' },
          { id: 's5', text: 'library' },
        ],
      },
      output: {
        id: 'ex-3',
        translatedParts: [
          { text: '我', sourceSpanIds: ['s0'] },
          { text: '在', sourceSpanIds: ['s3'] },
          { text: '图书馆', sourceSpanIds: ['s5'] },
          { text: '读', sourceSpanIds: ['s1'] },
          { text: '书', sourceSpanIds: ['s2'] },
          { text: '。' },
        ],
      },
    },
    {
      case: 'natural repeated target text stays separate by part order',
      input: {
        id: 'ex-4',
        text: 'Tom likes tea and Mary likes coffee.',
        sourceSpans: [
          { id: 's0', text: 'Tom' },
          { id: 's1', text: 'likes' },
          { id: 's2', text: 'tea' },
          { id: 's3', text: 'and' },
          { id: 's4', text: 'Mary' },
          { id: 's5', text: 'likes' },
          { id: 's6', text: 'coffee' },
        ],
      },
      output: {
        id: 'ex-4',
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
    },
    {
      case: 'long sentence uses fine-grained word and term alignment',
      input: {
        id: 'ex-5',
        text: 'I thought the biggest innovation was that it decomposed position analysis as a vision problem.',
        sourceSpans: [
          { id: 's0', text: 'I' },
          { id: 's1', text: 'thought' },
          { id: 's2', text: 'the' },
          { id: 's3', text: 'biggest' },
          { id: 's4', text: 'innovation' },
          { id: 's5', text: 'was' },
          { id: 's6', text: 'that' },
          { id: 's7', text: 'it' },
          { id: 's8', text: 'decomposed' },
          { id: 's9', text: 'position' },
          { id: 's10', text: 'analysis' },
          { id: 's11', text: 'as' },
          { id: 's12', text: 'a' },
          { id: 's13', text: 'vision' },
          { id: 's14', text: 'problem' },
        ],
      },
      output: {
        id: 'ex-5',
        translatedParts: [
          { text: '我', sourceSpanIds: ['s0'] },
          { text: '认为', sourceSpanIds: ['s1'] },
          { text: '最大', sourceSpanIds: ['s3'] },
          { text: '的' },
          { text: '创新', sourceSpanIds: ['s4'] },
          { text: '是', sourceSpanIds: ['s5'] },
          { text: '把' },
          { text: '它', sourceSpanIds: ['s7'] },
          { text: '分解成', sourceSpanIds: ['s8'] },
          { text: '位置', sourceSpanIds: ['s9'] },
          { text: '分析', sourceSpanIds: ['s10'] },
          { text: '作为', sourceSpanIds: ['s11'] },
          { text: '一个' },
          { text: '视觉', sourceSpanIds: ['s13'] },
          { text: '问题', sourceSpanIds: ['s14'] },
          { text: '。' },
        ],
      },
    },
    {
      case: 'function words and punctuation do not reuse source spans',
      input: {
        id: 'ex-6',
        text: 'Vision Banana is a SOTA unified model for both image understanding and generation.',
        sourceSpans: [
          { id: 's0', text: 'Vision' },
          { id: 's1', text: 'Banana' },
          { id: 's2', text: 'is' },
          { id: 's3', text: 'a' },
          { id: 's4', text: 'SOTA' },
          { id: 's5', text: 'unified' },
          { id: 's6', text: 'model' },
          { id: 's7', text: 'for' },
          { id: 's8', text: 'both' },
          { id: 's9', text: 'image' },
          { id: 's10', text: 'understanding' },
          { id: 's11', text: 'and' },
          { id: 's12', text: 'generation' },
        ],
      },
      output: {
        id: 'ex-6',
        translatedParts: [
          { text: 'Vision', sourceSpanIds: ['s0'] },
          { text: ' Banana', sourceSpanIds: ['s1'] },
          { text: '是', sourceSpanIds: ['s2'] },
          { text: '一个' },
          { text: 'SOTA', sourceSpanIds: ['s4'] },
          { text: '统一', sourceSpanIds: ['s5'] },
          { text: '模型', sourceSpanIds: ['s6'] },
          { text: '，' },
          { text: '用于', sourceSpanIds: ['s7'] },
          { text: '图像', sourceSpanIds: ['s9'] },
          { text: '理解', sourceSpanIds: ['s10'] },
          { text: '和', sourceSpanIds: ['s11'] },
          { text: '生成', sourceSpanIds: ['s12'] },
          { text: '。' },
        ],
      },
    },
    {
      case: 'one translated part from non-contiguous source spans',
      input: {
        id: 'ex-7',
        text: 'pick it up',
        sourceSpans: [
          { id: 's0', text: 'pick' },
          { id: 's1', text: 'it' },
          { id: 's2', text: 'up' },
        ],
      },
      output: {
        id: 'ex-7',
        translatedParts: [
          { text: '把' },
          { text: '它', sourceSpanIds: ['s1'] },
          { text: '捡起来', sourceSpanIds: ['s0', 's2'] },
        ],
      },
    },
    {
      case: 'CJK source characters can be grouped',
      input: {
        id: 'ex-8',
        text: '我喜欢你',
        sourceSpans: [
          { id: 's0', text: '我' },
          { id: 's1', text: '喜' },
          { id: 's2', text: '欢' },
          { id: 's3', text: '你' },
        ],
      },
      output: {
        id: 'ex-8',
        translatedParts: [
          { text: 'I', sourceSpanIds: ['s0'] },
          { text: ' ' },
          { text: 'like', sourceSpanIds: ['s1', 's2'] },
          { text: ' ' },
          { text: 'you', sourceSpanIds: ['s3'] },
        ],
      },
    },
  ];
}

function createDiagnostics(): TranslationDiagnostics {
  return {
    outputFailures: 0,
    lastOutputError: '',
  };
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return truncateErrorText(await response.text());
  } catch {
    return '';
  }
}

function truncateErrorText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function parseJsonObject(text: string): unknown {
  const normalized = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '');

  const candidates = buildJsonCandidates(normalized);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  throw new TranslationOutputError('Translation API did not return a parsable JSON object.');
}

function resolveChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function ensureSettings(settings: ExtensionSettings): void {
  if (!settings.baseUrl.trim()) {
    throw new Error('Base URL is required.');
  }
  if (!settings.apiKey.trim()) {
    throw new Error('API key is required.');
  }
  if (!settings.model.trim()) {
    throw new Error('Model is required.');
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildJsonCandidates(text: string): string[] {
  const candidates = new Set<string>();
  const withoutThink = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  if (withoutThink) {
    candidates.add(withoutThink);
  }

  const afterThink = text.split(/<\/think>/i).at(-1)?.trim();
  if (afterThink) {
    candidates.add(afterThink);
  }

  for (const candidate of extractBalancedObjects(withoutThink || text)) {
    candidates.add(candidate);
  }

  for (const candidate of extractBalancedObjects(text)) {
    candidates.add(candidate);
  }

  return Array.from(candidates);
}

function extractBalancedObjects(text: string): string[] {
  const results: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === '}') {
      if (depth === 0) {
        continue;
      }

      depth -= 1;
      if (depth === 0 && start !== -1) {
        results.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return results.reverse();
}
