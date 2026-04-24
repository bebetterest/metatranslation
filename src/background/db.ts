import type {
  RecordHitPayload,
  DictionaryLookupResult,
  RecordsQuery,
  TranslationResultBlock,
  WordEvent,
  WordRecord,
} from '../lib/types';

interface TranslationCacheEntry {
  key: string;
  value: TranslationResultBlock;
  createdAt: number;
}

interface DictionaryCacheEntry {
  key: string;
  value: DictionaryLookupResult;
  createdAt: number;
}

const DATABASE_NAME = 'dual-line-translator-db';
const DATABASE_VERSION = 2;
const STORE_TRANSLATION_CACHE = 'translation_cache';
const STORE_DICTIONARY_CACHE = 'dictionary_cache';
const STORE_WORD_RECORDS = 'word_records';
const STORE_WORD_EVENTS = 'word_events';

let databasePromise: Promise<IDBDatabase> | null = null;

function getDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(STORE_TRANSLATION_CACHE)) {
          database.createObjectStore(STORE_TRANSLATION_CACHE, { keyPath: 'key' });
        }

        if (!database.objectStoreNames.contains(STORE_DICTIONARY_CACHE)) {
          database.createObjectStore(STORE_DICTIONARY_CACHE, { keyPath: 'key' });
        }

        if (!database.objectStoreNames.contains(STORE_WORD_RECORDS)) {
          database.createObjectStore(STORE_WORD_RECORDS, { keyPath: 'key' });
        }

        if (!database.objectStoreNames.contains(STORE_WORD_EVENTS)) {
          const store = database.createObjectStore(STORE_WORD_EVENTS, {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('by_key', 'key', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
    });
  }

  return databasePromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

export async function getCachedTranslation(key: string): Promise<TranslationResultBlock | null> {
  const database = await getDatabase();
  const transaction = database.transaction(STORE_TRANSLATION_CACHE, 'readonly');
  const store = transaction.objectStore(STORE_TRANSLATION_CACHE);
  const entry = await requestToPromise<TranslationCacheEntry | undefined>(store.get(key));
  await transactionDone(transaction);
  return entry?.value ?? null;
}

export async function putCachedTranslation(
  key: string,
  value: TranslationResultBlock,
): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(STORE_TRANSLATION_CACHE, 'readwrite');
  const store = transaction.objectStore(STORE_TRANSLATION_CACHE);
  store.put({
    key,
    value,
    createdAt: Date.now(),
  } satisfies TranslationCacheEntry);
  await transactionDone(transaction);
}

export async function getCachedDictionary(key: string): Promise<DictionaryLookupResult | null> {
  const database = await getDatabase();
  const transaction = database.transaction(STORE_DICTIONARY_CACHE, 'readonly');
  const store = transaction.objectStore(STORE_DICTIONARY_CACHE);
  const entry = await requestToPromise<DictionaryCacheEntry | undefined>(store.get(key));
  await transactionDone(transaction);
  return entry?.value ?? null;
}

export async function putCachedDictionary(
  key: string,
  value: DictionaryLookupResult,
): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(STORE_DICTIONARY_CACHE, 'readwrite');
  const store = transaction.objectStore(STORE_DICTIONARY_CACHE);
  store.put({
    key,
    value,
    createdAt: Date.now(),
  } satisfies DictionaryCacheEntry);
  await transactionDone(transaction);
}

export async function recordWordHit(payload: RecordHitPayload): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction([STORE_WORD_RECORDS, STORE_WORD_EVENTS], 'readwrite');
  const recordsStore = transaction.objectStore(STORE_WORD_RECORDS);
  const eventsStore = transaction.objectStore(STORE_WORD_EVENTS);
  const key = buildWordRecordKey(payload.normalizedWord, payload.sourceLang, payload.targetLang);

  const current = await requestToPromise<WordRecord | undefined>(recordsStore.get(key));
  const next: WordRecord = current
    ? {
        ...current,
        sourceWord: payload.sourceWord,
        count: current.count + 1,
        lastSeenAt: payload.timestamp,
        lastUrl: payload.pageUrl,
        lastSourceSentence: payload.sourceSentence,
        lastTranslatedSentence: payload.translatedSentence,
      }
    : {
        key,
        normalizedWord: payload.normalizedWord,
        sourceWord: payload.sourceWord,
        sourceLang: payload.sourceLang,
        targetLang: payload.targetLang,
        count: 1,
        firstSeenAt: payload.timestamp,
        lastSeenAt: payload.timestamp,
        lastUrl: payload.pageUrl,
        lastSourceSentence: payload.sourceSentence,
        lastTranslatedSentence: payload.translatedSentence,
      };

  recordsStore.put(next);
  eventsStore.add({
    key,
    normalizedWord: payload.normalizedWord,
    sourceWord: payload.sourceWord,
    sourceLang: payload.sourceLang,
    targetLang: payload.targetLang,
    pageUrl: payload.pageUrl,
    sourceSentence: payload.sourceSentence,
    translatedSentence: payload.translatedSentence,
    timestamp: payload.timestamp,
  } satisfies WordEvent);

  await transactionDone(transaction);
}

export async function queryWordRecords(query: RecordsQuery): Promise<WordRecord[]> {
  const database = await getDatabase();
  const transaction = database.transaction(STORE_WORD_RECORDS, 'readonly');
  const store = transaction.objectStore(STORE_WORD_RECORDS);
  const records = await requestToPromise<WordRecord[]>(store.getAll());
  await transactionDone(transaction);

  const needle = query.search.trim().toLowerCase();
  const filtered = needle
    ? records.filter((record) =>
        [
          record.normalizedWord,
          record.sourceWord,
          record.sourceLang,
          record.targetLang,
          record.lastUrl,
          record.lastSourceSentence,
          record.lastTranslatedSentence,
        ]
          .join('\n')
          .toLowerCase()
          .includes(needle),
      )
    : records;

  return filtered.sort((left, right) => {
    if (query.sort === 'frequency') {
      return right.count - left.count || right.lastSeenAt - left.lastSeenAt;
    }

    return right.lastSeenAt - left.lastSeenAt || right.count - left.count;
  });
}

function buildWordRecordKey(normalizedWord: string, sourceLang: string, targetLang: string): string {
  return `${normalizedWord}::${sourceLang}::${targetLang}`;
}
