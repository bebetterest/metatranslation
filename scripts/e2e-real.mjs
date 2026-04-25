import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
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
    if (!this.socket) {
      return;
    }

    this.socket.close();
    this.socket = null;
  }
}

const browserPath = process.env.BROWSER_BIN;
const baseUrl = process.env.REAL_TEST_BASE_URL;
const apiKey = process.env.REAL_TEST_KEY;
const model = process.env.REAL_TEST_MODEL ?? 'x-ai/grok-4.1-fast';
const targetLang = process.env.REAL_TEST_TARGET_LANG ?? 'zh-CN';
const translationRetryCount = Number(process.env.REAL_TEST_TRANSLATION_RETRY_COUNT ?? 2);
const dictionaryProvider = process.env.REAL_TEST_DICTIONARY_PROVIDER ?? 'wiktapi';
const dictionaryHoverHoldMs = Number(process.env.REAL_TEST_DICTIONARY_HOVER_HOLD_MS ?? 1000);
const port = Number(process.env.REAL_TEST_PORT ?? 9340);
const extensionDir = path.resolve('dist');
const screenshotDir = path.resolve(process.env.REAL_TEST_SCREENSHOT_DIR ?? 'artifacts/e2e');
const strictInputRecord = process.env.REAL_TEST_STRICT_INPUT_RECORD === '1';
const tolerantProviderOutput = process.env.REAL_TEST_TOLERANT_PROVIDER_OUTPUT !== '0';

if (!browserPath) {
  console.error('Missing BROWSER_BIN.');
  process.exit(1);
}

if (!baseUrl || !apiKey) {
  console.error('Missing REAL_TEST_BASE_URL or REAL_TEST_KEY.');
  process.exit(1);
}

const profileDir = await mkdtemp(path.join(os.tmpdir(), 'dlt-real-e2e-'));
const fixtureServer = await createFixtureServer();
const fixtureUrl = `http://127.0.0.1:${fixtureServer.port}/fixture.html`;
const gateUrl = `http://127.0.0.1:${fixtureServer.port}/gate.html`;

const browser = spawn(
  browserPath,
  [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    'about:blank',
  ],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let stdout = '';
let stderr = '';

browser.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
});

