import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';

class CDPClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  open() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('Failed to connect to DevTools.')));
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (!message.id || !this.pending.has(message.id)) {
          return;
        }

        const pendingEntry = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          pendingEntry.reject(new Error(message.error.message));
          return;
        }
        pendingEntry.resolve(message.result);
      });
    });
  }

  send(method, params = {}) {
    if (!this.socket) {
      throw new Error('DevTools socket is not open.');
    }

    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, extra = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      ...extra,
    });
    return result.result?.value;
  }

  async close() {
    this.socket?.close();
    this.socket = null;
  }
}

const browserPath = process.env.BROWSER_BIN;
const pageUrl = process.env.PAGE_SMOKE_URL;
const browserDebugPort = Number(process.env.PAGE_SMOKE_PORT ?? (await getOpenPort()));
const screenshotDir = path.resolve(process.env.PAGE_SMOKE_SCREENSHOT_DIR ?? 'artifacts/e2e-page');
const extensionDir = path.resolve('dist');
const providerMode = process.env.PAGE_SMOKE_PROVIDER ?? 'mock';
const useMockProvider = providerMode !== 'real';
const mockPort = useMockProvider ? await getOpenPort() : null;
const providerSettings = {
  baseUrl: useMockProvider
    ? `http://127.0.0.1:${mockPort}/v1`
    : process.env.PAGE_SMOKE_BASE_URL ?? process.env.REAL_TEST_BASE_URL ?? 'https://openrouter.ai/api/v1',
  apiKey: useMockProvider ? 'mock-key' : process.env.PAGE_SMOKE_KEY ?? process.env.REAL_TEST_KEY ?? '',
  model: useMockProvider
    ? 'mock-model'
    : process.env.PAGE_SMOKE_MODEL ?? process.env.REAL_TEST_MODEL ?? 'x-ai/grok-4.1-fast',
  targetLang: process.env.PAGE_SMOKE_TARGET_LANG ?? process.env.REAL_TEST_TARGET_LANG ?? 'zh-CN',
  timeoutMs: Number(process.env.PAGE_SMOKE_TIMEOUT_MS ?? 120000),
  requestChunkSize: Number(
    process.env.PAGE_SMOKE_REQUEST_CHUNK_SIZE ?? (useMockProvider ? 8 : 1),
  ),
  requestConcurrency: Number(
    process.env.PAGE_SMOKE_REQUEST_CONCURRENCY ?? 64,
  ),
  contextWindowChars: Number(process.env.PAGE_SMOKE_CONTEXT_WINDOW_CHARS ?? 100),
  translationRetryCount: Number(process.env.PAGE_SMOKE_TRANSLATION_RETRY_COUNT ?? 2),
  dictionaryProvider: process.env.PAGE_SMOKE_DICTIONARY_PROVIDER ?? 'wiktapi',
  dictionaryEdition: process.env.PAGE_SMOKE_DICTIONARY_EDITION ?? 'en',
  dictionaryHoverHoldMs: Number(process.env.PAGE_SMOKE_DICTIONARY_HOVER_HOLD_MS ?? 1000),
  tolerantProviderOutput: process.env.PAGE_SMOKE_TOLERANT_PROVIDER_OUTPUT === '1',
};

if (!browserPath) {
  console.error('Missing BROWSER_BIN.');
  process.exit(1);
}

if (!pageUrl) {
  console.error('Missing PAGE_SMOKE_URL.');
  process.exit(1);
}

if (!useMockProvider && !providerSettings.apiKey) {
  console.error('Missing PAGE_SMOKE_KEY or REAL_TEST_KEY for real provider mode.');
  process.exit(1);
}

