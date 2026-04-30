import './style.css';

import { escapeCsvCell } from '../lib/csv.ts';
import type {
  ErrorResponse,
  RecordsQueryResponse,
  SettingsGetResponse,
  SettingsSaveResponse,
  TestLogsQueryResponse,
} from '../lib/messages';
import { getUiLocale, getUiMessage } from '../lib/i18n';
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type RecordSortMode,
  type RecordsExportRow,
  type TestLogEntry,
  type WordRecord,
} from '../lib/types';

const settingsForm = getElement<HTMLFormElement>('settings-form');
const searchInput = getElement<HTMLInputElement>('search');
const sortSelect = getElement<HTMLSelectElement>('sort');
const refreshButton = getElement<HTMLButtonElement>('refresh');
const exportButton = getElement<HTMLButtonElement>('export');
const recordsBody = getElement<HTMLTableSectionElement>('records-body');
const settingsStatus = getElement<HTMLDivElement>('settings-status');
const recordsStatus = getElement<HTMLSpanElement>('records-status');
const recordCount = getElement<HTMLSpanElement>('record-count');
const testLogsStatus = getElement<HTMLSpanElement>('test-logs-status');
const testLogCount = getElement<HTMLSpanElement>('test-log-count');
const testLogsBody = getElement<HTMLTableSectionElement>('test-logs-body');
const refreshTestLogsButton = getElement<HTMLButtonElement>('refresh-test-logs');
const exportTestLogsButton = getElement<HTMLButtonElement>('export-test-logs');
const clearTestLogsButton = getElement<HTMLButtonElement>('clear-test-logs');

const baseUrlInput = getElement<HTMLInputElement>('base-url');
const apiKeyInput = getElement<HTMLInputElement>('api-key');
const modelInput = getElement<HTMLInputElement>('model');
const targetLangInput = getElement<HTMLInputElement>('target-lang');
const timeoutInput = getElement<HTMLInputElement>('timeout-ms');
const requestChunkSizeInput = getElement<HTMLInputElement>('request-chunk-size');
const requestConcurrencyInput = getElement<HTMLInputElement>('request-concurrency');
const contextWindowCharsInput = getElement<HTMLInputElement>('context-window-chars');
const translationRetryCountInput = getElement<HTMLInputElement>('translation-retry-count');
const tolerantProviderOutputInput = getElement<HTMLInputElement>('tolerant-provider-output');
const testModeInput = getElement<HTMLInputElement>('test-mode');
const dictionaryProviderInput = getElement<HTMLSelectElement>('dictionary-provider');
const dictionaryHoverHoldMsInput = getElement<HTMLInputElement>('dictionary-hover-hold-ms');

const uiLocale = getUiLocale();
const dateFormatter = new Intl.DateTimeFormat(uiLocale, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const logDateFormatter = new Intl.DateTimeFormat(uiLocale, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

let currentRecords: WordRecord[] = [];
let currentTestLogs: TestLogEntry[] = [];
let searchTimer: number | null = null;

void initialize();

async function initialize(): Promise<void> {
  applyLocalizedText();
  await loadSettings();
  await loadTestLogs();
  await loadRecords();

  settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveSettings();
  });

  searchInput.addEventListener('input', () => {
    if (searchTimer !== null) {
      window.clearTimeout(searchTimer);
    }
    searchTimer = window.setTimeout(() => {
      void loadRecords();
    }, 180);
  });

  sortSelect.addEventListener('change', () => {
    void loadRecords();
  });

  refreshButton.addEventListener('click', () => {
    void loadRecords();
  });

  exportButton.addEventListener('click', () => {
    exportCsv(currentRecords);
  });

  refreshTestLogsButton.addEventListener('click', () => {
    void loadTestLogs();
  });

  exportTestLogsButton.addEventListener('click', () => {
    exportTestLogs(currentTestLogs);
  });

  clearTestLogsButton.addEventListener('click', () => {
    void clearTestLogs();
  });
}

async function loadSettings(): Promise<void> {
  setText(settingsStatus, getUiMessage('settingsLoading'));

  try {
    const response = await sendMessage<SettingsGetResponse>({
      type: 'settings:get',
    });

    fillSettings(response.settings);
    setText(settingsStatus, '');
  } catch (error) {
    setText(settingsStatus, getErrorMessage(error));
  }
}

