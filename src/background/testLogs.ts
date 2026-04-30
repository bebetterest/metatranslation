import type {
  ExtensionSettings,
  TestLogAddPayload,
  TestLogEntry,
  TestLogLevel,
  TestLogSource,
} from '../lib/types.ts';

export const TEST_LOG_LIMIT = 500;

const TEST_LOGS_STORAGE_KEY = 'testLogs';
const MAX_EVENT_LENGTH = 120;
const MAX_URL_LENGTH = 1500;
const MAX_STRING_LENGTH = 1200;
const MAX_ARRAY_ITEMS = 40;
const MAX_OBJECT_KEYS = 60;
const MAX_DEPTH = 4;
const REDACTED = '[redacted]';

let appendQueue = Promise.resolve();

export async function appendTestLogForSettings(
  settings: Pick<ExtensionSettings, 'testMode'>,
  payload: TestLogAddPayload,
): Promise<void> {
  if (!settings.testMode) {
    return;
  }

  try {
    await appendTestLog(payload);
  } catch (error) {
    console.warn('[metatranslation] Failed to write test log.', error);
  }
}

export async function appendTestLog(payload: TestLogAddPayload): Promise<void> {
  if (!hasChromeStorage()) {
    return;
  }

  const entry = buildTestLogEntry(payload);
  appendQueue = appendQueue
    .catch(() => undefined)
    .then(async () => {
      const stored = await chrome.storage.local.get(TEST_LOGS_STORAGE_KEY);
      const logs = normalizeStoredTestLogs(stored[TEST_LOGS_STORAGE_KEY]);
      await chrome.storage.local.set({
        [TEST_LOGS_STORAGE_KEY]: appendTestLogEntry(logs, entry),
      });
    });

  await appendQueue;
}

export async function queryTestLogs(): Promise<TestLogEntry[]> {
  if (!hasChromeStorage()) {
    return [];
  }

  const stored = await chrome.storage.local.get(TEST_LOGS_STORAGE_KEY);
  return normalizeStoredTestLogs(stored[TEST_LOGS_STORAGE_KEY]);
}

export async function clearTestLogs(): Promise<void> {
  if (!hasChromeStorage()) {
    return;
  }

  appendQueue = appendQueue
    .catch(() => undefined)
    .then(() => chrome.storage.local.remove(TEST_LOGS_STORAGE_KEY));

  await appendQueue;
}

export function appendTestLogEntry(
  logs: TestLogEntry[],
  entry: TestLogEntry,
  limit = TEST_LOG_LIMIT,
): TestLogEntry[] {
  return [...logs, entry].slice(-normalizeLogLimit(limit));
}

export function buildTestLogEntry(payload: TestLogAddPayload, timestamp = Date.now()): TestLogEntry {
  return {
    id: createLogId(timestamp),
    timestamp,
    level: normalizeTestLogLevel(payload.level),
    source: normalizeTestLogSource(payload.source),
    event: truncateString(String(payload.event || 'event'), MAX_EVENT_LENGTH),
    pageUrl: redactString(truncateString(payload.pageUrl ?? '', MAX_URL_LENGTH)),
    details: sanitizeDetails(payload.details),
  };
}

function normalizeStoredTestLogs(value: unknown): TestLogEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isStoredTestLogEntry)
    .map((entry) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      level: normalizeTestLogLevel(entry.level),
      source: normalizeTestLogSource(entry.source),
      event: truncateString(entry.event, MAX_EVENT_LENGTH),
      pageUrl: redactString(truncateString(entry.pageUrl, MAX_URL_LENGTH)),
      details: sanitizeDetails(entry.details),
    }))
    .slice(-TEST_LOG_LIMIT);
}

function isStoredTestLogEntry(value: unknown): value is TestLogEntry {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.timestamp === 'number' &&
    Number.isFinite(value.timestamp) &&
    typeof value.level === 'string' &&
    typeof value.source === 'string' &&
    typeof value.event === 'string' &&
    typeof value.pageUrl === 'string' &&
    isPlainObject(value.details)
  );
}

function normalizeTestLogLevel(value: unknown): TestLogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
    ? value
    : 'info';
}

function normalizeTestLogSource(value: unknown): TestLogSource {
  return value === 'background' || value === 'content' ? value : 'background';
}

function normalizeLogLimit(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : TEST_LOG_LIMIT;
}

function sanitizeDetails(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    return {};
  }

  const sanitized = sanitizeValue(value, 0);
  return isPlainObject(sanitized) ? sanitized : {};
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === 'string') {
    return redactString(truncateString(value, MAX_STRING_LENGTH));
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) {
      return '[array]';
    }

    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
  }

  if (isPlainObject(value)) {
    if (depth >= MAX_DEPTH) {
      return '[object]';
    }

    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      result[truncateString(key, MAX_EVENT_LENGTH)] = isSensitiveKey(key)
        ? REDACTED
        : sanitizeValue(entryValue, depth + 1);
    }
    return result;
  }

  return String(value);
}

function isSensitiveKey(key: string): boolean {
  return /(api[-_ ]?key|authorization|bearer|token|secret|password)/i.test(key);
}

function redactString(value: string): string {
  return value
    .replace(
      /([?&][^=&#]*(?:api[-_ ]?key|authorization|auth|bearer|token|secret|password)[^=&#]*=)[^&#]*/gi,
      '$1[redacted]',
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[redacted]');
}

function truncateString(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function createLogId(timestamp: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${timestamp}-${Math.random().toString(36).slice(2)}`;
}

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
