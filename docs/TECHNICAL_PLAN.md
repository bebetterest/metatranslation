# Technical Plan

This document tracks the technical route, current progress, validation status, risks, and next steps for metatranslation. Keep this file synchronized with `docs/TECHNICAL_PLAN_cn.md`.

## Goals

- Preserve original webpage text and inject translations as the next line.
- Avoid breaking page interaction, selection, layout, and SPA updates.
- Use model-returned lexical alignments for hover highlighting.
- Record source-side vocabulary hits after stable hover.
- Keep provider integration OpenAI-compatible and configurable.
- Keep implementation modular enough for future provider, UI, storage, and extraction changes.

## First-Principles Route

- Preserve the source DOM instead of replacing it. This minimizes page breakage and makes disable cleanup deterministic.
- Treat translation, alignment validation, DOM rendering, hover mapping, and persistence as separate modules.
- Prefer conservative text extraction over aggressive coverage. Missing a risky block is better than breaking user interaction.
- Trust only validated model alignments. Skipping invalid blocks is safer than rendering wrong highlights or recording wrong vocabulary.
- Use browser-level tests for extension behavior because MV3 lifecycle, content-script injection, and page interaction cannot be fully validated by unit tests alone.

## Current Architecture

- MV3 service worker in `src/background/index.ts`.
- Translation API client and alignment validation in `src/background/openai.ts`.
- Reusable alignment sanitization in `src/lib/alignment.ts`.
- Source span table generation in `src/lib/sourceSpans.ts`.
- IndexedDB cache and records persistence in `src/background/db.ts`.
- Injected content runtime in `src/content/injected.ts`.
- Shared message and data types in `src/lib/`.
- Options page in `src/options/`.
- Packaging script in `scripts/package-extension.mjs`.
- GitHub Release automation in `.github/workflows/release-on-version.yml`.

## Implemented Capabilities