browser.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitForDevtools(port, 10000);
  const extension = await waitForExtensionRegistration(profileDir, port, 10000);

  if (!extension) {
    throw new Error('Extension did not register in Chrome for Testing.');
  }

  console.log(`[e2e] extension registered: ${extension.id}`);

  const optionsTarget = await openTarget(
    port,
    `chrome-extension://${extension.id}/src/options/index.html`,
  );
  const optionsClient = new CDPClient(optionsTarget.webSocketDebuggerUrl);
  await optionsClient.open();
  await optionsClient.send('Runtime.enable');
  await sleep(800);

  await configureExtension(optionsClient, {
    baseUrl,
    apiKey,
    model,
    targetLang,
    translationRetryCount,
    dictionaryProvider,
    dictionaryHoverHoldMs,
    tolerantProviderOutput,
  });

  console.log('[e2e] extension settings saved');

  const storageState = parseMaybeJson(
    await optionsClient.evaluate(
      'new Promise((resolve) => chrome.storage.local.get("extensionSettings", (data) => resolve(data.extensionSettings)))',
    ),
  );

  console.log(
    `[e2e] stored settings: ${JSON.stringify({
      baseUrl: storageState?.baseUrl,
      model: storageState?.model,
      targetLang: storageState?.targetLang,
      timeoutMs: storageState?.timeoutMs,
      translationRetryCount: storageState?.translationRetryCount,
      dictionaryProvider: storageState?.dictionaryProvider,
      dictionaryEdition: storageState?.dictionaryEdition,
      dictionaryHoverHoldMs: storageState?.dictionaryHoverHoldMs,
      tolerantProviderOutput: storageState?.tolerantProviderOutput,
    })}`,
  );

  const directTranslation = parseMaybeJson(
    await optionsClient.evaluate(`
      new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'translation:translate-blocks',
          payload: {
            targetLang: ${JSON.stringify(targetLang)},
            pageUrl: ${JSON.stringify(fixtureUrl)},
            sourceLang: 'en',
            blocks: [{ id: 'probe-1', text: 'I like you.' }]
          }
        }).then((response) => resolve(response)).catch(reject);
      })
    `),
  );

  console.log(`[e2e] single-block probe count: ${directTranslation.blocks?.length ?? 0}`);

  if (!Array.isArray(directTranslation.blocks) || directTranslation.blocks.length === 0) {
    throw new Error(
      `Real translation probe returned no translated blocks: ${JSON.stringify(directTranslation)}`,
    );
  }

  const prewarmedTranslations = [];
  for (const block of [
    { id: 'warm-1', text: 'A Tiny Translation Fixture' },
    { id: 'warm-2', text: 'I like you.' },
    { id: 'warm-3', text: 'The sky is blue.' },
    { id: 'warm-4', text: 'We read books.' },
    { id: 'warm-5', text: 'Do not translate this button label' },
    { id: 'warm-6', text: 'Flexible text stays below.' },
    { id: 'warm-7', text: 'Do not translate this link text' },
    { id: 'warm-8', text: 'Do not translate this input button' },
  ]) {
    const warmed = parseMaybeJson(
      await optionsClient.evaluate(`
        new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'translation:translate-blocks',
            payload: {
              targetLang: ${JSON.stringify(targetLang)},
              pageUrl: ${JSON.stringify(fixtureUrl)},
              sourceLang: 'en',
              blocks: [${JSON.stringify(block)}]
            }
          }).then((response) => resolve(response)).catch(reject);
        })
      `),
    );
    prewarmedTranslations.push(warmed);
  }

  console.log(
    `[e2e] prewarm counts: ${JSON.stringify(
      prewarmedTranslations.map((entry) => entry.blocks?.length ?? 0),
    )}`,
  );

  const batchTranslation = parseMaybeJson(
    await optionsClient.evaluate(`
      new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'translation:translate-blocks',
          payload: {
            targetLang: ${JSON.stringify(targetLang)},
            pageUrl: ${JSON.stringify(fixtureUrl)},
            sourceLang: 'en',
            blocks: [
              { id: 'probe-2', text: 'A Tiny Translation Fixture' },
              { id: 'probe-3', text: 'I like you.' },
              { id: 'probe-4', text: 'The sky is blue.' }
            ]
          }
        }).then((response) => resolve(response)).catch(reject);
      })
    `),
  );

  console.log(
    `[e2e] batch probe count: ${batchTranslation.blocks?.length ?? 0} ids=${JSON.stringify(
      Array.isArray(batchTranslation.blocks) ? batchTranslation.blocks.map((block) => block.id) : [],
    )}`,
  );

  const pageTarget = await openTarget(port, fixtureUrl);
  const pageClient = new CDPClient(pageTarget.webSocketDebuggerUrl);
  await pageClient.open();
  await pageClient.send('Runtime.enable');
  await pageClient.send('Page.enable');
  await pageClient.send('Page.bringToFront');
  await pageClient.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1200,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await pageClient.send('Input.setIgnoreInputEvents', { ignore: false });
  await sleep(500);

  console.log('[e2e] fixture page opened');

  const injectionStateValue = await optionsClient.evaluate(`
    new Promise((resolve, reject) => {
      chrome.tabs.query({ url: ${JSON.stringify(fixtureUrl)} }, async (tabs) => {
        try {
          const tab = tabs[0];
          if (!tab?.id) {
            throw new Error('Fixture tab not found.');
          }
          const response = await chrome.runtime.sendMessage({ type: 'tab:toggle', tabId: tab.id });
          resolve({
            tabId: tab.id,
            tabCount: tabs.length,
            response,
          });
        } catch (error) {
          reject(error);
        }
      });
    })
  `);
  const injectionState = parseMaybeJson(injectionStateValue);

  console.log(`[e2e] injection state: ${JSON.stringify(injectionState)}`);

  const domStateAfterToggle = parseMaybeJson(
    await pageClient.evaluate(
      '({ style: !!document.querySelector("[data-dlt-role=\'dlt-style\']"), highlight: !!document.querySelector("[data-dlt-role=\'dlt-highlight\']"), translationCount: document.querySelectorAll(".dlt-translation").length, texts: Array.from(document.querySelectorAll(".dlt-translation")).map((node) => node.textContent?.trim() || node.querySelector("input")?.value || ""), inlineControlCount: document.querySelectorAll(".dlt-translation-inline-control-line").length, inputTypes: Array.from(document.querySelectorAll(".dlt-translation input")).map((node) => node.type) })',
    ),
  );

  console.log(`[e2e] dom state after toggle: ${JSON.stringify(domStateAfterToggle)}`);

  await waitForPageCondition(
    pageClient,
    'document.querySelectorAll(".dlt-translation").length >= 6',
    90000,
  );

  console.log('[e2e] initial translations rendered');

  const screenshots = {
    translated: path.join(screenshotDir, 'translated-page.png'),
    hover: path.join(screenshotDir, 'hover-highlight.png'),
  };
  await mkdir(screenshotDir, { recursive: true });
  await captureScreenshot(pageClient, screenshots.translated);

  const initialState = parseMaybeJson(
    await pageClient.evaluate(
      '({ translationCount: document.querySelectorAll(".dlt-translation").length, translations: Array.from(document.querySelectorAll(".dlt-translation")).map((node) => node.textContent?.trim() || node.querySelector("input")?.value || ""), translatedButtonLabels: Array.from(document.querySelectorAll("#noop-button > .dlt-translation")).map((node) => node.textContent?.trim()), translatedLinkLabels: Array.from(document.querySelectorAll("#noop-link > .dlt-translation")).map((node) => node.textContent?.trim()), translatedInputValues: Array.from(document.querySelectorAll(".dlt-translation input")).map((node) => node.value) })',
    ),
  );
  const expectedInitialTranslations = [
    '一个小翻译装置',
    '我喜欢你。',
    '天空是蓝色的。',
    '灵活文本保持在下方。',
    '不要翻译这个按钮标签',
    '不要翻译这个链接文本',
    '不要翻译这个输入按钮',
  ];
  if (
    JSON.stringify(initialState.translations.slice(0, expectedInitialTranslations.length)) !==
    JSON.stringify(expectedInitialTranslations)
  ) {
    throw new Error(
      `Translations are not rendered top-to-bottom for heading, text, button, link, and input: ${JSON.stringify(initialState)}`,
    );
  }

  const visualAcceptanceState = parseMaybeJson(
    await pageClient.evaluate(`
      (() => {
        const checks = [
          { key: 'headline', selector: '#headline', expected: '一个小翻译装置', kind: 'text' },
          { key: 'sentence-1', selector: '#sentence-1', expected: '我喜欢你。', kind: 'text' },
          { key: 'sentence-2', selector: '#sentence-2', expected: '天空是蓝色的。', kind: 'text' },
          { key: 'button', selector: '#noop-button', expected: '不要翻译这个按钮标签', kind: 'button' },
          { key: 'flex-text', selector: '#flex-text', expected: '灵活文本保持在下方。', kind: 'internal-text' },
          { key: 'link', selector: '#noop-link', expected: '不要翻译这个链接文本', kind: 'link' },
          { key: 'input', selector: '#noop-input', expected: '不要翻译这个输入按钮', kind: 'input' },
        ];
        const styleProps = ['color', 'fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'lineHeight', 'textTransform'];
        const textOf = (element, kind) => {
          if (!element) {
            return '';
          }
          if (kind === 'input' && element instanceof HTMLInputElement) {
            return element.value.trim();
          }
          return (element.textContent || '').trim();
        };

        return checks.map((check) => {
          const source = document.querySelector(check.selector);
          const translation = check.kind === 'button' || check.kind === 'link' || check.kind === 'internal-text'
            ? source?.querySelector(':scope > .dlt-translation')
            : source?.nextElementSibling;
          const rendered = check.kind === 'button'
            ? translation
            : check.kind === 'link'
              ? translation
              : check.kind === 'internal-text'
                ? translation
                : check.kind === 'input'
                  ? translation?.querySelector('input')
                  : translation;
          const sourceStyle = source ? getComputedStyle(source) : null;
          const renderedStyle = rendered ? getComputedStyle(rendered) : null;
          const sourceRect = source?.getBoundingClientRect();
          const translationRect = translation?.getBoundingClientRect();
          const lineHeight = sourceStyle
            ? Number.parseFloat(sourceStyle.lineHeight) || Number.parseFloat(sourceStyle.fontSize) * 1.2 || 20
            : 20;

          return {
            key: check.key,
            expected: check.expected,
            text: textOf(rendered, check.kind),
            adjacent: check.kind === 'button' || check.kind === 'link' || check.kind === 'internal-text'
              ? Boolean(translation?.classList.contains('dlt-translation') && translation.parentElement === source)
              : Boolean(translation?.classList.contains('dlt-translation')),
            display: translation ? getComputedStyle(translation).display : '',
            styleMismatches: sourceStyle && renderedStyle
              ? styleProps.filter((prop) => sourceStyle[prop] !== renderedStyle[prop])
              : styleProps,
            topDelta: sourceRect && translationRect ? translationRect.top - sourceRect.bottom : null,
            maxAllowedGap: lineHeight * 1.5,
            visuallyNextLine: Boolean(
              sourceRect &&
              translationRect &&
              translationRect.top >= sourceRect.top &&
              translationRect.top <= sourceRect.bottom + Math.max(lineHeight * 1.5, 8)
            ),
            inlineSecondLine: check.kind === 'button' || check.kind === 'link' || check.kind === 'internal-text'
              ? Boolean(
                sourceRect &&
                translationRect &&
                translationRect.top >= sourceRect.top + Math.max(lineHeight * 0.35, 6)
              )
              : true,
          };
        });
      })()
    `),
  );
  const visualFailures = visualAcceptanceState.filter((entry) => (
    entry.text !== entry.expected ||
    !entry.adjacent ||
    entry.display !== 'block' ||
    entry.styleMismatches.length > 0 ||
    !entry.visuallyNextLine ||
    !entry.inlineSecondLine
  ));
  if (visualFailures.length > 0) {
    throw new Error(`Visual injection acceptance failed: ${JSON.stringify(visualFailures)}`);
  }

  const interactiveTargets = parseMaybeJson(
    await pageClient.evaluate(`
      (() => {
        const button = document.querySelector('#noop-button > .dlt-translation');
        const link = document.querySelector('#noop-link > .dlt-translation');
        const input = document.querySelector('.dlt-translation input');
        const toCenter = (element) => {
          if (!element) {
            return null;
          }
          const rect = element.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        };

        return {
          button: toCenter(button),
          link: toCenter(link),
          input: toCenter(input),
        };
      })()
    `),
  );

  if (interactiveTargets.button) {
    await clickPoint(pageClient, interactiveTargets.button);
  }

  if (interactiveTargets.link) {
    await clickPoint(pageClient, interactiveTargets.link);
  }

  if (interactiveTargets.input) {
    await clickPoint(pageClient, interactiveTargets.input);
  }

  const interactiveState = parseMaybeJson(await pageClient.evaluate('window.__fixtureEvents'));
  console.log(`[e2e] interactive proxy state: ${JSON.stringify(interactiveState)}`);

  await pageClient.evaluate('window.moveFixtureParagraph()');
  await waitForPageCondition(
    pageClient,
    `
      (() => {
        const moved = document.querySelector('#sentence-2');
        const translation = moved?.nextElementSibling;
        return translation?.classList.contains('dlt-translation') &&
          translation.textContent.includes('天空是蓝色的');
      })()
    `,
    5000,
  );

  console.log('[e2e] moved paragraph translation stayed adjacent');

  await pageClient.evaluate('window.appendFixtureParagraph()');
  await waitForPageCondition(
    pageClient,
    'document.querySelectorAll(".dlt-translation").length >= 7',
    90000,
  );

  console.log('[e2e] incremental paragraph translation rendered');

  const rect = parseMaybeJson(
    await pageClient.evaluate(`
      (() => {
        const walker = document.createTreeWalker(document.querySelector('#sentence-1'), NodeFilter.SHOW_TEXT);
        const textNode = walker.nextNode();
        if (!textNode) {
          throw new Error('Missing sentence text node.');
        }
        const range = document.createRange();
        range.setStart(textNode, 2);
        range.setEnd(textNode, 6);
        const box = range.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      })()
    `),
  );

  await pageClient.send('Page.bringToFront');
  await dispatchPointerMove(pageClient, '#sentence-1', rect);

  await waitForPageCondition(
    pageClient,
    'document.querySelectorAll(".dlt-highlight-rect").length >= 2',
    5000,
  );

  console.log('[e2e] hover highlight rendered');
  await sleep(1000);
  await pageClient.evaluate(`
    document.querySelector('#headline')?.setAttribute('data-e2e-mutation', String(Date.now()))
  `);
  await sleep(1600);

  const recordCancellationState = await queryRecords(optionsClient, 'like');
  if ((recordCancellationState.records?.length ?? 0) !== 0) {
    throw new Error(
      `Hover record timer was not cancelled by DOM mutation: ${JSON.stringify(recordCancellationState)}`,
    );
  }

  console.log('[e2e] DOM mutation cancelled pending hover record');
  await holdPointer(pageClient, '#sentence-1', rect, 2600);
  const recordsState = await waitForRecordCount(optionsClient, 'like', 1, 15000);
  await holdPointer(pageClient, '#sentence-1', rect, 2600);
  const repeatedHoverState = await queryRecords(optionsClient, 'like');
  const likeRecord = repeatedHoverState.records?.[0];
  if (!likeRecord || likeRecord.count !== 1) {
    throw new Error(
      `Continuous hover should record once per source-side span dwell: ${JSON.stringify(repeatedHoverState)}`,
    );
  }

  await captureScreenshot(pageClient, screenshots.hover);

  let inputRecordsState = null;
  if (strictInputRecord) {
    const recordsBeforeInputHover = await queryRecords(optionsClient, '');
    const inputSourcePoint = parseMaybeJson(
      await pageClient.evaluate(`
        (() => {
          const input = document.querySelector('#noop-input');
          if (!input) {
            throw new Error('Missing source input control.');
          }

          const style = getComputedStyle(input);
          const px = (value) => Number.parseFloat(value) || 0;
          const rect = input.getBoundingClientRect();
          const left = rect.left + px(style.borderLeftWidth) + px(style.paddingLeft);
          const right = rect.right - px(style.borderRightWidth) - px(style.paddingRight);
          const top = rect.top + px(style.borderTopWidth) + px(style.paddingTop);
          const bottom = rect.bottom - px(style.borderBottomWidth) - px(style.paddingBottom);

          return {
            x: left + Math.max(right - left, 1) / 2,
            y: top + Math.max(bottom - top, 1) / 2,
          };
        })()
      `),
    );

    await clearHighlightViaBlankPointer(pageClient);

    await pageClient.send('Page.bringToFront');
    await dispatchPointerMove(pageClient, '#noop-input', inputSourcePoint);

    await waitForPageCondition(
      pageClient,
      'document.querySelectorAll(".dlt-highlight-rect").length >= 2',
      5000,
    );

    const beforeCount = Array.isArray(recordsBeforeInputHover.records)
      ? recordsBeforeInputHover.records.length
      : 0;
    await holdPointer(pageClient, '#noop-input', inputSourcePoint, 2600);
    inputRecordsState = await waitForRecordCount(optionsClient, '', beforeCount + 1, 15000);
  }

  const disableStateValue = await optionsClient.evaluate(`
    new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'tab:toggle', tabId: ${JSON.stringify(injectionState.tabId)} })
        .then((response) => resolve(response))
        .catch(reject);
    })
  `);
  const disableState = parseMaybeJson(disableStateValue);

  await waitForPageCondition(
    pageClient,
    'document.querySelectorAll("[data-dlt-role]").length === 0',
    5000,
  );

  const cleanupState = parseMaybeJson(
    await pageClient.evaluate(
      '({ roleNodeCount: document.querySelectorAll("[data-dlt-role]").length, translationCount: document.querySelectorAll(".dlt-translation").length, disableState: null })',
    ),
  );
  cleanupState.disableState = disableState;

  const navigationResetState = await verifyNavigationReset(
    port,
    optionsClient,
    gateUrl,
  );

  const summary = {
    extensionId: extension.id,
    storageState: {
      ...storageState,
      apiKey: storageState?.apiKey ? `${String(storageState.apiKey).slice(0, 8)}...` : '',
    },
    directTranslation,
    prewarmedTranslations,
    batchTranslation,
    injectionState,
    domStateAfterToggle,
    initialState,
    interactiveState,
    recordCancellationState,
    recordsState,
    repeatedHoverState,
    inputRecordsState,
    cleanupState,
    navigationResetState,
    screenshots,
  };

  console.log(JSON.stringify(summary, null, 2));

  await optionsClient.close();
  await pageClient.close();
} finally {
  await closeBrowserProcess(browser);
  fixtureServer.close();
  await removeDirectoryWithRetry(profileDir);
}

