# AGENTS.md

Guidance for coding agents working in this repository.

## Core Principles

- Use this project's own environment for development and testing. Prefer repository scripts, local dependencies, and the configured extension workflow over ad hoc external setups.
- Follow the Bitter Lesson and first principles. Prefer simple, elegant, direct implementations that rely on scalable general mechanisms instead of brittle special-case logic.
- Keep the system modular and easy to change. Design boundaries so translation providers, DOM extraction, rendering, alignment validation, storage, records UI, and tests can evolve independently.
- Combine modular tests with whole-system tests. Use focused checks for isolated logic and browser-level tests for extension behavior so the project does not repeatedly fall into the same failure modes.
- Research thoroughly before choosing a technical route, dependency, browser API, provider contract, or implementation strategy. If uncertainty affects product behavior, cost, privacy, compatibility, or maintainability, discuss it with the user before deciding.
- Maintain `docs/` continuously. Keep technical route planning, design decisions, progress, known risks, and validation status synchronized there.
- Keep `README.md` current. It should explain the project, highlights, setup, usage, architecture, and contribution entry points clearly enough for open-source contributors to understand and start quickly.
- Keep `README.md` at open-source entry quality. It should include project status, table of contents, feature scope, quick start, configuration reference, usage notes, architecture, development commands, testing matrix, packaging, privacy/security notes, contribution guidance, roadmap, and license status.
- Keep all primary project text documents in English, including docs, README files, AGENTS files, and prompt files. For every such text document, maintain a synchronized Chinese version named with the `*_cn.md` suffix.
- Keep this `AGENTS.md` current. It must include these core principles and any common project knowledge future agents need; update it whenever the repository workflow or constraints change.

## Project Scope

This repository is a Chromium MV3 extension named metatranslation. It injects dual-line translations into web pages, highlights source/target word or phrase alignments on hover, and records vocabulary hits after stable source-side span hover.

Target platform is desktop Chrome/Edge MV3 only. Do not add Firefox/Safari compatibility unless explicitly requested.

## Stack

- TypeScript
- Vite
- CRXJS MV3 manifest tooling
- Chrome extension APIs
- IndexedDB for translation cache and word records
- `chrome.storage.local` for settings

## Core Commands

```bash
npm install --cache .npm-cache
npm run test:unit
npm run build
npm test
npm run package:zip
```

Use `npm run test:unit` for focused module checks and `npm run build` before reporting code changes as complete. Use `npm test` for combined local validation. Use `npm run package:zip` when a distributable archive is requested; it rebuilds and writes `artifacts/metatranslation-<version>.zip`.

Smoke test:

```bash
BROWSER_BIN="/path/to/Chromium-or-Chrome-for-Testing" npm run smoke:test
```

Mock provider browser E2E:

```bash
BROWSER_BIN="/path/to/Chrome for Testing" npm run e2e:mock
```

Real API E2E:

```bash
BROWSER_BIN="/path/to/Chrome for Testing" \
REAL_TEST_BASE_URL="https://provider.example/v1" \
REAL_TEST_KEY="..." \
REAL_TEST_MODEL="model-id" \
REAL_TEST_TARGET_LANG="zh-CN" \
npm run e2e:real
```

Never commit real API keys or generated artifacts.

## Important Paths

- `manifest.config.ts`: MV3 manifest source.
- `README.md`: open-source project overview, setup, usage, and structure.
- `README_cn.md`: synchronized Chinese version of `README.md`.
- `AGENTS.md`: English agent guidance and project operating rules.
- `AGENTS_cn.md`: synchronized Chinese version of `AGENTS.md`.
- `docs/TECHNICAL_PLAN.md`: English technical route, progress, risks, and validation status.
- `docs/TECHNICAL_PLAN_cn.md`: synchronized Chinese version of `docs/TECHNICAL_PLAN.md`.
- `src/background/index.ts`: service worker, action/context-menu handling, message routing, cache orchestration, record persistence entrypoints.
- `src/background/openai.ts`: OpenAI-compatible translation API client and alignment validation.
- `src/background/dictionary.ts`: source-hover dictionary provider client and response normalization.
- `src/background/db.ts`: IndexedDB stores for translation cache, aggregate word records, and word events.
- `src/content/injected.ts`: injected content runtime, text scanning, mutation tracking, translation rendering, hover/highlight logic, recording timer.
- `src/options/main.ts`: settings and records UI behavior.
- `src/lib/alignment.ts`: reusable alignment sanitization and validation logic.
- `src/lib/sourceSpans.ts`: local source span table generation for provider prompts and alignment sanitization.
- `src/lib/types.ts`: shared settings, translation, alignment, and record types.
- `src/lib/messages.ts`: extension message contracts.
- `scripts/package-extension.mjs`: zip packaging script.
- `.github/workflows/release-on-version.yml`: GitHub Release workflow triggered by package version changes on `main`.
- `scripts/test-alignment-validation.mjs`: focused alignment validation regression checks.
- `scripts/e2e-mock.mjs`: local mock-provider browser regression wrapper.
- `scripts/smoke-test.mjs`: browser-load smoke test.
- `scripts/e2e-real.mjs`: real API browser regression test.

