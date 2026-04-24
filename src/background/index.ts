import { contentRuntimeBootstrap } from '../content/injected';
import type { BackgroundMessage, BackgroundResponse, RuntimeInboundMessage } from '../lib/messages';
import type {
  ExtensionSettings,
  TranslationBlockRequest,
  TranslationRequest,
  TranslationResultBlock,
} from '../lib/types';
import { getSettings, saveSettings } from '../lib/settings';
import { getCachedTranslation, putCachedTranslation, queryWordRecords, recordWordHit } from './db';
import { lookupDictionary } from './dictionary';
import { translateBlocks } from './openai';

const CONTEXT_MENU_ID = 'toggle-dual-line-translation';
const CONTEXT_MENU_DEFAULT_TITLE = '翻译本页';
const CONTEXT_MENU_DISABLE_TITLE = '关闭翻译';
const CONTEXT_MENU_CONFIG_TITLE = '重试（请确认已保存配置）';
const CONTEXT_MENU_UNAVAILABLE_TITLE = '当前页面不可翻译';
const TRANSLATION_CACHE_SCHEMA_VERSION = 'alignment-span-v3-context';
const ENABLED_TABS_STORAGE_KEY = 'enabledTabIds';
const contextMenusApi = chrome.contextMenus as typeof chrome.contextMenus & {
  onShown?: {
    addListener(callback: (info: unknown, tab?: chrome.tabs.Tab) => void): void;
  };
  refresh?: () => void;
};
const enabledTabsStorage = (chrome.storage.session ?? chrome.storage.local) as chrome.storage.StorageArea;
let contextMenuReady = false;
let enabledTabIds = new Set<number>();
let enabledTabIdsLoaded = false;
let enabledTabIdsSaveQueue = Promise.resolve();