function waitForDevtools(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        await httpRequestJson('GET', port, '/json/version');
        resolve();
      } catch (error) {
        if (Date.now() >= deadline) {
          reject(error);
          return;
        }
        setTimeout(attempt, 250);
      }
    };

    void attempt();
  });
}

async function configureExtension(optionsClient, settings) {
  await optionsClient.evaluate(`
    (() => {
      document.querySelector('#base-url').value = ${JSON.stringify(settings.baseUrl)};
      document.querySelector('#api-key').value = ${JSON.stringify(settings.apiKey)};
      document.querySelector('#model').value = ${JSON.stringify(settings.model)};
      document.querySelector('#target-lang').value = ${JSON.stringify(settings.targetLang)};
      document.querySelector('#timeout-ms').value = '120000';
      document.querySelector('#request-chunk-size').value = '1';
      document.querySelector('#request-concurrency').value = '64';
      document.querySelector('#context-window-chars').value = '100';
      document.querySelector('#translation-retry-count').value = ${JSON.stringify(String(settings.translationRetryCount))};
      document.querySelector('#dictionary-provider').value = ${JSON.stringify(settings.dictionaryProvider)};
      document.querySelector('#dictionary-hover-hold-ms').value = ${JSON.stringify(String(settings.dictionaryHoverHoldMs))};
      document.querySelector('#tolerant-provider-output').checked = ${JSON.stringify(settings.tolerantProviderOutput)};
      document.querySelector('#settings-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return true;
    })()
  `);

  await waitForPageCondition(
    optionsClient,
    'document.querySelector("#settings-status")?.textContent?.trim() === "设置已保存"',
    8000,
  );
}