- Manual translation toggle through extension action and context menu.
- Conservative DOM block discovery with TreeWalker.
- Top-to-bottom visible text discovery covering headings, readable text blocks, links, buttons, and supported input buttons while still skipping high-risk containers.
- Sibling translation-node rendering immediately below source blocks, with source margin transferred after the injected line to keep the translation visually adjacent.
- Source-level link and button translations render as internal second lines with reversible flex-layout patches, preventing horizontal navigation bars from receiving extra sibling items that crowd or overlap the original controls.
- Ordinary text blocks inside horizontal flex/grid parents, plus absolute/fixed overlay labels, also render as internal second lines so translations stay attached to their source instead of becoming detached layout items.
- Translation nodes inherit the source block's visible text style, including font, size, line height, color, and text decoration. Inline translated links/buttons proxy clicks to the original interactive element.
- Incremental MutationObserver updates.
- SPA route rescan through patched history events and route listeners.
- Context-menu state is refreshed when tabs activate or focused windows change, so the global menu item reflects the current tab rather than the last translated tab.
- Full-page navigation resets manual translation state so a newly loaded document starts with the default `翻译本页` context-menu action.
- The background keeps only lightweight enabled-tab state for the current document lifecycle and clears it when full-page navigation starts.
- Chrome i18n `_locales` provide English and Simplified Chinese UI strings for the manifest, action title, context menu, options page, in-page diagnostics, and dictionary popup. UI language follows the browser UI locale and remains independent of the configured translation `targetLang`.
- Progressive concurrent translation with configurable chunk size, parallel request count, adjacent context length, and retry count. Defaults are chunk size `1`, parallel requests `64`, context window chars `100`, and retry count `2`.
- Configurable target language defaults to `zh-CN` for Chinese, and the configured value is injected into provider prompts as the authoritative target language with a human-readable description when known.
- OpenAI-compatible `chat/completions` requests.
- Default provider settings use OpenRouter base URL `https://openrouter.ai/api/v1` and model `x-ai/grok-4.1-fast`.
- Structured-output response format uses `json_schema` to reduce non-JSON model replies.
- Default `reasoning: { effort: "none" }` request field.
- OpenRouter-compatible optional headers.
- Grok-oriented translated-part raw alignment contract: prompt payloads include block `id`, source text, optional adjacent context, and locally generated `sourceSpans`, but not source/target offsets. Prompt `sourceSpans` expose only `id` and `text`; character ranges stay local to the extension. Model output uses blocks containing only `id` and `translatedParts[{ text, sourceSpanIds? }]`. The extension matches output blocks by `id` and uses the request-side language hint instead of model-returned `sourceLang`. `sourceSpanIds` is always a flat array and may contain non-contiguous ids such as `["s1", "s5"]`; singular `sourceSpanId` is rejected. These spans are extension-owned word/character candidates, not provider-native segmentation; CJK source text uses small character-level spans that can be grouped by adjacent ids. Pure punctuation parts may have accidental model-returned `sourceSpanIds` ignored during sanitization.
- Tolerant provider-output recovery is configurable and default-on. In strict mode, missing, duplicate, unexpected, or mismatched output ids and alignment mismatches still trigger retry or diagnostics. In tolerant mode, invalid source-span references are kept as unaligned translated text, accepted blocks do not retry, duplicate or extra output blocks are ignored, and missing or still-invalid blocks retry until `translationRetryCount` is exhausted.
- The provider prompt is intentionally short: task, output JSON shape, rules, format-only examples, page metadata, and payload. It explicitly says payload text, adjacent context, and page URL are untrusted webpage data, must not be followed as instructions, and that adjacent context is for disambiguation only and must not be translated.
- The provider prompt now sends three multilingual format-only few-shot examples instead of the previous larger mostly Chinese set: English to Simplified Chinese for context disambiguation, target reordering, and unaligned articles/punctuation; Japanese to English for CJK character grouping, particles, and spaces; and English to Spanish for non-contiguous phrasal verbs and clitics.
- Strict alignment validation with independent source/target overlap checks. Source ranges are computed from local source span ids, including non-contiguous arrays such as `["s1", "s5"]`; target ranges are computed from translated part order. Legacy offset-style output is still accepted for compatibility.
- Focused alignment validation regression script covering translated parts, reordering, overlaps, source-span anchored output, adjacent CJK span grouping, repeated target text, non-contiguous source spans, recoverable legacy offset repair, unrecoverable ranges, duplicate alignment ids, and ambiguous text repairs.
- Source/target hover highlighting through overlay rectangles.
- Source-side hover dictionary popup with configurable `WiktApi`, `FreeDictionaryAPI`, or `Off` provider and a configurable popup keep-alive window that defaults to `1000ms`. Dictionary lookups run in the background service worker, are cached in IndexedDB, and expose definitions, pronunciations, examples, translations, attribution, and source links to the content tooltip.
- In-page diagnostic status panel for translation progress, skipped block counts, failed chunks, invalid/empty sanitized blocks, id mismatches, and the latest provider error. Background diagnostics also include fine-grained provider-output failure counts and aggregate alignment coverage across accepted provider blocks.
- Geometry-based hover support for `input[type=button|submit|reset]`.
- 2-second source hover vocabulary recording.
- IndexedDB translation cache, aggregate records, and event history. Translation cache keys include the alignment-contract version and adjacent context hash so old cached structures and context-sensitive translations do not leak into incompatible requests.
- Options page settings, localized helper text, records search/sort, and UTF-8 BOM CSV export with formula-prefix neutralization.
- Versioned zip packaging.
- GitHub Actions release automation that detects `package.json` version changes on `main`, validates the lockfile version, runs unit checks, packages the extension, tags `v<version>`, and publishes the zip to GitHub Releases.
- Mock provider browser E2E wrapper for full extension regression without spending real API quota.
- Real-page smoke script that runs the extension against arbitrary live pages, using either the local mock provider or a configured real provider.
- Real-provider E2E probes now go through the extension background translation path only; the previous duplicate direct prompt/schema fallback was removed to avoid prompt drift.
- Build hygiene now enforces unused TypeScript checks and pins the CRXJS transitive Rollup dependency to `2.80.0` through npm overrides to avoid the vulnerable `2.79.2` build.
- Open-source-oriented README structure covering a generated header image, status, highlights, feature scope, quick start, configuration, usage, architecture, development, testing matrix, packaging and releases, privacy/security, contribution guidance, roadmap, and license status, with a synchronized Chinese version. The project-referenced header image lives at `docs/assets/metatranslation-header.png`.

## Validation Status