async function saveSettings(): Promise<void> {
  setText(settingsStatus, getUiMessage('settingsSaving'));

  try {
    const settings: ExtensionSettings = {
      baseUrl: baseUrlInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim(),
      targetLang: targetLangInput.value.trim(),
      timeoutMs: Number(timeoutInput.value),
      requestChunkSize: Number(requestChunkSizeInput.value),
      requestConcurrency: Number(requestConcurrencyInput.value),
      contextWindowChars: Number(contextWindowCharsInput.value),
      translationRetryCount: Number(translationRetryCountInput.value),
      dictionaryProvider: dictionaryProviderInput.value as ExtensionSettings['dictionaryProvider'],
      dictionaryEdition: DEFAULT_SETTINGS.dictionaryEdition,
      dictionaryHoverHoldMs: Number(dictionaryHoverHoldMsInput.value),
      tolerantProviderOutput: tolerantProviderOutputInput.checked,
      testMode: testModeInput.checked,
    };

    const response = await sendMessage<SettingsSaveResponse>({
      type: 'settings:save',
      payload: settings,
    });

    fillSettings(response.settings);
    await loadTestLogs();
    setText(settingsStatus, getUiMessage('settingsSaved'));
  } catch (error) {
    setText(settingsStatus, getErrorMessage(error));
  }
}

async function loadRecords(): Promise<void> {
  setText(recordsStatus, getUiMessage('recordsLoading'));

  try {
    const response = await sendMessage<RecordsQueryResponse>({
      type: 'records:query',
      payload: {
        search: searchInput.value,
        sort: sortSelect.value as RecordSortMode,
      },
    });

    currentRecords = response.records;
    renderRecords(response.records);
    setText(recordsStatus, '');
  } catch (error) {
    setText(recordsStatus, getErrorMessage(error));
  }
}

async function loadTestLogs(): Promise<void> {
  setText(testLogsStatus, getUiMessage('testLogsLoading'));

  try {
    const response = await sendMessage<TestLogsQueryResponse>({
      type: 'test-logs:query',
    });

    currentTestLogs = response.logs;
    renderTestLogs(response.logs);
    setText(testLogsStatus, '');
  } catch (error) {
    setText(testLogsStatus, getErrorMessage(error));
  }
}

function fillSettings(settings: ExtensionSettings): void {
  baseUrlInput.value = settings.baseUrl;
  apiKeyInput.value = settings.apiKey;
  modelInput.value = settings.model;
  targetLangInput.value = settings.targetLang;
  timeoutInput.value = String(settings.timeoutMs);
  requestChunkSizeInput.value = String(settings.requestChunkSize);
  requestConcurrencyInput.value = String(settings.requestConcurrency);
  contextWindowCharsInput.value = String(settings.contextWindowChars);
  translationRetryCountInput.value = String(settings.translationRetryCount);
  dictionaryProviderInput.value = settings.dictionaryProvider;
  dictionaryHoverHoldMsInput.value = String(settings.dictionaryHoverHoldMs);
  tolerantProviderOutputInput.checked = settings.tolerantProviderOutput;
  testModeInput.checked = settings.testMode;
}

function renderTestLogs(logs: TestLogEntry[]): void {
  testLogCount.textContent = getUiMessage('testLogCount', String(logs.length));
  testLogsBody.replaceChildren();

  if (logs.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'empty';
    cell.textContent = getUiMessage('testLogsEmpty');
    row.append(cell);
    testLogsBody.append(row);
    return;
  }

  for (const log of logs.slice().reverse()) {
    const row = document.createElement('tr');
    row.append(
      buildCell(logDateFormatter.format(new Date(log.timestamp)), 'cell-muted'),
      buildCell(log.level.toUpperCase(), `cell-log-level cell-log-${log.level}`),
      buildCell(log.source, 'cell-muted'),
      buildCell(log.event, 'cell-word'),
      buildDetailsCell(log),
    );
    testLogsBody.append(row);
  }
}