async function waitForExtensionRegistration(profileDir, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const securePreferences = await readPreferences(profileDir);
    const fromPreferences = securePreferences ? findMetatranslation(securePreferences) : null;
    if (fromPreferences) {
      return fromPreferences;
    }

    const targets = await httpRequestJson('GET', port, '/json/list');
    const fromTargets = targets.find(
      (target) =>
        target.type === 'service_worker' &&
        /^chrome-extension:\/\/[a-z]{32}\/service-worker-loader\.js$/i.test(target.url),
    );

    if (fromTargets) {
      return {
        id: fromTargets.url.match(/^chrome-extension:\/\/([a-z]{32})\//i)?.[1],
      };
    }

    await sleep(300);
  }

  return null;
}

async function waitForServiceWorkerTarget(port, extensionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const targets = await httpRequestJson('GET', port, '/json/list');
    const worker = targets.find(
      (target) =>
        target.type === 'service_worker' &&
        target.url === `chrome-extension://${extensionId}/service-worker-loader.js`,
    );

    if (worker) {
      return worker;
    }

    await sleep(300);
  }

  return null;
}

async function waitForPageCondition(client, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = await client.evaluate(`Boolean(${expression})`);
    if (value) {
      return;
    }
    await sleep(250);
  }

  throw new Error(`Timed out waiting for page condition: ${expression}`);
}

