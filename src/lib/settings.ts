import { DEFAULT_SETTINGS, type ExtensionSettings } from './types.ts';

const SETTINGS_KEY = 'extensionSettings';

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const value = stored[SETTINGS_KEY];

  return normalizeSettings(isPlainObject(value) ? value : {});
}

export async function saveSettings(settings: ExtensionSettings): Promise<ExtensionSettings> {
  const next = normalizeSettings(settings);

  await chrome.storage.local.set({
    [SETTINGS_KEY]: next,
  });

  return next;
}

export function normalizeSettings(value: Partial<ExtensionSettings> | Record<string, unknown>): ExtensionSettings {
  return {
    baseUrl: normalizeBaseUrl(value.baseUrl, DEFAULT_SETTINGS.baseUrl),
    apiKey: normalizeString(value.apiKey, DEFAULT_SETTINGS.apiKey),
    model: normalizeString(value.model, DEFAULT_SETTINGS.model),
    targetLang: normalizeString(value.targetLang, DEFAULT_SETTINGS.targetLang),
    timeoutMs: normalizePositiveNumber(value.timeoutMs, DEFAULT_SETTINGS.timeoutMs),
    requestChunkSize: normalizeBoundedInteger(value.requestChunkSize, DEFAULT_SETTINGS.requestChunkSize, 10),
    requestConcurrency: normalizeBoundedInteger(value.requestConcurrency, DEFAULT_SETTINGS.requestConcurrency, 64),
    contextWindowChars: normalizeNonNegativeBoundedInteger(
      value.contextWindowChars,
      DEFAULT_SETTINGS.contextWindowChars,
      1000,
    ),
    translationRetryCount: normalizeNonNegativeBoundedInteger(
      value.translationRetryCount,
      DEFAULT_SETTINGS.translationRetryCount,
      10,
    ),
    dictionaryProvider: normalizeDictionaryProvider(value.dictionaryProvider, DEFAULT_SETTINGS.dictionaryProvider),
    dictionaryEdition: DEFAULT_SETTINGS.dictionaryEdition,
    dictionaryHoverHoldMs: normalizeNonNegativeBoundedInteger(
      value.dictionaryHoverHoldMs,
      DEFAULT_SETTINGS.dictionaryHoverHoldMs,
      5000,
    ),
    tolerantProviderOutput: normalizeBoolean(
      value.tolerantProviderOutput,
      DEFAULT_SETTINGS.tolerantProviderOutput,
    ),
    testMode: normalizeBoolean(value.testMode, DEFAULT_SETTINGS.testMode),
  };
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() || fallback : fallback;
}

function normalizeBaseUrl(value: unknown, fallback: string): string {
  const normalized = normalizeString(value, fallback).replace(/\/+$/, '');
  return normalized || fallback.replace(/\/+$/, '');
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeBoundedInteger(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(max, Math.floor(value))
    : fallback;
}

function normalizeNonNegativeBoundedInteger(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(max, Math.floor(value))
    : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeDictionaryProvider(value: unknown, fallback: ExtensionSettings['dictionaryProvider']): ExtensionSettings['dictionaryProvider'] {
  return value === 'off' || value === 'wiktapi' || value === 'freedictionaryapi' ? value : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
