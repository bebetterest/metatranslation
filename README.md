# metatranslation

<p align="center">
  <img src="docs/assets/metatranslation-header.png" alt="metatranslation preserves source webpage text, renders translations underneath, and links aligned phrases on hover" width="100%">
</p>

<p align="center">
  Dual-line webpage translation for desktop Chrome and Edge. Preserve source text, render translations underneath, highlight model alignments on hover, and record vocabulary from stable source-side hovers.
</p>

<p align="center">
  <a href="README_cn.md">Chinese documentation</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#testing-matrix">Testing</a> ·
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img alt="Status: active prototype" src="https://img.shields.io/badge/status-active%20prototype-0f766e">
  <img alt="Platform: Chrome and Edge MV3" src="https://img.shields.io/badge/platform-Chrome%2FEdge%20MV3-2563eb">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6.x-3178c6">
  <img alt="License: not selected" src="https://img.shields.io/badge/license-not%20selected-lightgrey">
</p>

> Status: active prototype. The extension is useful for local development and unpacked-extension testing. Public distribution still needs an explicit `LICENSE` file, release notes or changelog, and a final privacy review.

## Table Of Contents

- [Project Status](#project-status)
- [Highlights](#highlights)
- [Feature Scope](#feature-scope)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Usage](#usage)
- [Architecture](#architecture)
- [Development](#development)
- [Testing Matrix](#testing-matrix)
- [Packaging And Releases](#packaging-and-releases)
- [Privacy And Security](#privacy-and-security)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [License](#license)

## Project Status

metatranslation is a Chromium Manifest V3 extension focused on reading workflows where the original page still matters. It does not replace source text. Instead, it injects translated lines beside the original reading flow, uses model-returned source-span alignment for hover highlighting, and records vocabulary only after a stable source-side hover.

Current release posture:

- Target browsers: desktop Chrome and Edge with Manifest V3.
- Install mode: local unpacked extension from the generated `dist` directory.
- API shape: OpenAI-compatible `chat/completions`.
- Alignment policy: model-only alignment. Invalid blocks are retried and then skipped instead of guessed.
- Release readiness: packaging and GitHub Release automation exist, but public distribution is blocked on license, release notes, and privacy review.

## Highlights

- Preserves original webpage text and injects translations as the next visual line.
- Translates progressively with concurrent chunk requests; completed chunks render immediately.
- Validates translated-part model output before using hover alignments.
- Keeps webpage text, adjacent context, and page URLs framed as untrusted data in provider prompts.
- Supports source and target hover highlighting, source-hover dictionary lookup, and vocabulary recording.
- Localizes the manifest, context menu, options page, in-page diagnostics, and dictionary popup in English and Simplified Chinese through Chrome i18n.
- Stores settings in `chrome.storage.local` and cache or records data in IndexedDB.
- Provides focused unit checks, browser smoke tests, mock-provider E2E, real-provider E2E, and package automation.

## Feature Scope

| Area | Current behavior |
| --- | --- |
| Activation | Manual toggle through extension action or page context menu. No default all-site auto-translation. |
| Extraction | Conservative top-to-bottom `TreeWalker` discovery for headings, paragraphs, list items, links, buttons, and supported input buttons. |
| Rendering | Source DOM text remains in place. Translation nodes inherit source text style and are removable on disable. Dense flex/grid and overlay labels use internal second-line rendering. |
| Translation | OpenAI-compatible provider calls with structured JSON schema output, configurable target language, context window, concurrency, chunk size, timeout, and retry count. |
| Alignment | The model returns `translatedParts[].sourceSpanIds`; the extension derives runtime source and target ranges locally. Strict and tolerant validation modes are supported. |
| Dictionary | Source-hover dictionary popup can use WiktApi, FreeDictionaryAPI, or be turned off. Dictionary lookup keeps original word casing, queries Latin words in English before all-language fallback, ranks all-language results by likely source language, and caches normalized results locally. |
| Records | Stable 2-second source-side hover records vocabulary hits, aggregate counts, last seen context, URL, and event history. |
| Export | Records CSV export includes a UTF-8 BOM and neutralizes spreadsheet formula prefixes from untrusted page text. |
| Diagnostics | In-page status panel plus background diagnostics for skipped blocks, failed chunks, provider-output failure categories, and alignment coverage. |
| UI Language | Extension UI follows the browser UI language. English is the default locale and Simplified Chinese is supported; this is independent of `Target Language`. |

Unsupported in the current scope:

- Firefox and Safari.
- Default all-site automatic translation.
- Local heuristic alignment fallback.
- Public store distribution packaging.

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
7. Open a normal `http` or `https` page.
8. Click the extension action button or page context-menu item to translate the page.

## Configuration

The extension calls an OpenAI-compatible `chat/completions` endpoint. A provider root URL such as `https://openrouter.ai/api/v1` is accepted; trailing slashes are trimmed and `/chat/completions` is appended unless already present.

The extension UI language follows Chrome or Edge's UI language through `_locales`. Changing UI language does not change `Target Language`; that setting still controls the translation output sent to the provider prompt.

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
| `Dictionary Hover Hold (ms)` | `1000` | Keep-alive window while moving from source text to the dictionary popup; `0` closes immediately. |

Provider request details:

- Sends `response_format: { type: "json_schema", json_schema: ... }`.
- Sends `reasoning: { "effort": "none" }` by default.
- Does not send `reasoning_split`.
- Keeps OpenRouter-specific headers isolated in provider-header logic.
- Treats webpage text, adjacent context, and page URL as untrusted data in the provider prompt.
- Uses three multilingual format-only alignment examples.
- Reports fine-grained provider-output failure counts plus aggregate alignment coverage in background diagnostics.

## Usage

- Trigger translation manually with the action button or page context menu.
- Trigger again on the same document to disable and remove injected nodes.
- Navigate to a new document and trigger translation again; full-page navigation resets the previous page state.
- Hover a source span or translated span to highlight the aligned counterpart.
- Hover a source span for 2 seconds to record vocabulary when a valid alignment exists.
- Hover a source span to open the dictionary popup when dictionary lookup is enabled.
- Use the options page to search, sort, and export vocabulary records.
- Use the browser UI language to switch extension UI between English and Simplified Chinese. Keep `Target Language` for translation output only.
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
- `public/_locales/*/messages.json`: English and Simplified Chinese UI strings for manifest, context menus, options, diagnostics, and dictionary popup.
- `docs/assets/metatranslation-header.png`: README header image.
- `src/background/index.ts`: service worker, action/context-menu handling, message routing, cache orchestration, records entrypoints.
- `src/background/openai.ts`: OpenAI-compatible request builder, JSON extraction, retries, output validation.
- `src/background/dictionary.ts`: WiktApi and FreeDictionaryAPI lookup normalization.
- `src/background/db.ts`: IndexedDB stores for translation cache, dictionary cache, word records, and word events.
- `src/content/injected.ts`: injected runtime, DOM extraction, mutation tracking, rendering, hover mapping, highlight overlay, record timer.
- `src/lib/alignment.ts`: alignment sanitization and validation.
- `src/lib/sourceSpans.ts`: source-span generation for provider prompts.
- `src/lib/settings.ts`: settings normalization.
- `src/lib/i18n.ts`: shared options/background helper for Chrome i18n message lookup.
- `src/options/main.ts`: options and records UI behavior.
- `scripts/`: build, packaging, unit, smoke, mock E2E, real E2E, and live-page smoke helpers.
- `docs/TECHNICAL_PLAN.md`: current technical route, validation status, risks, and next steps.
- `AGENTS.md`: coding-agent workflow and project rules.

## Development

Use the repository scripts and local dependencies. Avoid ad hoc global tooling when a project script exists. The TypeScript build runs with strict unused-code checks. `package.json` keeps an npm override for `rollup@2.80.0` because `@crxjs/vite-plugin@2.4.0` depends on an older vulnerable Rollup 2 build.

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

## Testing Matrix

| Layer | Command | Purpose |
| --- | --- | --- |
| Focused unit checks | `npm run test:unit` | Alignment validation, provider schema, prompt contract, dictionary parsing, settings normalization, diagnostics, CSV escaping, and i18n locale completeness. |
| Type-check and build | `npm run build` | Confirms TypeScript and Vite can build the MV3 extension into `dist`. |
| Combined local validation | `npm test` | Runs focused checks and build in one command. |
| Dependency audit | `npm audit --cache .npm-cache` | Checks installed dependency vulnerability status using the local npm cache. |
| Browser smoke | `BROWSER_BIN="/path/to/Chromium-or-Chrome-for-Testing" npm run smoke:test` | Loads the built extension and verifies basic registration/UI. |
| Mock-provider E2E | `BROWSER_BIN="/path/to/Chrome for Testing" npm run e2e:mock` | Exercises extension behavior without real API quota. |
| Live-page smoke | `BROWSER_BIN="/path/to/Chrome for Testing" PAGE_SMOKE_URL="https://example.com" npm run e2e:page` | Runs the extension against a live page with mock or real provider settings. |
| Real-provider fixture E2E | `BROWSER_BIN="/path/to/Chrome for Testing" REAL_TEST_BASE_URL="https://provider.example/v1" REAL_TEST_KEY="..." REAL_TEST_MODEL="model-id" npm run e2e:real` | Checks the configured provider through the extension background translation path. |

Automation note: use Chromium or Chrome for Testing. Some branded Google Chrome builds reject `--load-extension` in automated contexts.

## Packaging And Releases

```bash
npm run package:zip
```

The package script rebuilds the extension and writes `artifacts/metatranslation-<version>.zip`. Keep generated archives out of git.

Pushing to `main` with a changed `package.json` `version` runs the `Release on package version change` workflow. The workflow compares the previous and current package versions; when the version changes, it installs dependencies with `npm ci`, verifies the root `package-lock.json` version, runs `npm run test:unit`, runs `npm run package:zip`, creates tag `v<version>`, and publishes a GitHub Release with `artifacts/metatranslation-<version>.zip`.

If `package.json` changes but the `version` value is unchanged, the workflow exits without publishing. When preparing a release version, keep `package-lock.json` synchronized and ensure no existing `v<version>` tag already exists.

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
3. Update [docs/TECHNICAL_PLAN.md](docs/TECHNICAL_PLAN.md) when behavior, validation status, risks, or release posture changes.
4. Use focused module tests for logic changes and browser tests for extension behavior changes.
5. Run at least `npm run test:unit` and `npm run build`.
6. Do not introduce provider-specific behavior unless the tradeoff has been discussed.
7. Do not add heuristic local alignment fallback unless explicitly requested.
8. Bump `package.json` and `package-lock.json` together when preparing a GitHub Release.
9. Keep generated files such as `dist/`, `artifacts/`, `.npm-cache/`, screenshots, and profiles untracked.

## Roadmap

- Add focused tests for content-runtime extraction boundaries.
- Add optional debug export for skipped blocks and invalid provider output.
- Improve release metadata before publishing, including a license file, changelog, and privacy policy.
- Re-run real-provider E2E after prompt or output-contract changes.
- Continue tuning page-layout handling through real-page smoke tests instead of site-specific hacks.

## License

No license file is currently included. Add an explicit `LICENSE` file before public open-source distribution.