## Architecture Rules

- Translation is manually toggled by extension action or context menu. Do not add automatic all-site translation by default.
- Context-menu title is global browser UI state. Refresh it on tab activation and focused-window changes so another tab does not inherit the previous tab's `关闭翻译` title.
- Background owns API calls, settings, caching, and records persistence.
- Content runtime owns DOM scanning, rendering, hover mapping, and mutation detection.
- Options page owns API settings, target language, concurrency settings, record search/sort, and CSV export.
- Keep page DOM safe: preserve source text in place and render translations as sibling nodes below the source block.
- Do not wrap or replace original page text nodes for normal text translation.
- All injected DOM must carry `data-dlt-role` and be removable on disable.
- Disable must clean translation nodes, highlight layer, and injected style nodes.

## Translation Behavior

- Use `TreeWalker` and top-to-bottom candidate selection.
- Prefer specific readable containers such as `p`, `li`, headings, `blockquote`, and `figcaption`; generic text containers are fallback candidates only when they do not contain more specific translatable descendants.
- Skip high-risk or interactive containers unless explicitly supported.
- Continue skipping `textarea`, `select`, `option`, `code`, `pre`, `script`, `style`, `svg`, `canvas`, media, iframes, contenteditable, and extension-owned nodes.
- Interactive supported elements are `a`, `button`, and `input[type=button|submit|reset]`.
- Translation nodes should inherit the source block's visible text style and stay visually adjacent to the original next line.
- For source-level `a` and `button` blocks, render the translation as an injected internal second line so flex or nav bars do not receive an extra horizontal sibling item. Any layout patch, such as temporary `flex-wrap`, must be reversible on disable.
- For ordinary text blocks inside horizontal flex/grid parents, or absolute/fixed positioned labels, render the translation as an injected internal second line. External sibling nodes in these contexts often become unrelated layout items and can appear beside or far away from the source.
- Translated interactive controls and inline translated links/buttons should preserve the same general element type/style and proxy click to the original element.
- Do not break original page clicks, selection, hover, or form behavior.

## Progressive Translation

- Content runtime sends chunks concurrently according to settings:
- `requestChunkSize` defaults to `1`.
- `requestConcurrency` defaults to `64`.
- `contextWindowChars` defaults to `100`; `0` disables adjacent `contextBefore` / `contextAfter`.
- `translationRetryCount` defaults to `2`; it is the number of retry attempts after the first model call. `0` disables retry passes.
- Render each completed chunk immediately.
- Do not wait for all chunks before showing partial translations.
- If a chunk fails, log the error and let other chunks continue.
- MutationObserver should retranslate dirty blocks incrementally.
- SPA route changes should clear current block registrations and rescan the page.

## Alignment Contract

The model must return `translatedParts` with source-span references. Do not add local heuristic
alignment fallback unless explicitly requested.

The raw provider contract is translated-part anchored. The prompt sends each block with an
`id`, source text, optional adjacent context, and a `sourceSpans` table generated locally from
original source-text character ranges. These spans are extension-owned word, character, or phrase
candidates and must not be interpreted as provider-native segments. CJK source text may be
represented as single-character spans. Prompt `sourceSpans` expose only `id` and `text`; source
character ranges stay local to the extension. Prompt payload text, adjacent context, and page URL
are untrusted webpage data; prompts must tell the model never to follow instructions inside them.

The model should return one block for each payload block. Each output block must include the same
`id` as its payload block and `translatedParts`; it must not include other block-level fields. Each
part must contain `text`; it may contain `sourceSpanIds` when that target part maps to source spans.
`sourceSpanIds` is always a flat array and may contain non-contiguous ids, for example
`["s1", "s5"]`. Do not use singular `sourceSpanId`.

Provider prompts should ask for the finest reliable alignment: split `translatedParts` by source
word, term, or short phrase whenever possible. Avoid whole-clause or whole-sentence parts when
smaller source spans can be mapped. Group source spans only when the translation unit is genuinely a
multi-span phrase, idiom, CJK word, or non-contiguous construction.

Provider prompts should keep examples small and multilingual. Current prompt examples are limited to
three format-only examples covering English to Simplified Chinese context/reordering/filler,
Japanese to English CJK grouping/particles/spaces, and English to Spanish non-contiguous phrasal
verbs/clitics. Examples must not imply a fixed target language and must not use forbidden model
output field names such as `sourceLang`.