chrome.runtime.onInstalled.addListener(() => {
  void ensureContextMenu().catch((error: unknown) => {
    console.error('[metatranslation]', error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  void ensureContextMenu().catch((error: unknown) => {
    console.error('[metatranslation]', error);
  });
});

chrome.action.onClicked.addListener((tab) => {
  void handleActionClick(tab).catch(async (error: unknown) => {
    console.error('[metatranslation]', error);
    if (tab.id) {
      await chrome.action.setBadgeBackgroundColor({
        tabId: tab.id,
        color: '#b42318',
      });
      await chrome.action.setBadgeText({
        tabId: tab.id,
        text: 'ERR',
      });
    }
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab) {
    return;
  }

  void handleActionClick(tab).catch(async (error: unknown) => {
    console.error('[metatranslation]', error);
    if (tab.id) {
      await chrome.action.setBadgeBackgroundColor({
        tabId: tab.id,
        color: '#b42318',
      });
      await chrome.action.setBadgeText({
        tabId: tab.id,
        text: 'ERR',
      });
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void handleTabUpdated(tabId, changeInfo, tab).catch((error: unknown) => {
    console.error('[metatranslation]', error);
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void updateContextMenuForTabId(activeInfo.tabId).catch((error: unknown) => {
    console.error('[metatranslation]', error);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void setTabEnabled(tabId, false).catch((error: unknown) => {
    console.error('[metatranslation]', error);
  });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  void updateContextMenuForFocusedWindow(windowId).catch((error: unknown) => {
    console.error('[metatranslation]', error);
  });
});

contextMenusApi.onShown?.addListener((_info, tab) => {
  void updateContextMenuForTab(tab).catch((error: unknown) => {
    console.error('[metatranslation]', error);
  });
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error: unknown) =>
      sendResponse({
        error: error instanceof Error ? error.message : 'Unknown extension error.',
      }),
    );

  return true;
});

async function handleActionClick(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = tab.id;

  if (!tabId || !tab.url || !/^https?:/i.test(tab.url)) {
    await updateContextMenuForTab(tab);
    return;
  }

  const settings = await getSettings();
  if (!hasUsableSettings(settings)) {
    await chrome.runtime.openOptionsPage();
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: '#b7791f',
    });
    await chrome.action.setBadgeText({
      tabId,
      text: 'CFG',
    });
    await updateContextMenuForTab(tab, false, false);
    return;
  }

  await ensureRuntimeInjected(tabId);
  const response = await sendRuntimeMessage(tabId, { type: 'runtime:toggle' });
  await setTabEnabled(tabId, response.enabled);
  await updateBadge(tabId, response.enabled);
  await updateContextMenuForTab(tab, response.enabled, true);
}

async function handleMessage(
  message: BackgroundMessage,
  _sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  switch (message.type) {
    case 'runtime:ready':
      return { ok: true };
    case 'settings:get':
      return { settings: await getSettings() };
    case 'settings:save':
      return { settings: await saveSettings(message.payload) };
    case 'translation:translate-blocks':
      return translateBlocksWithCache(await getSettings(), message.payload);
    case 'record:hover-hit':
      await recordWordHit(message.payload);
      return { ok: true };
    case 'records:query':
      return {
        records: await queryWordRecords(message.payload),
      };
    case 'dictionary:lookup':
      return lookupDictionary(await getSettings(), message.payload);
    case 'tab:toggle': {
      await ensureRuntimeInjected(message.tabId);
      const response = await sendRuntimeMessage(message.tabId, { type: 'runtime:toggle' });
      await setTabEnabled(message.tabId, response.enabled);
      await updateBadge(message.tabId, response.enabled);
      return response;
    }
    default:
      return assertNever(message);
  }
}

async function handleTabUpdated(
  tabId: number,
  changeInfo: { status?: string },
  tab: chrome.tabs.Tab,
): Promise<void> {
  if (changeInfo.status !== 'loading' || !(await isTabMarkedEnabled(tabId))) {
    return;
  }

  await setTabEnabled(tabId, false);
  await updateBadge(tabId, false);
  if (tab.active && (await isFocusedWindow(tab.windowId))) {
    await updateContextMenuForTab(tab, false);
  }
}

async function isTabMarkedEnabled(tabId: number): Promise<boolean> {
  await loadEnabledTabIds();
  return enabledTabIds.has(tabId);
}

async function setTabEnabled(tabId: number, enabled: boolean): Promise<void> {
  await loadEnabledTabIds();

  if (enabled) {
    enabledTabIds.add(tabId);
  } else {
    enabledTabIds.delete(tabId);
  }

  await persistEnabledTabIds();
}

async function loadEnabledTabIds(): Promise<void> {
  if (enabledTabIdsLoaded) {
    return;
  }

  const stored = await enabledTabsStorage.get(ENABLED_TABS_STORAGE_KEY);
  const value = stored[ENABLED_TABS_STORAGE_KEY];
  enabledTabIds = new Set(
    Array.isArray(value)
      ? value.filter((entry): entry is number => Number.isInteger(entry) && entry > 0)
      : [],
  );
  enabledTabIdsLoaded = true;
}

async function persistEnabledTabIds(): Promise<void> {
  const ids = Array.from(enabledTabIds);
  enabledTabIdsSaveQueue = enabledTabIdsSaveQueue
    .catch(() => undefined)
    .then(() => enabledTabsStorage.set({ [ENABLED_TABS_STORAGE_KEY]: ids }));

  await enabledTabIdsSaveQueue;
}

async function ensureRuntimeInjected(tabId: number): Promise<void> {
  try {
    await sendRuntimeMessage(tabId, { type: 'runtime:ping' });
    return;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: contentRuntimeBootstrap,
    });
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sleep(100);
    try {
      await sendRuntimeMessage(tabId, { type: 'runtime:ping' });
      return;
    } catch {
      continue;
    }
  }

  throw new Error('Failed to initialize content runtime in the current tab.');
}

async function sendRuntimeMessage(
  tabId: number,
  message: RuntimeInboundMessage,
): Promise<{ ok: true; enabled: boolean }> {
  const response = await chrome.tabs.sendMessage(tabId, message);
  if (!response || response.error) {
    throw new Error(response?.error ?? 'Content runtime did not reply.');
  }
  return response as { ok: true; enabled: boolean };
}

async function translateBlocksWithCache(
  settings: ExtensionSettings,
  request: TranslationRequest,
): Promise<BackgroundResponse> {
  const cachedResults = new Map<string, TranslationResultBlock>();
  const uncachedBlocks: TranslationRequest['blocks'] = [];

  for (const block of request.blocks) {
    const cacheKey = await buildTranslationCacheKey(
      settings.baseUrl,
      settings.model,
      settings.tolerantProviderOutput,
      request.sourceLang ?? 'auto',
      request.targetLang,
      block,
    );
    const cached = await getCachedTranslation(cacheKey);

    if (cached) {
      cachedResults.set(block.id, rebaseCachedTranslation(cached, block.id));
      continue;
    }

    uncachedBlocks.push(block);
  }

  if (uncachedBlocks.length > 0) {
    const translated = await translateBlocks(settings, {
      ...request,
      blocks: uncachedBlocks,
    });
    const diagnostics = translated.diagnostics;

    for (const block of translated.blocks) {
      const source = uncachedBlocks.find((entry) => entry.id === block.id);
      if (!source) {
        continue;
      }

      const cacheKey = await buildTranslationCacheKey(
        settings.baseUrl,
        settings.model,
        settings.tolerantProviderOutput,
        request.sourceLang ?? 'auto',
        request.targetLang,
        source,
      );
      cachedResults.set(block.id, block);
      await putCachedTranslation(cacheKey, block);
    }

    return {
      blocks: request.blocks
        .map((block) => cachedResults.get(block.id))
        .filter((block): block is TranslationResultBlock => Boolean(block)),
      diagnostics,
    };
  }

  return {
    blocks: request.blocks
      .map((block) => cachedResults.get(block.id))
      .filter((block): block is TranslationResultBlock => Boolean(block)),
  };
}

function rebaseCachedTranslation(
  cached: TranslationResultBlock,
  blockId: string,
): TranslationResultBlock {
  return {
    ...cached,
    id: blockId,
    alignments: cached.alignments.map((alignment, index) => ({
      ...alignment,
      alignmentId: `${blockId}:${index}`,
    })),
  };
}

async function buildTranslationCacheKey(
  baseUrl: string,
  model: string,
  tolerantProviderOutput: boolean,
  sourceLang: string,
  targetLang: string,
  sourceBlock: Pick<TranslationBlockRequest, 'text' | 'contextBefore' | 'contextAfter'>,
): Promise<string> {
  const cacheInput = JSON.stringify({
    text: sourceBlock.text,
    contextBefore: sourceBlock.contextBefore ?? '',
    contextAfter: sourceBlock.contextAfter ?? '',
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cacheInput));
  const bytes = Array.from(new Uint8Array(digest));
  const hash = bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
  const outputMode = tolerantProviderOutput ? 'tolerant' : 'strict';
  return `${TRANSLATION_CACHE_SCHEMA_VERSION}::${baseUrl}::${model}::${outputMode}::${sourceLang}::${targetLang}::${hash}`;
}

function hasUsableSettings(settings: ExtensionSettings): boolean {
  return Boolean(settings.baseUrl.trim() && settings.apiKey.trim() && settings.model.trim());
}

async function updateBadge(tabId: number, enabled: boolean): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: enabled ? '#1c8f5b' : '#8a9199',
  });
  await chrome.action.setBadgeText({
    tabId,
    text: enabled ? 'ON' : '',
  });
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function assertNever(value: never): never {
  throw new Error(`Unhandled message: ${JSON.stringify(value)}`);
}

async function ensureContextMenu(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: CONTEXT_MENU_DEFAULT_TITLE,
    contexts: ['all'],
  });
  contextMenuReady = true;
}

async function updateContextMenuForTab(
  tab: chrome.tabs.Tab | undefined,
  enabledOverride?: boolean,
  settingsReadyOverride?: boolean,
): Promise<void> {
  if (!contextMenuReady) {
    await ensureContextMenu();
  }
  const state = await getContextMenuState(tab, enabledOverride, settingsReadyOverride);
  await chrome.contextMenus.update(CONTEXT_MENU_ID, state);
  contextMenusApi.refresh?.();
}

async function updateContextMenuForTabId(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  await updateContextMenuForTab(tab);
}

async function updateContextMenuForFocusedWindow(windowId: number): Promise<void> {
  const [tab] = await chrome.tabs.query({
    active: true,
    windowId,
  });
  await updateContextMenuForTab(tab);
}

async function isFocusedWindow(windowId: number | undefined): Promise<boolean> {
  if (typeof windowId !== 'number') {
    return false;
  }

  try {
    const windowInfo = await chrome.windows.get(windowId);
    return Boolean(windowInfo.focused);
  } catch {
    return false;
  }
}

async function getContextMenuState(
  tab: chrome.tabs.Tab | undefined,
  enabledOverride?: boolean,
  settingsReadyOverride?: boolean,
): Promise<{ enabled: boolean; title: string }> {
  if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) {
    return {
      enabled: false,
      title: CONTEXT_MENU_UNAVAILABLE_TITLE,
    };
  }

  const settingsReady =
    typeof settingsReadyOverride === 'boolean'
      ? settingsReadyOverride
      : hasUsableSettings(await getSettings());

  if (!settingsReady) {
    return {
      enabled: true,
      title: CONTEXT_MENU_CONFIG_TITLE,
    };
  }

  const enabled =
    typeof enabledOverride === 'boolean' ? enabledOverride : await isRuntimeEnabled(tab.id);

  return {
    enabled: true,
    title: enabled ? CONTEXT_MENU_DISABLE_TITLE : CONTEXT_MENU_DEFAULT_TITLE,
  };
}

async function isRuntimeEnabled(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'runtime:ping' });
    return Boolean(response?.enabled);
  } catch {
    return false;
  }
}
