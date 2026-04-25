# metatranslation

Desktop Chrome/Edge MV3 extension for natural in-page translation. It keeps the original page text in place, renders the translation on the next visual line, links source and target spans on hover, and records vocabulary after a stable source-side hover.

> Status: active prototype. The extension is useful for local development and unpacked-extension testing, but a public release should add a license file, release notes, and a final privacy review.

Chinese documentation: [README_cn.md](README_cn.md)

## Table Of Contents

- [Why](#why)
- [Features](#features)
- [Current Scope](#current-scope)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Usage](#usage)
- [Architecture](#architecture)
- [Development](#development)
- [Testing](#testing)
- [Packaging](#packaging)
- [Privacy And Security](#privacy-and-security)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [License](#license)

## Why

Most page-translation extensions either replace the original text or hide too much of the original page structure. metatranslation takes a conservative route:

- Preserve the source DOM wherever possible.
- Inject translations as adjacent lines instead of replacing source text.
- Use model-returned source-span alignment for hover highlighting.
- Skip unsafe or ambiguous blocks instead of guessing.
- Keep provider calls, DOM extraction, rendering, storage, and records UI modular.

## Features

- Manual translation through the extension action button or page context menu.
- Top-to-bottom text discovery for headings, paragraphs, list items, links, buttons, and supported input buttons.
- Original DOM text remains in place; injected translations inherit source font, size, line height, color, and text decoration.
- Links, buttons, dense flex/grid layouts, and absolute/fixed labels use an internal second-line strategy to avoid crowding horizontal UI.
- Progressive concurrent translation: completed chunks render immediately without waiting for the full page queue.
- Incremental `MutationObserver` updates for SPA changes, local rerenders, and appended content.
- Full-page navigation resets the current-document translation state so the context menu returns to `翻译本页` for the new document.
- Hover highlighting between source words or phrases and translated spans using validated model alignments.
- Source-hover dictionary popup backed by WiktApi or FreeDictionaryAPI, with local lookup caching and source links.
- Vocabulary recording after a stable 2-second source-side hover, with aggregate word frequency and event history.
- Options page for provider settings, target language, concurrency, retries, dictionary behavior, record search, sorting, and CSV export.
- IndexedDB translation cache, dictionary cache, aggregate word records, and word-event history.
- CSV export includes a UTF-8 BOM and neutralizes spreadsheet formula prefixes.
- Repeatable build, test, browser smoke, E2E, and zip packaging scripts.

## Current Scope

- Supported browsers: desktop Chrome and Edge with Manifest V3.
- Supported install mode: unpacked extension from `dist`.
- Unsupported in v1: Firefox, Safari, default all-site auto-translation, and local heuristic alignment fallback.
- Translation API shape: OpenAI-compatible `chat/completions`.
- Alignment policy: model-only alignment. Invalid output is retried and then skipped rather than guessed.

## Quick Start

### Requirements

- Node.js `20.19+` or `22.12+`.
- npm.
- Desktop Chrome, Edge, Chromium, or Chrome for Testing.
- An OpenAI-compatible translation provider key.

### Install Dependencies

```bash
npm install --cache .npm-cache
```

### Build

```bash
npm run build
```

### Load The Extension

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this repository's `dist` directory.
5. Open the extension options page.
6. Configure `Base URL`, `API Key`, `Model`, and `Target Language`.
7. Open any normal `http` or `https` page.
8. Click the extension action button or the page context-menu item to translate the page.

## Configuration

The extension calls an OpenAI-compatible `chat/completions` endpoint. A provider root URL such as `https://openrouter.ai/api/v1` is accepted; trailing slashes are trimmed and `/chat/completions` is appended unless already present.

| Option | Default | Notes |
| --- | --- | --- |
| `Base URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible provider root or full chat completions URL. |
| `API Key` | empty | Stored in `chrome.storage.local`; never commit real keys. |
| `Model` | `x-ai/grok-4.1-fast` | Model used for translation and source-span alignment. |
| `Target Language` | `zh-CN` | Injected into the provider prompt as the authoritative target language. |
| `Timeout (ms)` | `30000` | Per-request timeout. |
| `Request Chunk Size` | `1` | Number of text blocks per provider request. |
| `Parallel Requests` | `64` | Maximum concurrent content-runtime translation requests. |
| `Context Window Chars` | `100` | Adjacent source context sent for disambiguation; `0` disables adjacent context. |
| `Retry Count` | `2` | Retries after the first failed or invalid model call; `0` disables retry passes. |
| `Tolerant Provider Output` | on | Keeps valid text when imperfect model JSON can be safely recovered. Turn it off for strict provider-contract debugging. |
| `Dictionary Provider` | `WiktApi` | `WiktApi`, `FreeDictionaryAPI`, or `Off`. |
| `WiktApi Edition` | `en` | Wiktionary edition for WiktApi lookup. |
| `Dictionary Hover Hold (ms)` | `1000` | Keep-alive window while moving from source text to the dictionary popup; `0` closes immediately. |

Provider request details:

- Sends `response_format: { type: "json_schema", json_schema: ... }`.
- Sends `reasoning: { "effort": "none" }` by default.
- Does not send `reasoning_split`.
- Keeps OpenRouter-specific headers isolated in provider-header logic.
- Treats webpage text, adjacent context, and page URL as untrusted data in the provider prompt.
- Uses three multilingual format-only alignment examples, and reports fine-grained provider-output failure counts plus aggregate alignment coverage in background diagnostics.

## Usage

- Trigger translation manually with the action button or page context menu.
- Trigger again on the same document to disable and remove injected nodes.
- Navigate to a new document and trigger translation again; full-page navigation resets the previous page state.
- Hover a source span or translated span to highlight the aligned counterpart.
- Hover a source span for 2 seconds to record vocabulary when a valid alignment exists.
- Hover a source span to open the dictionary popup when dictionary lookup is enabled.
- Use the options page to search, sort, and export vocabulary records.
- If translation appears to do nothing, check the bottom-right diagnostic panel. No panel means the runtime did not inject; an error panel usually means provider failure; high skipped counts mean invalid or empty model output.

## Architecture

```text
Chrome action / context menu
        |
        v
background service worker
  - settings
  - provider calls
  - translation cache
  - dictionary lookup
  - vocabulary records
        |
        v
content runtime
  - TreeWalker extraction
  - MutationObserver dirty tracking
  - translation rendering
  - hover/highlight mapping
  - source-hover record timer
        |
        v
options page
  - provider settings
  - runtime tuning
  - records search/sort/export
```

Key paths:

- `manifest.config.ts`: MV3 manifest definition.
- `src/background/index.ts`: service worker, action/context-menu handling, message routing, cache orchestration, records entrypoints.
- `src/background/openai.ts`: OpenAI-compatible request builder, JSON extraction, retries, output validation.
- `src/background/dictionary.ts`: WiktApi and FreeDictionaryAPI lookup normalization.
- `src/background/db.ts`: IndexedDB stores for translation cache, dictionary cache, word records, and word events.
- `src/content/injected.ts`: injected runtime, DOM extraction, mutation tracking, rendering, hover mapping, highlight overlay, record timer.
- `src/lib/alignment.ts`: alignment sanitization and validation.
- `src/lib/sourceSpans.ts`: source-span generation for provider prompts.
- `src/lib/settings.ts`: settings normalization.
- `src/options/main.ts`: options and records UI behavior.
- `scripts/`: build, packaging, unit, smoke, mock E2E, real E2E, and live-page smoke helpers.
- `docs/TECHNICAL_PLAN.md`: current technical route, validation status, risks, and next steps.
- `AGENTS.md`: coding-agent workflow and project rules.

## Development

Use the repository scripts and local dependencies. Avoid ad hoc global tooling when a project script exists.

```bash
npm install --cache .npm-cache
npm run test:unit
npm run build
npm test
```

Common commands:

| Command | Purpose |
| --- | --- |
| `npm run build` | Type-check and build the extension into `dist`. |
| `npm run test:unit` | Run focused module checks. |
| `npm test` | Run unit checks and build. |
| `npm run smoke:test` | Load the built extension in a browser and verify basic registration/UI. |
| `npm run e2e:mock` | Run browser E2E with a local mock provider. |
| `npm run e2e:page` | Run a real-page smoke test with mock or real provider. |
| `npm run e2e:real` | Run fixture-based E2E against a configured real provider. |
| `npm run package:zip` | Rebuild and produce `artifacts/metatranslation-<version>.zip`. |

## Testing

Focused checks:

```bash
npm run test:unit
```

Current coverage includes alignment validation, translated-part provider schema checks, source-span handling, tolerant output recovery, dictionary provider parsing, OpenRouter header compatibility, JSON extraction, settings normalization, and CSV escaping.

Build verification:

```bash
npm run build
```

Browser smoke test:

```bash
BROWSER_BIN="/path/to/Chromium-or-Chrome-for-Testing" npm run smoke:test
```

Mock provider browser E2E:

```bash
BROWSER_BIN="/path/to/Chrome for Testing" npm run e2e:mock
```

Live page smoke with local mock provider:

```bash
BROWSER_BIN="/path/to/Chrome for Testing" \
PAGE_SMOKE_URL="https://www.reddit.com/r/MachineLearning/comments/b179cs/d_the_bitter_lesson/" \
npm run e2e:page
```

Live page smoke with real provider:

```bash
BROWSER_BIN="/path/to/Chrome for Testing" \
PAGE_SMOKE_PROVIDER="real" \
PAGE_SMOKE_URL="https://vision-banana.github.io/" \
PAGE_SMOKE_BASE_URL="https://openrouter.ai/api/v1" \
PAGE_SMOKE_KEY="..." \
PAGE_SMOKE_MODEL="x-ai/grok-4.1-fast" \
PAGE_SMOKE_REQUIRE_CJK="1" \
npm run e2e:page
```

Real API fixture E2E:

```bash
BROWSER_BIN="/path/to/Chrome for Testing" \
REAL_TEST_BASE_URL="https://provider.example/v1" \
REAL_TEST_KEY="..." \
REAL_TEST_MODEL="model-id" \
REAL_TEST_TARGET_LANG="zh-CN" \
npm run e2e:real
```

Automation note: use Chromium or Chrome for Testing. Some branded Google Chrome builds reject `--load-extension` in automated contexts.

## Packaging

```bash
npm run package:zip
```

The package script rebuilds the extension and writes `artifacts/metatranslation-<version>.zip`. Keep generated archives out of git.

### Automated GitHub Releases

Pushing to `main` with a changed `package.json` `version` runs the `Release on package version change` workflow. The workflow compares the previous and current package versions; when the version changes, it installs dependencies with `npm ci`, verifies the root `package-lock.json` version, runs `npm run test:unit`, runs `npm run package:zip`, creates tag `v<version>`, and publishes a GitHub Release with `artifacts/metatranslation-<version>.zip`.

If `package.json` changes but the `version` value is unchanged, the workflow exits without publishing. When bumping a release version, keep `package-lock.json` synchronized and ensure no existing `v<version>` tag already exists.

## Privacy And Security

- Page text selected for translation is sent to the configured provider.
- API keys are stored in `chrome.storage.local`.
- Translation cache, dictionary cache, word records, and word events are stored locally in IndexedDB.
- The extension does not intentionally send records or cache contents to any service other than the configured translation provider and dictionary providers.
- Dictionary lookup sends the hovered source word plus language metadata to the selected dictionary provider.
- CSV export contains webpage text and URLs; review before sharing.
- Do not commit real API keys, screenshots containing private pages, browser profiles, or generated artifacts.

## Contributing

Before opening a change:

1. Read [AGENTS.md](AGENTS.md) for repository conventions.
2. Keep English Markdown documents and matching `*_cn.md` translations synchronized.
3. Use focused module tests for logic changes and browser tests for extension behavior changes.
4. Run at least `npm run test:unit` and `npm run build`.
5. Do not introduce provider-specific behavior unless the tradeoff has been discussed.
6. Do not add heuristic local alignment fallback unless explicitly requested.
7. Bump `package.json` and `package-lock.json` together when preparing a GitHub Release.
8. Keep generated files such as `dist/`, `artifacts/`, `.npm-cache/`, screenshots, and profiles untracked.

## Roadmap

- Add focused tests for content-runtime extraction boundaries.
- Add optional debug export for skipped blocks and invalid provider output.
- Improve release metadata before publishing, including a license file, changelog, and privacy policy.
- Re-run real-provider E2E after prompt or output-contract changes.
- Continue tuning page-layout handling through real-page smoke tests instead of site-specific hacks.

## License

No license file is currently included. Add an explicit `LICENSE` file before public open-source distribution.