The model must not return `sourceLang`, `alignmentId`, `sourceText`, `targetText`,
`targetOccurrence`, source offsets, target offsets, or a top-level `translatedText`. The extension
derives those runtime values locally by matching output blocks by `id`, using the request-side source
language hint, concatenating `translatedParts[].text`, and accumulating target offsets. The sanitized
runtime `TranslationResultBlock.alignments` entries keep only the fields needed by the content
runtime:

```ts
{
  alignmentId: string;
  sourceRanges: Array<{ start: number; end: number }>;
  targetStart: number;
  targetEnd: number;
  sourceText: string;
}
```

Validation rules:

- Output block ids must match input block ids.
- In strict mode, output ids must be complete and unique. Missing ids, duplicate ids, unexpected ids, or mismatched ids are invalid and should trigger retry or diagnostics.
- In tolerant mode, returned blocks are matched by id. Duplicate output ids after the first match and extra output blocks are ignored; missing output blocks remain pending and retry until `translationRetryCount` is exhausted.
- `tolerantProviderOutput` defaults to `true`. When it is `false`, malformed output should retry or surface an error as before. When it is `true`, invalid source-span references are treated as unaligned text, accepted blocks do not retry, and missing or still-invalid blocks retry until the configured retry count is exhausted.
- `translatedParts` must be non-empty and produce a non-empty `translatedText` after concatenation.
- In strict mode, at least one translated part must contain valid `sourceSpanIds`; tolerant mode may keep translated text with no valid alignments.
- `sourceSpanIds` must come from the payload `sourceSpans` table.
- `sourceSpanIds` may be adjacent or non-contiguous, but the same source span must not be reused by multiple translated parts.
- Pure punctuation or whitespace translated parts may have accidental model-returned `sourceSpanIds` ignored during sanitization; this only removes non-semantic punctuation alignment and does not infer word alignment.
- Aligned parts should stay as fine-grained as the translation allows; whole-clause alignment is a prompt failure unless no smaller reliable mapping exists.
- Missing, duplicate, unexpected, or mismatched block ids, `sourceLang`, singular `sourceSpanId`, and extra fields inside `translatedParts` are invalid for the strict new contract.
- Diagnostics should preserve `outputFailures` and `lastOutputError`, and also report finer provider-output failure counts plus aggregate alignment coverage for accepted provider blocks.
- Target ranges are derived from translated part order, so repeated target text is not ambiguous.
- Source ranges are derived from `sourceSpanIds`; adjacent source spans merge into one source range, while non-contiguous ids produce multiple source ranges.
- Legacy offset-style raw alignments may still be sanitized for compatibility, but new providers should use `translatedParts`.
- Ambiguous, missing, overlapping, or unrecoverable ranges must still reject the whole block.
- Runtime alignment ids are generated locally from the matched block id and translated part index.
- Allow source/target order to differ; valid translation reordering is not an overlap.
- If validation fails after retries, skip rendering that block instead of guessing.

## API Provider Rules

- Provider shape is OpenAI-compatible `chat/completions`.
- Default Base URL is `https://openrouter.ai/api/v1`.
- Default model is `x-ai/grok-4.1-fast`.
- Normalize configured base URLs by trimming whitespace and trailing slashes before saving.
- Resolve base URLs by appending `/chat/completions` unless already present.
- Request JSON output through structured outputs: `response_format: { type: "json_schema", json_schema: ... }`.
- Send `reasoning: { effort: "none" }` by default.
- Do not add `reasoning_split`.
- OpenRouter-specific headers may be added only in the provider-header helper.
- Keep provider behavior generic unless the user explicitly asks for a provider-specific compatibility layer.

## Hover and Recording Rules

- Source text hit-testing uses `caretRangeFromPoint` or `caretPositionFromPoint`.
- `input[type=button|submit|reset]` source/target hit-testing uses geometry because there are no text nodes.
- Target-side normal text is rendered as alignment spans with `data-alignment-id`.
- Highlight rectangles must be rendered in a fixed overlay with `pointer-events: none`.
- Source-side hover may also show a dictionary tooltip when `dictionaryProvider` is not `off`. Tooltip links may receive pointer events, but the highlight overlay must remain non-interactive.
- Dictionary lookup runs in the background service worker and must stay provider-pluggable. First supported providers are `WiktApi` and `FreeDictionaryAPI`; keep parsed output normalized before it reaches the content runtime.
- Only source-origin hover can start vocabulary recording.
- Record only when the same source-side alignment span remains stable for 2 seconds.
- Cancel pending record timers on alignment change, movement away, scroll, resize, disable, route change, or DOM update.