function renderRecords(records: WordRecord[]): void {
  recordCount.textContent = getUiMessage('recordCount', String(records.length));
  recordsBody.replaceChildren();

  if (records.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 7;
    cell.className = 'empty';
    cell.textContent = getUiMessage('recordsEmpty');
    row.append(cell);
    recordsBody.append(row);
    return;
  }

  for (const record of records) {
    const row = document.createElement('tr');

    row.append(
      buildCell(record.sourceWord || record.normalizedWord, 'cell-word'),
      buildCell(String(record.count)),
      buildCell(`${record.sourceLang} → ${record.targetLang}`, 'cell-muted'),
      buildCell(formatDate(record.lastSeenAt), 'cell-muted'),
      buildCell(record.lastUrl, 'cell-url'),
      buildCell(record.lastSourceSentence, 'cell-sentence'),
      buildCell(record.lastTranslatedSentence, 'cell-sentence'),
    );

    recordsBody.append(row);
  }
}

function buildCell(content: string, className = ''): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.textContent = content;
  if (className) {
    cell.className = className;
  }
  return cell;
}

function buildDetailsCell(log: TestLogEntry): HTMLTableCellElement {
  const cell = document.createElement('td');
  const page = document.createElement('div');
  page.className = 'cell-url';
  page.textContent = log.pageUrl;

  const details = document.createElement('pre');
  details.className = 'log-details';
  details.textContent = JSON.stringify(log.details, null, 2);

  if (log.pageUrl) {
    cell.append(page);
  }
  cell.append(details);
  return cell;
}

function exportCsv(records: WordRecord[]): void {
  if (records.length === 0) {
    setText(recordsStatus, getUiMessage('recordsExportEmpty'));
    return;
  }

  const rows: RecordsExportRow[] = records.map((record) => ({
    word: record.sourceWord || record.normalizedWord,
    count: record.count,
    sourceLang: record.sourceLang,
    targetLang: record.targetLang,
    lastSeenAt: record.lastSeenAt,
    lastUrl: record.lastUrl,
    sourceSentence: record.lastSourceSentence,
    translatedSentence: record.lastTranslatedSentence,
  }));

  const header = [
    'Word',
    'Count',
    'SourceLang',
    'TargetLang',
    'LastSeenAt',
    'URL',
    'SourceSentence',
    'Translation',
  ];

  const csv = [
    header.join(','),
    ...rows.map((row) =>
      [
        row.word,
        row.count,
        row.sourceLang,
        row.targetLang,
        formatDate(row.lastSeenAt),
        row.lastUrl,
        row.sourceSentence,
        row.translatedSentence,
      ]
        .map(escapeCsvCell)
        .join(','),
    ),
  ].join('\n');

  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `word-records-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  setText(recordsStatus, getUiMessage('recordsExported'));
}

function exportTestLogs(logs: TestLogEntry[]): void {
  if (logs.length === 0) {
    setText(testLogsStatus, getUiMessage('testLogsExportEmpty'));
    return;
  }

  const blob = new Blob([JSON.stringify(logs, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `metatranslation-test-logs-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  setText(testLogsStatus, getUiMessage('testLogsExported'));
}

async function clearTestLogs(): Promise<void> {
  setText(testLogsStatus, getUiMessage('testLogsClearing'));

  try {
    await sendMessage<{ ok: true }>({
      type: 'test-logs:clear',
    });
    currentTestLogs = [];
    renderTestLogs(currentTestLogs);
    setText(testLogsStatus, getUiMessage('testLogsCleared'));
  } catch (error) {
    setText(testLogsStatus, getErrorMessage(error));
  }
}

function applyLocalizedText(): void {
  document.documentElement.lang = uiLocale;
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = element.dataset.i18n;
    if (key) {
      setText(element, getUiMessage(key));
    }
  }

  for (const element of document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
    const key = element.dataset.i18nPlaceholder;
    if (key) {
      element.placeholder = getUiMessage(key);
    }
  }

  recordCount.textContent = getUiMessage('recordCount', '0');
  testLogCount.textContent = getUiMessage('testLogCount', '0');
}

async function sendMessage<T>(message: object): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as T & ErrorResponse;
  if (response && 'error' in response && typeof response.error === 'string') {
    throw new Error(response.error);
  }
  return response;
}

function formatDate(timestamp: number): string {
  return dateFormatter.format(new Date(timestamp));
}

function setText(element: HTMLElement, value: string): void {
  element.textContent = value;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : getUiMessage('unknownError');
}

function getElement<TElement extends HTMLElement>(id: string): TElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as TElement;
}
