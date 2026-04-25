export interface ExtensionSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  targetLang: string;
  timeoutMs: number;
  requestChunkSize: number;
  requestConcurrency: number;
  contextWindowChars: number;
  translationRetryCount: number;
  dictionaryProvider: DictionaryProvider;
  dictionaryEdition: string;
  dictionaryHoverHoldMs: number;
  tolerantProviderOutput: boolean;
}

export type DictionaryProvider = 'off' | 'wiktapi' | 'freedictionaryapi';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: '',
  model: 'x-ai/grok-4.1-fast',
  targetLang: 'zh-CN',
  timeoutMs: 30000,
  requestChunkSize: 1,
  requestConcurrency: 64,
  contextWindowChars: 100,
  translationRetryCount: 2,
  dictionaryProvider: 'wiktapi',
  dictionaryEdition: 'en',
  dictionaryHoverHoldMs: 1000,
  tolerantProviderOutput: true,
};

export interface TranslationBlockRequest {
  id: string;
  text: string;
  contextBefore?: string;
  contextAfter?: string;
}

export interface TranslationRequest {
  targetLang: string;
  pageUrl: string;
  sourceLang?: string;
  blocks: TranslationBlockRequest[];
}

export interface TextRange {
  start: number;
  end: number;
}

export interface AlignmentSpan {
  alignmentId: string;
  sourceRanges: TextRange[];
  targetStart: number;
  targetEnd: number;
  sourceText: string;
}

export interface TranslationResultBlock {
  id: string;
  sourceLang: string;
  translatedText: string;
  alignments: AlignmentSpan[];
}

export interface TranslationResponse {
  blocks: TranslationResultBlock[];
  diagnostics?: TranslationDiagnostics;
}

export type TranslationDiagnosticFailureReason =
  | 'parse_error'
  | 'missing_blocks_array'
  | 'missing_output_id'
  | 'duplicate_output_id'
  | 'unexpected_output_id'
  | 'missing_output_block'
  | 'invalid_output_block';

export type TranslationDiagnosticFailureCounts = Partial<Record<TranslationDiagnosticFailureReason, number>>;

export interface AlignmentCoverageDiagnostics {
  acceptedBlocks: number;
  alignedBlocks: number;
  unalignedBlocks: number;
  sourceSpansTotal: number;
  sourceSpansAligned: number;
  sourceSpanCoverage: number;
  targetCharsTotal: number;
  targetCharsAligned: number;
  targetCharCoverage: number;
}

export interface TranslationDiagnostics {
  outputFailures: number;
  lastOutputError: string;
  failureCounts: TranslationDiagnosticFailureCounts;
  alignmentCoverage: AlignmentCoverageDiagnostics;
}

export interface DictionaryLookupRequest {
  word: string;
  sourceLang: string;
  targetLang: string;
}

export interface DictionaryEntry {
  provider: Exclude<DictionaryProvider, 'off'>;
  word: string;
  sourceLang: string;
  partOfSpeech: string;
  pronunciations: string[];
  definitions: string[];
  examples: string[];
  translations: string[];
  sourceUrl: string;
  license: string;
}

export interface DictionaryLookupResult {
  provider: DictionaryProvider;
  word: string;
  normalizedWord: string;
  sourceLang: string;
  targetLang: string;
  entries: DictionaryEntry[];
  sourceUrl: string;
  attribution: string;
  fetchedAt: number;
}

export interface RecordHitPayload {
  normalizedWord: string;
  sourceWord: string;
  sourceLang: string;
  targetLang: string;
  pageUrl: string;
  sourceSentence: string;
  translatedSentence: string;
  timestamp: number;
}

export interface WordRecord {
  key: string;
  normalizedWord: string;
  sourceWord: string;
  sourceLang: string;
  targetLang: string;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastUrl: string;
  lastSourceSentence: string;
  lastTranslatedSentence: string;
}

export interface WordEvent {
  id?: number;
  key: string;
  normalizedWord: string;
  sourceWord: string;
  sourceLang: string;
  targetLang: string;
  pageUrl: string;
  sourceSentence: string;
  translatedSentence: string;
  timestamp: number;
}

export type RecordSortMode = 'recent' | 'frequency';

export interface RecordsQuery {
  search: string;
  sort: RecordSortMode;
}

export interface RecordsQueryResult {
  records: WordRecord[];
}

export interface RecordsExportRow {
  word: string;
  count: number;
  sourceLang: string;
  targetLang: string;
  lastSeenAt: number;
  lastUrl: string;
  sourceSentence: string;
  translatedSentence: string;
}