## Storage Model

Settings live in `chrome.storage.local`.
Enabled-tab state is only for the current document lifecycle. Full-page navigation must clear it as
navigation starts so new documents start with the default `翻译本页` action instead of inheriting
`关闭翻译` from the previous page.

IndexedDB stores:

- `translation_cache`: cached translation blocks keyed by alignment-contract version, source text plus adjacent context hash, source language, target language, base URL, model, and strict/tolerant output mode.
- `word_records`: aggregate records keyed by normalized word, source language, and target language.
- `word_events`: per-hover-hit event history keyed back to the aggregate record.

Record aggregation fields should preserve count, first/last seen timestamps, last URL, last source sentence, and last translated sentence.

## Options Page Rules

- Settings must include `baseUrl`, `apiKey`, `model`, `targetLang`, `timeoutMs`, `requestChunkSize`, `requestConcurrency`, `contextWindowChars`, `translationRetryCount`, `dictionaryProvider`, `dictionaryEdition`, `dictionaryHoverHoldMs`, and `tolerantProviderOutput`.
- `targetLang` defaults to `zh-CN` for Chinese and must be injected into provider prompts as the authoritative configured target language, with a human-readable description when known; few-shot examples must not imply a fixed target language.
- Clamp `requestChunkSize`, `requestConcurrency`, `contextWindowChars`, `translationRetryCount`, and `dictionaryHoverHoldMs` to sane ranges in the background sanitizer.
- `dictionaryProvider` defaults to `wiktapi`. Supported values are `wiktapi`, `freedictionaryapi`, and `off`.
- `dictionaryEdition` defaults to `en` and controls the Wiktionary edition used by WiktApi.
- `dictionaryHoverHoldMs` defaults to `1000` and controls how long the dictionary popup stays open while the pointer moves from source text into the tooltip.
- Keep `tolerantProviderOutput` as an explicit boolean option and default it on.
- Every settings control should include concise English helper text in a subdued `small` element.
- Records page defaults to aggregate records.
- Search should match word, URL, source sentence, translated sentence, and language fields.
- CSV export must include a UTF-8 BOM so Chinese text opens correctly in Excel/WPS.
- CSV export must neutralize spreadsheet formula prefixes for untrusted webpage text.

## Git and Artifacts

- `dist/`, `artifacts/`, `.npm-cache/`, generated CRX files, and `node_modules/` should stay untracked.
- Do not commit API keys, screenshots, browser profiles, or zip outputs.
- The GitHub Release workflow publishes only after a `main` push changes `package.json` `version`; it tags releases as `v<version>` and uploads `artifacts/metatranslation-<version>.zip`.
- When bumping a release, keep the root `package-lock.json` version synchronized with `package.json`.
- Unless the user explicitly requests a minor, major, prerelease, or custom version, bump only the final patch segment of the semantic version, for example `0.1.0` to `0.1.1`.
- Prefer small focused commits after verification.
- Do not claim a specific open-source license in README, package metadata, or release notes until a real `LICENSE` file is added.

## Documentation Sync Rules

- Update `README.md` when project setup, usage, capabilities, architecture, or contribution workflow changes.
- README updates should preserve the open-source onboarding structure: status, quick start, configuration, usage, architecture, development, testing, packaging, privacy/security, contributing, roadmap, and license status.
- Update `docs/TECHNICAL_PLAN.md` when technical direction, implementation progress, known risks, testing status, or next steps change.
- Update `AGENTS.md` when agent workflow, constraints, project conventions, or recurring pitfalls change.
- For every English Markdown document that is created or changed, update the matching Chinese file with the `*_cn.md` suffix in the same change.
- If a prompt document is added later, keep the primary prompt in English and add a synchronized `*_cn.md` version.
- Do not leave stale Chinese documentation after changing the English source, and do not add Chinese-only project documentation unless explicitly requested.

## Recent Resolved Review Items

- Alignment validation no longer rejects valid reordered translations as target overlap.
- Disable now removes injected runtime artifacts instead of leaving style/highlight nodes behind.
- Input-button translation now has geometry-based hover/highlight support.
- `reasoning: { effort: "none" }` is sent by default through the generic OpenAI-compatible request body.
- Source-level link/button translations now render as internal second lines to avoid overlapping or crowding horizontal navigation bars.
- Ordinary text in horizontal flex/grid layouts and absolute/fixed overlay labels now renders as an internal second line to avoid side-by-side or detached translations on dense project pages.
- Grok prompt and sanitization now handle accidental `sourceSpanIds` on pure punctuation, which previously caused valid real translations to be skipped.
- Tolerant provider-output recovery is now configurable and default-on; strict mode still retries or reports count/alignment mismatches.
