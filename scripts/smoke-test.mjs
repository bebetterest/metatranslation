import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
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

        const { resolve: resolvePending, reject: rejectPending } = this.pending.get(message.id);
        this.pending.delete(message.id);

        if (message.error) {
          rejectPending(new Error(message.error.message));
          return;
        }

        resolvePending(message.result);
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

  async close() {
    if (!this.socket) {
      return;
    }

    this.socket.close();
    this.socket = null;
  }
}

const args = parseArgs(process.argv.slice(2));
const extensionDir = path.resolve(args.extension ?? 'dist');
const browserPath = args.browser ?? process.env.BROWSER_BIN;
const port = Number(args.port ?? 9333);

if (!browserPath) {
  console.error('Missing browser binary. Pass --browser=/path/to/Chromium or set BROWSER_BIN.');
  process.exit(1);
}

const profileDir = await mkdtemp(path.join(os.tmpdir(), 'dlt-smoke-'));
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

let stderr = '';
browser.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

let stdout = '';
browser.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
});

try {
  await waitForDevtools(port, 10000);
  await sleep(1500);

  const loadedExtension = await waitForExtensionRegistration(profileDir, port, 10000);

  if (!loadedExtension) {
    console.error('Extension did not appear in profile preferences.');
    if (isGoogleChromeBinary(browserPath)) {
      console.error(
        'This is expected in branded Google Chrome 137+ where --load-extension is removed. Use Chromium or Chrome for Testing instead.',
      );
    }
    printRecentBrowserLogs(stdout, stderr);
    process.exit(1);
  }

  console.log(`Loaded extension ID: ${loadedExtension.id}`);

  const target = await openTarget(port, `chrome-extension://${loadedExtension.id}/src/options/index.html`);
  const inspection = await inspectOptionsPage(target.webSocketDebuggerUrl);

  if (!inspection.hasSettingsForm || !inspection.hasSearch) {
    console.error('Options page opened but expected UI elements were missing.');
    console.error(JSON.stringify(inspection, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(inspection, null, 2));
} finally {
  browser.kill('SIGTERM');
  await rm(profileDir, { recursive: true, force: true });
}

function parseArgs(argv) {
  return Object.fromEntries(
    argv
      .map((arg) => arg.match(/^--([^=]+)=(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value]),
  );
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

async function readSecurePreferences(profileDir) {
  const candidates = [
    path.join(profileDir, 'Default', 'Secure Preferences'),
    path.join(profileDir, 'Default', 'Preferences'),
  ];

  const deadline = Date.now() + 5000;
  let lastError = null;

  while (Date.now() < deadline) {
    for (const filePath of candidates) {
      try {
        const content = await readFile(filePath, 'utf8');
        return JSON.parse(content);
      } catch (error) {
        lastError = error;
      }
    }

    await sleep(250);
  }

  if (lastError?.code === 'ENOENT') {
    return null;
  }

  throw lastError ?? new Error('Could not find Chrome preference files for the temporary profile.');
}

async function waitForExtensionRegistration(profileDir, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const securePreferences = await readSecurePreferences(profileDir);
    const fromPreferences = securePreferences ? findMetatranslation(securePreferences) : null;
    if (fromPreferences) {
      return fromPreferences;
    }

    const fromTargets = await findExtensionFromTargets(port);
    if (fromTargets) {
      return fromTargets;
    }

    await sleep(300);
  }

  return null;
}

function findMetatranslation(securePreferences) {
  const settings = securePreferences?.extensions?.settings ?? {};

  for (const [id, entry] of Object.entries(settings)) {
    if (entry?.manifest?.name === 'metatranslation') {
      return { id, entry };
    }
  }

  return null;
}

function isGoogleChromeBinary(browserPath) {
  return /Google Chrome\.app|google-chrome/i.test(browserPath);
}

function printRecentBrowserLogs(stdout, stderr) {
  const text = [stdout, stderr].filter(Boolean).join('\n');
  if (!text.trim()) {
    return;
  }

  const lines = text.trim().split('\n');
  const excerpt = lines.slice(-20).join('\n');
  console.error('Recent browser logs:');
  console.error(excerpt);
}

async function openTarget(port, url) {
  return httpRequestJson('PUT', port, `/json/new?${url}`);
}

async function findExtensionFromTargets(port) {
  try {
    const targets = await httpRequestJson('GET', port, '/json/list');
    const serviceWorker = targets.find(
      (target) =>
        target.type === 'service_worker' &&
        /^chrome-extension:\/\/[a-z]{32}\/service-worker-loader\.js$/i.test(target.url),
    );

    if (!serviceWorker) {
      return null;
    }

    const match = serviceWorker.url.match(/^chrome-extension:\/\/([a-z]{32})\//i);
    if (!match) {
      return null;
    }

    return { id: match[1], entry: null };
  } catch {
    return null;
  }
}

async function inspectOptionsPage(webSocketUrl) {
  const client = new CDPClient(webSocketUrl);
  await client.open();
  await client.send('Runtime.enable');
  await sleep(500);

  const expression =
    'JSON.stringify({title:document.title,hasSettingsForm:!!document.querySelector("#settings-form"),hasSearch:!!document.querySelector("#search"),hero:document.querySelector("h1")?.textContent?.trim()})';

  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });

  await client.close();
  return JSON.parse(result.result.value);
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