const mockServer = useMockProvider
  ? spawn(process.execPath, [path.resolve('scripts/mock-translation-server.mjs')], {
      env: {
        ...process.env,
        MOCK_TRANSLATION_PORT: String(mockPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  : null;

mockServer?.stdout.on('data', (chunk) => process.stdout.write(chunk));
mockServer?.stderr.on('data', (chunk) => process.stderr.write(chunk));

const profileDir = await mkdtemp(path.join(os.tmpdir(), 'dlt-page-smoke-'));
let browser = null;

try {
  if (mockServer && mockPort !== null) {
    await waitForMockServer(mockServer, mockPort);
  }

  browser = spawn(
    browserPath,
    [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${browserDebugPort}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  browser.stdout.on('data', (chunk) => process.stdout.write(chunk));
  browser.stderr.on('data', (chunk) => process.stderr.write(chunk));

  await waitForDevtools(browserDebugPort, 10000);
  const extension = await waitForExtensionRegistration(browserDebugPort, 10000);
  if (!extension) {
    throw new Error('Extension did not register in Chrome for Testing.');
  }

  console.log(`[page-smoke] extension registered: ${extension.id} (${extension.target.url})`);
  console.log(
    `[page-smoke] provider mode: ${providerMode}; baseUrl=${redactBaseUrl(providerSettings.baseUrl)}; model=${providerSettings.model}; chunk=${providerSettings.requestChunkSize}; concurrency=${providerSettings.requestConcurrency}`,
  );

  const optionsTarget = await openTarget(
    browserDebugPort,
    `chrome-extension://${extension.id}/src/options/index.html`,
  );
  const optionsClient = new CDPClient(optionsTarget.webSocketDebuggerUrl);
  const optionsUrl = `chrome-extension://${extension.id}/src/options/index.html`;
  await optionsClient.open();
  await optionsClient.send('Runtime.enable');
  await optionsClient.send('Page.enable');
  await optionsClient.send('Page.navigate', { url: optionsUrl });
  await waitForPageReady(optionsClient, 10000);
  const optionsDiagnostics = parseMaybeJson(
    await optionsClient.evaluate(`
      JSON.stringify({
        href: location.href,
        hasChrome: typeof chrome !== 'undefined',
        chromeKeys: typeof chrome === 'undefined' ? [] : Object.keys(chrome).sort()
      })
    `),
  );
  console.log(`[page-smoke] options diagnostics: ${JSON.stringify(optionsDiagnostics)}`);
  await optionsClient.evaluate(`
    chrome.storage.local.set({
      extensionSettings: {
        baseUrl: ${JSON.stringify(providerSettings.baseUrl)},
        apiKey: ${JSON.stringify(providerSettings.apiKey)},
        model: ${JSON.stringify(providerSettings.model)},
        targetLang: ${JSON.stringify(providerSettings.targetLang)},
        timeoutMs: ${JSON.stringify(providerSettings.timeoutMs)},
        requestChunkSize: ${JSON.stringify(providerSettings.requestChunkSize)},
        requestConcurrency: ${JSON.stringify(providerSettings.requestConcurrency)},
        contextWindowChars: ${JSON.stringify(providerSettings.contextWindowChars)},
        translationRetryCount: ${JSON.stringify(providerSettings.translationRetryCount)},
        dictionaryProvider: ${JSON.stringify(providerSettings.dictionaryProvider)},
        dictionaryEdition: ${JSON.stringify(providerSettings.dictionaryEdition)},
        dictionaryHoverHoldMs: ${JSON.stringify(providerSettings.dictionaryHoverHoldMs)},
        tolerantProviderOutput: ${JSON.stringify(providerSettings.tolerantProviderOutput)}
      }
    })
  `);

  const pageTarget = await openTarget(browserDebugPort, pageUrl);
  const pageClient = new CDPClient(pageTarget.webSocketDebuggerUrl);
  await pageClient.open();
  await pageClient.send('Runtime.enable');
  await pageClient.send('Page.enable');
  await pageClient.send('Page.navigate', { url: pageUrl });
  await pageClient.send('Page.bringToFront');
  await pageClient.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1200,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await waitForPageReady(pageClient, 20000);
  await sleep(Number(process.env.PAGE_SMOKE_SETTLE_MS ?? 5000));

  const before = await collectDiagnostics(pageClient);
  console.log(`[page-smoke] before toggle: ${JSON.stringify(before)}`);

  const pageUrlPattern = `${new URL(pageUrl).origin}${new URL(pageUrl).pathname}*`;
  const injectionState = parseMaybeJson(
    await optionsClient.evaluate(`
      (async () => {
        try {
          const matchedTabs = await chrome.tabs.query({ url: ${JSON.stringify(pageUrlPattern)} });
          const tabs = matchedTabs.length > 0
            ? matchedTabs
            : await chrome.tabs.query({});
          const tab = tabs.find((entry) => entry.url?.startsWith(${JSON.stringify(pageUrl)})) ??
            tabs.find((entry) => /^https?:/i.test(entry.url || ''));
          if (!tab?.id) {
            throw new Error('Page tab not found.');
          }
          const response = await chrome.runtime.sendMessage({ type: 'tab:toggle', tabId: tab.id });
          return JSON.stringify({
            matchedCount: matchedTabs.length,
            tabId: tab.id,
            tabUrl: tab.url,
            response,
            tabs: tabs.map((entry) => ({
              id: entry.id,
              url: entry.url,
              active: entry.active,
              title: entry.title
            }))
          });
        } catch (error) {
          return JSON.stringify({
            error: error instanceof Error ? error.message : String(error)
          });
        }
      })()
    `),
  );
  console.log(`[page-smoke] injection state: ${JSON.stringify(injectionState)}`);

  await waitForTranslations(pageClient, {
    timeoutMs: Number(process.env.PAGE_SMOKE_TRANSLATION_WAIT_MS ?? 30000),
    minTranslations: Number(process.env.PAGE_SMOKE_MIN_TRANSLATIONS ?? 1),
    requireCjk: process.env.PAGE_SMOKE_REQUIRE_CJK === '1',
  });

  const after = await collectDiagnostics(pageClient);
  console.log(`[page-smoke] after toggle: ${JSON.stringify(after)}`);

  await mkdir(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, 'page-smoke.png');
  await captureScreenshot(pageClient, screenshotPath);
  console.log(`[page-smoke] screenshot: ${screenshotPath}`);

  await pageClient.close();
  await optionsClient.close();
} finally {
  await closeProcess(browser);
  await closeProcess(mockServer);
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
}

async function collectDiagnostics(client) {
  return parseMaybeJson(
    await client.evaluate(`
      (() => {
        const hardSkipSelector = [
          'textarea',
          'select',
          'option',
          'code',
          'pre',
          'kbd',
          'samp',
          'script',
          'style',
          'svg',
          'canvas',
          'video',
          'audio',
          'iframe',
          'noscript',
          '[contenteditable]:not([contenteditable="false"])',
          '[data-dlt-role]'
        ].join(',');
        const textBlockTags = new Set(['P', 'LI', 'BLOCKQUOTE', 'FIGCAPTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
        const genericTextTags = new Set(['DIV', 'SPAN', 'LABEL', 'SUMMARY', 'CAPTION', 'DT', 'DD', 'TH', 'TD']);
        const interactiveTags = new Set(['A', 'BUTTON', 'INPUT']);
        const blockDescendantSelector = [
          'p',
          'li',
          'blockquote',
          'figcaption',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'a',
          'button',
          'input[type="button"]',
          'input[type="submit"]',
          'input[type="reset"]'
        ].join(',');
        const collapse = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const textExcludingDlt = (element) => {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
              return node.parentElement?.closest('[data-dlt-role]')
                ? NodeFilter.FILTER_REJECT
                : NodeFilter.FILTER_ACCEPT;
            }
          });
          let text = '';
          let current = walker.nextNode();
          while (current) {
            text += current.textContent || '';
            current = walker.nextNode();
          }
          return text;
        };
        const sourceText = (element) => {
          if (element instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes((element.type || 'text').toLowerCase())) {
            return element.value;
          }
          return textExcludingDlt(element);
        };
        const visible = (element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const candidate = (element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }
          if (element.dataset.dltRole || element.closest('[data-dlt-role]')) {
            return false;
          }
          if (element.matches(hardSkipSelector)) {
            return false;
          }
          const text = collapse(sourceText(element));
          if (text.length < 3 || text.length > 1600 || !visible(element)) {
            return false;
          }
          if (interactiveTags.has(element.tagName)) {
            return element.tagName === 'INPUT'
              ? ['button', 'submit', 'reset'].includes((element.type || 'text').toLowerCase())
              : !element.querySelector(hardSkipSelector);
          }
          if (textBlockTags.has(element.tagName)) {
            return true;
          }
          if (!genericTextTags.has(element.tagName) && !element.tagName.includes('-')) {
            return false;
          }
          if (element.children.length > 8 || element.querySelector(blockDescendantSelector)) {
            return false;
          }
          let hasText = false;
          for (const child of Array.from(element.childNodes)) {
            if (child instanceof Text) {
              if (child.nodeValue?.trim()) {
                hasText = true;
              }
              continue;
            }
            if (!(child instanceof HTMLElement) || child.matches(hardSkipSelector)) {
              continue;
            }
            const childDisplay = getComputedStyle(child).display;
            if (childDisplay !== 'contents' && !childDisplay.startsWith('inline')) {
              return false;
            }
            if (child.textContent?.trim()) {
              hasText = true;
            }
          }
          return hasText;
        };
        const candidates = Array.from(document.querySelectorAll('body *')).filter(candidate);
        const layoutIssues = Array.from(document.querySelectorAll('.dlt-translation')).map((translation) => {
          const internal = translation.classList.contains('dlt-translation-inline-control-line') ||
            translation.classList.contains('dlt-translation-internal-line');
          const source = internal ? translation.parentElement : translation.previousElementSibling;
          if (!(source instanceof HTMLElement)) {
            return null;
          }
          const sourceRect = source.getBoundingClientRect();
          const translationRect = translation.getBoundingClientRect();
          const sourceStyle = getComputedStyle(source);
          const lineHeight = Number.parseFloat(sourceStyle.lineHeight) || Number.parseFloat(sourceStyle.fontSize) * 1.2 || 20;
          const tooHigh = translationRect.top < sourceRect.top + Math.max(lineHeight * 0.35, 6);
          return tooHigh
            ? {
                sourceTag: source.tagName,
                sourceClass: String(source.className || '').slice(0, 80),
                sourceText: collapse(sourceText(source)).slice(0, 120),
                translationText: collapse(translation.textContent || translation.querySelector('input')?.value || '').slice(0, 120),
                sourceTop: Math.round(sourceRect.top),
                translationTop: Math.round(translationRect.top),
                internal
              }
            : null;
        }).filter(Boolean);
        return {
          href: location.href,
          title: document.title,
          readyState: document.readyState,
          bodyTextLength: document.body?.innerText?.length ?? 0,
          bodyTextPreview: collapse(document.body?.innerText ?? '').slice(0, 500),
          candidateCount: candidates.length,
          translationCount: document.querySelectorAll('.dlt-translation').length,
          runtimeNodeCount: document.querySelectorAll('[data-dlt-role]').length,
          layoutIssueCount: layoutIssues.length,
          firstLayoutIssues: layoutIssues.slice(0, 10),
          firstCandidates: candidates.slice(0, 20).map((element) => ({
            tag: element.tagName,
            text: collapse(sourceText(element)).slice(0, 160),
            children: element.children.length,
            className: String(element.className || '').slice(0, 80)
          })),
          firstTranslations: Array.from(document.querySelectorAll('.dlt-translation')).slice(0, 20).map((element) => collapse(element.textContent || element.querySelector('input')?.value || '').slice(0, 160))
        };
      })()
    `),
  );
}

async function waitForTranslations(
  client,
  { timeoutMs, minTranslations, requireCjk },
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = parseMaybeJson(
      await client.evaluate(`
        (() => {
          const translations = Array.from(document.querySelectorAll('.dlt-translation'))
            .map((element) => element.textContent || element.querySelector('input')?.value || '');
          return JSON.stringify({
            count: translations.length,
            hasCjk: translations.some((text) => /[\\u3400-\\u9fff]/.test(text))
          });
        })()
      `),
    );
    if (
      Number(state?.count ?? 0) >= minTranslations &&
      (!requireCjk || state?.hasCjk)
    ) {
      return;
    }
    await sleep(500);
  }

  throw new Error(
    `Timed out waiting for translations: min=${minTranslations}, requireCjk=${requireCjk}`,
  );
}

async function waitForPageReady(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const readyState = await client.evaluate('document.readyState');
    if (readyState === 'complete' || readyState === 'interactive') {
      return;
    }
    await sleep(250);
  }
}

async function captureScreenshot(client, outputPath) {
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await import('node:fs/promises').then((fs) => fs.writeFile(outputPath, result.data, 'base64'));
}

async function openTarget(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  });
  if (!response.ok) {
    throw new Error(`Failed to open target: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function waitForExtensionRegistration(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await getTargets(port).catch(() => []);
    const target = targets.find(
      (entry) =>
        entry.type === 'service_worker' &&
        entry.url?.startsWith('chrome-extension://') &&
        entry.url.endsWith('/service-worker-loader.js'),
    );
    if (target) {
      const [, extensionId] = target.url.match(/^chrome-extension:\/\/([^/]+)/) ?? [];
      if (extensionId) {
        return { id: extensionId, target };
      }
    }
    await sleep(200);
  }
  return null;
}

async function getTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) {
    throw new Error(`Failed to list targets: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function waitForDevtools(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await getTargets(port);
      if (Array.isArray(targets)) {
        return;
      }
    } catch {
      await sleep(150);
    }
  }
  throw new Error(`Timed out waiting for DevTools on ${port}.`);
}

async function waitForMockServer(serverProcess, port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Mock translation server exited early with code ${serverProcess.exitCode}.`);
    }
    try {
      await probePort(port);
      return;
    } catch {
      await sleep(150);
    }
  }
  throw new Error('Timed out waiting for mock translation server.');
}

function probePort(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.end();
      resolve();
    });
    socket.once('error', reject);
  });
}

function getOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function closeProcess(childProcess) {
  if (!childProcess || childProcess.exitCode !== null) {
    return;
  }

  const gracefulExit = once(childProcess, 'exit').catch(() => undefined);
  childProcess.kill('SIGTERM');
  await Promise.race([gracefulExit, sleep(3000)]);
  if (childProcess.exitCode === null) {
    const forcedExit = once(childProcess, 'exit').catch(() => undefined);
    childProcess.kill('SIGKILL');
    await Promise.race([forcedExit, sleep(3000)]);
  }
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function redactBaseUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return value ? '[configured]' : '[empty]';
  }
}

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