async function waitForRecordCount(client, search, minimumCount, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastResponse = null;

  while (Date.now() < deadline) {
    lastResponse = await queryRecords(client, search);
    const count = Array.isArray(lastResponse.records) ? lastResponse.records.length : 0;
    if (count >= minimumCount) {
      return lastResponse;
    }
    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for at least ${minimumCount} records matching "${search}": ${JSON.stringify(lastResponse)}`,
  );
}

async function clearHighlightViaBlankPointer(client) {
  await client.evaluate(`
    (() => {
      const blocker = document.createElement('div');
      blocker.setAttribute('data-e2e-pointer-blank', 'true');
      blocker.setAttribute('data-dlt-role', 'dlt-e2e-pointer-blank');
      Object.assign(blocker.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        width: '24px',
        height: '24px',
        zIndex: '2147483647',
        background: 'transparent',
        pointerEvents: 'auto'
      });
      document.documentElement.append(blocker);
      blocker.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerType: 'mouse',
        clientX: 12,
        clientY: 12
      }));
      blocker.remove();
    })()
  `);
  await waitForPageCondition(
    client,
    'document.querySelectorAll(".dlt-highlight-rect").length === 0',
    5000,
  );
}

async function holdPointer(client, selector, point, durationMs) {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    await dispatchPointerMove(client, selector, point, { useCdp: false });
    await sleep(250);
  }
}

async function dispatchPointerMove(client, selector, point, options = { useCdp: true }) {
  if (options.useCdp) {
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      button: 'none',
    });
  }
  await client.evaluate(`
    (() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target) {
        throw new Error('Missing pointer target: ${selector.replace(/'/g, "\\'")}');
      }
      target.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerType: 'mouse',
        clientX: ${JSON.stringify(point.x)},
        clientY: ${JSON.stringify(point.y)}
      }));
    })()
  `);
}

async function queryRecords(client, search) {
  return parseMaybeJson(
    await client.evaluate(`
      new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'records:query',
          payload: { search: ${JSON.stringify(search)}, sort: 'recent' }
        }).then((response) => resolve(response)).catch(reject);
      })
    `),
  );
}

async function verifyNavigationReset(port, optionsClient, gateUrl) {
  const pageTarget = await openTarget(port, gateUrl);
  const pageClient = new CDPClient(pageTarget.webSocketDebuggerUrl);
  await pageClient.open();
  await pageClient.send('Runtime.enable');
  await pageClient.send('Page.enable');
  await pageClient.send('Page.bringToFront');
  await pageClient.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1200,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(100);

  const toggleState = parseMaybeJson(
    await optionsClient.evaluate(`
      new Promise((resolve, reject) => {
        chrome.tabs.query({ url: ${JSON.stringify(gateUrl)} }, async (tabs) => {
          try {
            const tab = tabs[0];
            if (!tab?.id) {
              throw new Error('Navigation gate tab not found.');
            }
            const response = await chrome.runtime.sendMessage({ type: 'tab:toggle', tabId: tab.id });
            resolve({ tabId: tab.id, response });
          } catch (error) {
            reject(error);
          }
        });
      })
    `),
  );

  await waitForPageCondition(
    pageClient,
    `
      location.pathname === '/fixture.html' &&
        new URLSearchParams(location.search).get('from') === 'gate' &&
        document.readyState === 'complete'
    `,
    30000,
  );
  await sleep(1200);

  const state = parseMaybeJson(
    await pageClient.evaluate(`
      ({
        href: location.href,
        translationCount: document.querySelectorAll('.dlt-translation').length,
        runtimeNodeCount: document.querySelectorAll('[data-dlt-role]').length,
        translations: Array.from(document.querySelectorAll('.dlt-translation'))
          .map((node) => node.textContent?.trim() || node.querySelector('input')?.value || '')
          .slice(0, 8)
      })
    `),
  );
  const backgroundState = parseMaybeJson(
    await optionsClient.evaluate(`
      new Promise((resolve) => {
        chrome.tabs.get(${JSON.stringify(toggleState.tabId)}, async (tab) => {
          const runtimePing = await chrome.tabs
            .sendMessage(${JSON.stringify(toggleState.tabId)}, { type: 'runtime:ping' })
            .then((response) => ({ ok: true, response }))
            .catch((error) => ({ ok: false, error: error.message }));
          const badgeText = await chrome.action.getBadgeText({ tabId: ${JSON.stringify(toggleState.tabId)} });
          resolve({
            tabUrl: tab?.url ?? '',
            badgeText,
            runtimePing,
            expectedContextMenuTitle: '翻译本页'
          });
        });
      })
    `),
  );

  await pageClient.close();
  return { toggleState, ...state, ...backgroundState };
}

async function readPreferences(profileDir) {
  const candidates = [
    path.join(profileDir, 'Default', 'Secure Preferences'),
    path.join(profileDir, 'Default', 'Preferences'),
  ];

  for (const filePath of candidates) {
    try {
      return JSON.parse(await readFile(filePath, 'utf8'));
    } catch {
      continue;
    }
  }

  return null;
}

function findMetatranslation(preferences) {
  const settings = preferences?.extensions?.settings ?? {};

  for (const [id, entry] of Object.entries(settings)) {
    if (entry?.manifest?.name === 'metatranslation') {
      return { id, entry };
    }
  }

  return null;
}

async function openTarget(port, url) {
  return httpRequestJson('PUT', port, `/json/new?${url}`);
}

function httpRequestJson(method, port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: requestPath,
        method,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (!response.statusCode || response.statusCode >= 400) {
            reject(new Error(`HTTP ${response.statusCode ?? 'ERR'} for ${requestPath}`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on('error', reject);
    request.end();
  });
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function parseMaybeJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function captureScreenshot(client, outputPath) {
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  });
  await writeFile(outputPath, Buffer.from(result.data, 'base64'));
}

async function clickPoint(client, point) {
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}

function createFixtureServer() {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>metatranslation Fixture</title>
    <style>
      body { font-family: Georgia, serif; line-height: 1.8; margin: 40px auto; max-width: 760px; padding: 0 20px; }
      button { font: inherit; padding: 8px 14px; }
      a { color: #0b5fcc; }
      .toolbar { align-items: flex-start; display: flex; flex-wrap: nowrap; gap: 16px; margin: 12px 0; }
      .toolbar a, .toolbar button { align-items: center; display: inline-flex; gap: 6px; white-space: nowrap; }
      .toolbar-icon { display: inline-block; font-size: 1.1em; line-height: 1; }
      .toolbar-icon::before { content: attr(data-icon); }
      .info-card { align-items: center; border: 1px solid #bbb; display: flex; gap: 16px; margin: 12px 0; padding: 12px; width: 420px; }
      .info-card-icon { flex: 0 0 auto; font-size: 24px; }
      .info-card-text { font: inherit; min-width: 0; }
    </style>
  </head>
  <body>
    <main>
      <h1 id="headline">A Tiny Translation Fixture</h1>
      <p id="sentence-1">I like you.</p>
      <p id="sentence-2">The sky is blue.</p>
      <div class="info-card">
        <span class="info-card-icon" aria-hidden="true">🏆</span>
        <div id="flex-text" class="info-card-text">Flexible text stays below.</div>
      </div>
      <div class="toolbar">
        <button id="noop-button"><span class="toolbar-icon" data-icon="+" aria-hidden="true"></span>Do not translate this button label</button>
        <a id="noop-link" href="#link-target"><span class="toolbar-icon" data-icon="#" aria-hidden="true"></span>Do not translate this link text</a>
      </div>
      <input id="noop-input" type="button" value="Do not translate this input button" />
    </main>
    <script>
      window.__fixtureEvents = { buttonClicks: 0, linkClicks: 0, inputClicks: 0 };
      document.querySelector('#noop-button').addEventListener('click', () => {
        window.__fixtureEvents.buttonClicks += 1;
      });
      document.querySelector('#noop-link').addEventListener('click', (event) => {
        event.preventDefault();
        window.__fixtureEvents.linkClicks += 1;
      });
      document.querySelector('#noop-input').addEventListener('click', () => {
        window.__fixtureEvents.inputClicks += 1;
      });
      window.appendFixtureParagraph = function appendFixtureParagraph() {
        const next = document.createElement('p');
        next.id = 'sentence-3';
        next.textContent = 'We read books.';
        document.querySelector('main').append(next);
      };
      window.moveFixtureParagraph = function moveFixtureParagraph() {
        document.querySelector('main').append(document.querySelector('#sentence-2'));
      };
    </script>
  </body>
</html>`;

  const gateHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Navigation Gate</title>
  </head>
  <body>
    <main>
      <h1>Please wait for verification</h1>
    </main>
    <script>
      setTimeout(() => {
        location.href = '/fixture.html?from=gate';
      }, 800);
    </script>
  </body>
</html>`;

  const server = http.createServer((request, response) => {
    const requestPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;

    if (requestPath === '/fixture.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
      return;
    }

    if (requestPath === '/gate.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(gateHtml);
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        port: address.port,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          }),
      });
    });

    server.on('error', reject);
  });
}

async function closeBrowserProcess(browserProcess) {
  if (browserProcess.exitCode !== null) {
    return;
  }

  browserProcess.kill('SIGTERM');

  try {
    await Promise.race([once(browserProcess, 'exit'), sleep(3000)]);
  } catch {
    // ignore
  }

  if (browserProcess.exitCode === null) {
    browserProcess.kill('SIGKILL');
    try {
      await once(browserProcess, 'exit');
    } catch {
      // ignore
    }
  }
}

async function removeDirectoryWithRetry(directoryPath) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(directoryPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        throw error;
      }
      await sleep(300 * (attempt + 1));
    }
  }
}