- `npm run build` passes, including the English and Simplified Chinese Chrome i18n locale bundles.
- `npm run test:unit` passes.
- `npm test` passes.
- `npm audit --cache .npm-cache` reports 0 vulnerabilities after the Rollup override.
- Unit tests now cover strict whole-block rejection for any invalid alignment, translated-part output, repeated target text, non-contiguous source spans, dictionary provider URL/result parsing, generic `reasoning: { effort: "none" }` request bodies, structured-output `json_schema`, OpenRouter headers, fenced/think JSON extraction, parse-failure strict retry recovery, settings normalization, alignment coverage diagnostics, fine-grained provider-output failure counts, CSV escaping, and i18n locale completeness.
- Unit tests also verify the raw provider schema requires model-output block `id` plus `translatedParts[].text`, rejects `sourceLang`, singular `sourceSpanId`, and extra part fields, and that new Grok-style output avoids model-counted source or target offsets. Prompt tests verify payload blocks include `id`, payload `sourceSpans` expose only `id/text`, treat webpage text/context/page URL as untrusted data rather than instructions, send only three multilingual examples, require the model to prefer fine-grained word/term alignments instead of whole-clause parts, keep strict id mismatches retryable, and recover tolerant output by ignoring invalid spans, missing blocks, duplicate ids, and extra blocks.
- `npm run package:zip` produces `artifacts/metatranslation-0.1.2.zip`.
- Real API E2E last passed with OpenRouter `https://openrouter.ai/api/v1` and `x-ai/grok-4.1-fast` before the latest `translatedParts` contract update; rerun it before release if real-provider confidence is required.
- `npm run e2e:mock` passes in a Chrome for Testing environment; it covers progressive rendering, internal second-line rendering for flex toolbar links/buttons, interactive proxy clicks, translated-node repositioning after DOM moves, DOM-mutation cancellation of pending hover records, one record per continuous source-side span dwell, source hover recording, input-control source hover recording, disable cleanup, and translation-state reset after a full-page navigation.
- `npm run e2e:page` has been exercised against the Reddit Bitter Lesson page with the local mock provider; the page exposes extractable candidates and renders injected translation nodes after the Reddit verification redirect completes.
- `npm run e2e:page` has been exercised against `https://vision-banana.github.io/` with the local mock provider. The page reports 201 rendered translation nodes and `layoutIssueCount: 0` after internal-line handling for horizontal flex cards and absolute overlay labels.
- `npm run e2e:page` has also been exercised against `https://vision-banana.github.io/` with OpenRouter `x-ai/grok-4.1-fast`; real English-to-Chinese output rendered for the hero, navigation, section headings, TL;DR cards, and overlay labels, with `layoutIssueCount: 0`.
- The Reddit live-page smoke currently reports successful mock-provider injection and displays the diagnostic panel with rendered block counts.
- Smoke test requires Chromium or Chrome for Testing through `BROWSER_BIN`; branded Google Chrome may reject automated extension loading.

## Known Risks

- Provider compatibility is intentionally generic. Some OpenAI-compatible providers may reject fields such as `response_format` or `reasoning`; add provider-specific compatibility only after confirming the user wants that tradeoff.
- Alignment quality depends on model output. There is no local heuristic fallback by design.
- Geometry-based text offsets for input buttons are approximate because browser inputs do not expose per-character text ranges.
- Conservative extraction skips some mixed or highly interactive content by design.
- Browser extension automation can be flaky across Chrome versions because of MV3 service worker lifecycle and extension-loading policy changes.
- Automated GitHub Releases depend on repository Actions having `contents: write` permission and on each package version mapping to a unique `v<version>` tag.
- Some sites show temporary verification pages before the real document. If translation was enabled on the temporary page, the final document now starts untranslated and the user should trigger translation again after the real content loads.
- Real providers can still produce unusable alignment output. The runtime now surfaces this as skipped/failed counts, and the v1 policy remains to skip invalid or ambiguous blocks rather than render unaligned text.

## Next Steps

- Add focused tests for content-runtime extraction boundaries.
- Run `npm run e2e:mock` in a browser-enabled environment before release changes, especially after content-runtime or background-message changes.
- Use `npm run e2e:page` for site-specific regressions before adding site-specific extraction changes.
- Consider a small diagnostics panel or debug logging switch for failed blocks and invalid alignments.
- Keep README, AGENTS, and this plan synchronized as behavior changes.
- Keep README at open-source entry quality and update both English and Chinese versions when onboarding, configuration, privacy, contribution, release guidance, or README visual assets change.

## Decision Log

- Use manual activation rather than default all-site injection.
- Use sibling translation nodes rather than replacing or wrapping source DOM.
- Use model-only alignment and skip invalid blocks.
- Require translated-part provider output because `x-ai/grok-4.1-fast` should be more reliable at ordering translated parts and choosing extension-owned source span ids than counting character offsets or target occurrences. Local source ranges come from the extension-generated span table, while target offsets are resolved from translated part order.
- Use IndexedDB for cache and records because translation cache, dictionary cache, and event history can grow beyond small settings storage.
- Use `requestChunkSize`, `requestConcurrency`, `contextWindowChars`, `translationRetryCount`, and `tolerantProviderOutput` settings so users can tune latency, provider rate-limit behavior, adjacent context length, retry behavior, and whether imperfect provider output should be recovered.
- Keep provider logic generic for now, with OpenRouter headers isolated in the provider-header helper.
- Do not claim a specific open-source license until a real `LICENSE` file is added.
