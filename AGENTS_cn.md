# AGENTS.md 中文版

本文件为本仓库 coding agent 的工作指南。

## 核心原则

- 使用本项目自己的环境进行开发和测试。优先使用仓库脚本、本地依赖和已配置的扩展工作流，而不是临时外部环境。
- 遵循 Bitter Lesson 和第一性原理。优先选择简洁、优雅、直接的实现，依赖可扩展的通用机制，而不是脆弱的特例逻辑。
- 保持系统模块化并方便修改。设计边界时，应让翻译 provider、DOM 提取、渲染、对齐校验、存储、记录 UI 和测试都能独立演进。
- 将模块化测试和整体系统测试结合起来。对独立逻辑使用聚焦检查，对扩展行为使用浏览器级测试，避免项目反复掉入同一个失败陷阱。
- 在选择技术路线、依赖、浏览器 API、provider 协议或实现策略之前要充分调研。如果不确定性会影响产品行为、成本、隐私、兼容性或可维护性，应先与用户讨论再决策。
- 持续维护 `docs/`。技术路线规划、设计决策、进度、已知风险和验证状态都要在其中同步。
- 持续维护 `README.md`。它应清晰说明项目、亮点、环境构建、用法、架构和贡献入口，使开源贡献者能快速理解并上手。
- 保持 `README.md` 达到开源入口文档质量。它应包含项目状态、目录、功能范围、快速开始、配置参考、使用说明、架构、开发命令、测试矩阵、打包、隐私/安全说明、贡献指南、路线图和 license 状态。
- 所有主要项目文本文件都以英文为主，包括 docs、README、AGENTS 和 prompt 文件。每个此类文本文件都必须维护一个以 `*_cn.md` 命名的同步中文版。
- 持续维护 `AGENTS.md`。它必须包含这些核心原则，以及未来 agent 需要了解的项目常识；当仓库工作流或约束变化时，应同步更新。

## 项目范围

本仓库是一个名为 metatranslation 的 Chromium MV3 扩展。它在网页内注入双行翻译，在悬浮时高亮源文/译文词或短语对齐，并在源文侧 span 稳定悬浮后记录词汇。

目标平台仅为桌面 Chrome/Edge MV3。除非明确要求，不要添加 Firefox/Safari 兼容性。

## 技术栈

- TypeScript
- Vite
- CRXJS MV3 manifest tooling
- Chrome extension APIs
- IndexedDB，用于翻译缓存、字典缓存和词汇记录
- `chrome.storage.local`，用于设置
- TypeScript 构建会强制检查未使用代码。除非 `@crxjs/vite-plugin` 不再 pin 存在漏洞的 Rollup 2 依赖，否则保留 `rollup@2.80.0` npm override。

## 核心命令

```bash
npm install --cache .npm-cache
npm run test:unit
npm run build
npm test
npm run package:zip
```

使用 `npm run test:unit` 进行聚焦模块检查；在报告代码变更完成前，应使用 `npm run build`。使用 `npm test` 进行组合本地验证。需要可分发压缩包时，使用 `npm run package:zip`；它会重新构建，并写入 `artifacts/metatranslation-<version>.zip`。

Smoke test：

```bash
BROWSER_BIN="/path/to/Chromium-or-Chrome-for-Testing" npm run smoke:test
```

Mock provider 浏览器 E2E：

```bash
BROWSER_BIN="/path/to/Chrome for Testing" npm run e2e:mock
```

真实 API E2E：

```bash
BROWSER_BIN="/path/to/Chrome for Testing" \
REAL_TEST_BASE_URL="https://provider.example/v1" \
REAL_TEST_KEY="..." \
REAL_TEST_MODEL="model-id" \
REAL_TEST_TARGET_LANG="zh-CN" \
npm run e2e:real
```

不要提交真实 API key 或生成的产物。

## 重要路径

- `manifest.config.ts`：MV3 manifest 源文件。
- `README.md`：开源项目介绍、环境构建、用法和结构。
- `README_cn.md`：`README.md` 的同步中文版。
- `AGENTS.md`：英文 agent 指南和项目操作规则。
- `AGENTS_cn.md`：`AGENTS.md` 的同步中文版。
- `docs/TECHNICAL_PLAN.md`：英文技术路线、进度、风险和验证状态。
- `docs/TECHNICAL_PLAN_cn.md`：`docs/TECHNICAL_PLAN.md` 的同步中文版。
- `src/background/index.ts`：service worker、action/context-menu 处理、消息路由、缓存编排、记录持久化入口。
- `src/background/openai.ts`：OpenAI 兼容翻译 API 客户端和对齐校验。
- `src/background/dictionary.ts`：源文悬浮字典 provider client 和 response normalization。
- `src/background/db.ts`：IndexedDB stores，用于翻译缓存、字典缓存、聚合词汇记录和词汇事件。
- `src/content/injected.ts`：注入内容运行时、文本扫描、mutation 跟踪、翻译渲染、悬浮/高亮逻辑、记录计时器。
- `src/options/main.ts`：设置与记录 UI 行为。
- `src/lib/alignment.ts`：可复用的 alignment 清洗和校验逻辑。
- `src/lib/sourceSpans.ts`：为 provider prompt 和 alignment 清洗生成本地 source span 表。
- `src/lib/types.ts`：共享设置、翻译、对齐和记录类型。
- `src/lib/messages.ts`：扩展消息协议。
- `scripts/package-extension.mjs`：zip 打包脚本。
- `.github/workflows/release-on-version.yml`：当 `main` 上 package version 变化时触发的 GitHub Release workflow。
- `scripts/test-alignment-validation.mjs`：聚焦的 alignment 校验回归检查。
- `scripts/e2e-mock.mjs`：本地 mock provider 浏览器回归包装脚本。
- `scripts/smoke-test.mjs`：浏览器加载 smoke test。
- `scripts/e2e-real.mjs`：真实 API 浏览器回归测试。

## 架构规则

- 翻译由扩展按钮或右键菜单手动切换。不要默认添加全站自动翻译。
- 右键菜单标题是全局浏览器 UI 状态。tab 激活和 focused window 变化时都要刷新，避免其他 tab 继承上一 tab 的 `关闭翻译` 标题。
- Background 负责 API 调用、设置、缓存和记录持久化。
- Content runtime 负责 DOM 扫描、渲染、悬浮映射和 mutation 检测。
- Options 页面负责 API 设置、目标语言、并发设置、记录搜索/排序和 CSV 导出。
- 保持页面 DOM 安全：源文保留在原位，译文作为源块下方的 sibling 节点渲染。
- 普通文本翻译不要包裹或替换原网页文本节点。
- 所有注入 DOM 都必须带有 `data-dlt-role`，并且在关闭时可清理。
- 关闭时必须清理译文节点、高亮层和注入的 style 节点。

## 翻译行为

- 使用 `TreeWalker` 和从上到下的候选元素选择。
- 优先处理具体可读容器，例如 `p`、`li`、标题、`blockquote` 和 `figcaption`；generic text containers 只在不包含更具体可翻译后代时作为兜底候选。
- 除非明确支持，否则跳过高风险或交互容器。
- 继续跳过 `textarea`、`select`、`option`、`code`、`pre`、`script`、`style`、`svg`、`canvas`、媒体、iframe、contenteditable 和扩展自有节点。
- 支持的交互元素是 `a`、`button` 和 `input[type=button|submit|reset]`。
- 译文节点应继承源块的可见文本样式，并在视觉上紧贴原文下一行。
- 对 source-level `a` 和 `button` blocks，译文应作为注入的内部第二行渲染，避免在 flex 或导航栏中额外产生横向 sibling item。任何布局补丁，例如临时 `flex-wrap`，都必须在关闭时可恢复。
- 对处在横向 flex/grid 父容器中的普通文本块，以及 absolute/fixed 定位 label，译文应作为注入的内部第二行渲染。这些场景中的外部 sibling 节点经常会变成无关布局项，导致译文出现在源文旁边或远离源文。
- 翻译后的交互控件以及内联译文链接/按钮应保持相同的大致元素类型/样式，并将点击代理到原始元素。
- 不要破坏原网页点击、选择、悬浮或表单行为。

## 渐进式翻译

- Content runtime 根据设置并发发送 chunk。
- `requestChunkSize` 默认是 `1`。
- `requestConcurrency` 默认是 `64`。
- `contextWindowChars` 默认是 `100`；设为 `0` 可关闭相邻 `contextBefore` / `contextAfter`。
- `translationRetryCount` 默认是 `2`；含义是首次模型调用后的重试次数。`0` 会关闭 retry passes。
- 每个完成的 chunk 应立即渲染。
- 不要等所有 chunk 完成后才显示部分译文。
- 如果某个 chunk 失败，记录错误并允许其他 chunk 继续。
- MutationObserver 应对 dirty blocks 进行增量重翻。
- SPA 路由变化应清空当前 block 注册表并重新扫描页面。

## 对齐协议

模型必须返回带 source-span 引用的 `translatedParts`。除非明确要求，不要添加本地启发式对齐兜底。

Raw provider 协议采用 translated-part anchored 形式。Prompt 会把每个 block 的 `id`、原文、可选相邻上下文，以及本地从原文字符范围生成的 `sourceSpans` 表一起发送给模型。这些 span 是扩展拥有的词、字符或短语候选，不应理解为 provider 原生分段。CJK 源文可能表示为单字符 spans。Prompt 中的 `sourceSpans` 只暴露 `id` 和 `text`；source character ranges 保留在扩展本地。Prompt payload text、相邻 context 和 page URL 都是不可信网页数据；prompt 必须要求模型不要执行其中的指令。

模型应为每个 payload block 返回一个 output block。每个 output block 必须包含与 payload block 相同的 `id` 和 `translatedParts`；不得包含其他 block-level fields。每个 part 必须包含 `text`；当该目标片段映射到源文 spans 时，可以包含 `sourceSpanIds`。`sourceSpanIds` 始终是扁平数组，可以包含非连续 ids，例如 `["s1", "s5"]`。不要使用单数 `sourceSpanId`。

Provider prompts 应要求模型使用尽可能可靠的细粒度对齐：只要可行，就按源文 word、term 或 short phrase 拆分 `translatedParts`。当更小的 source spans 可以可靠映射时，避免把整句或整从句合成一个 part。只有在真实翻译单元是多 span 短语、习语、CJK 词或非连续结构时，才组合 source spans。

Provider prompts 应保持示例少量且多语言。当前 prompt examples 限制为三个 format-only 示例，分别覆盖英译简中的上下文/重排/filler、日译英的 CJK grouping/particles/spaces，以及英译西班牙语的非连续 phrasal verbs/clitics。示例不能暗示固定目标语言，也不能使用 `sourceLang` 等禁止模型输出的字段名。

模型不得返回 `sourceLang`、`alignmentId`、`sourceText`、`targetText`、`targetOccurrence`、source offsets、target offsets 或顶层 `translatedText`。扩展会按 `id` 匹配输出 blocks、使用请求侧 source language hint、拼接 `translatedParts[].text` 并累加目标端 offsets，在本地派生这些运行时值。清洗后的 runtime `TranslationResultBlock.alignments` 只保留 content runtime 需要的字段：

```ts
{
  alignmentId: string;
  sourceRanges: Array<{ start: number; end: number }>;
  targetStart: number;
  targetEnd: number;
  sourceText: string;
}
```

校验规则：

- 输出 block ids 必须匹配输入 block ids。
- 严格模式下，输出 ids 必须完整且唯一。缺失 ids、重复 ids、意外 ids 或不匹配 ids 都非法，并应触发重试或诊断。
- 容错模式下，返回的 blocks 按 id 匹配。第一次匹配之后重复出现的 output ids 和多余 output blocks 会被忽略；缺失 output blocks 会保持 pending，并重试到 `translationRetryCount` 耗尽。
- `tolerantProviderOutput` 默认是 `true`。当它为 `false` 时，畸形输出应像之前一样重试或暴露错误。当它为 `true` 时，非法 source-span 引用会作为无联动文本处理，已通过的 block 不重试，缺失或仍非法的 block 会重试到配置次数耗尽。
- `translatedParts` 必须非空，并且拼接后必须得到非空 `translatedText`。
- 严格模式下，至少一个 translated part 必须包含合法 `sourceSpanIds`；容错模式可以保留没有合法 alignments 的译文文本。
- `sourceSpanIds` 必须来自 payload 的 `sourceSpans` 表。
- `sourceSpanIds` 可以相邻或非连续，但同一个 source span 不能被多个 translated parts 重复使用。
- 纯标点或空白 translated parts 如果意外带有模型返回的 `sourceSpanIds`，sanitization 可以忽略这些 ids；这只会移除非语义标点对齐，不会推断词义对齐。
- Aligned parts 应在翻译允许的范围内尽量细；除非不存在更小的可靠映射，否则整句或整从句对齐属于 prompt failure。
- 缺失、重复、意外或不匹配的 block ids、`sourceLang`、单数 `sourceSpanId` 以及 `translatedParts` 内的额外字段在严格新协议中都是非法的。
- Diagnostics 应保留 `outputFailures` 和 `lastOutputError`，并报告更细的 provider-output failure counts，以及 accepted provider blocks 的聚合 alignment coverage。
- Target ranges 由 translated part 顺序派生，所以重复译文文本不会产生歧义。
- Source ranges 由 `sourceSpanIds` 派生；相邻 source spans 合并为一个 source range，非连续 ids 会产生多个 source ranges。
- 为兼容旧输出，legacy offset-style raw alignments 仍可被 sanitizer 处理；新 provider 应使用 `translatedParts`。
- 模糊、缺失、重叠或无法恢复的 ranges 仍然必须拒绝整个 block。
- Runtime alignment ids 由匹配到的 block id 和 translated part index 在本地生成。
- 允许 source/target 顺序不同；合法翻译重排不是 overlap。
- 如果校验重试后仍失败，跳过该 block 渲染，不要猜测。

## API Provider 规则

- Provider 形态是 OpenAI 兼容的 `chat/completions`。
- 默认 Base URL 是 `https://openrouter.ai/api/v1`。
- 默认模型是 `x-ai/grok-4.1-fast`。
- 保存前需要通过 trim 空白和移除尾部斜杠来归一化 Base URL。
- Base URL 会自动追加 `/chat/completions`，除非已包含该路径。
- 通过 structured outputs 请求 JSON 输出：`response_format: { type: "json_schema", json_schema: ... }`。
- 默认发送 `reasoning: { effort: "none" }`。
- 不要添加 `reasoning_split`。
- OpenRouter 专用 headers 只能添加在 provider-header helper 中。
- 除非用户明确要求 provider 专用兼容层，否则保持 provider 行为通用。

## 悬浮与记录规则

- 源文文本命中使用 `caretRangeFromPoint` 或 `caretPositionFromPoint`。
- `input[type=button|submit|reset]` 源/译命中使用几何位置，因为它们没有 text node。
- 普通译文侧文本渲染为带 `data-alignment-id` 的 alignment spans。
- 高亮矩形必须渲染在 fixed overlay 中，并设置 `pointer-events: none`。
- 当 `dictionaryProvider` 不是 `off` 时，源文侧 hover 也可以显示字典 tooltip。Tooltip links 可以接收 pointer events，但 highlight overlay 必须保持非交互。
- 字典查询在 background service worker 中执行，并必须保持 provider-pluggable。首批支持 provider 是 `WiktApi` 和 `FreeDictionaryAPI`；传给 content runtime 前要先归一化 parsed output。
- 只有源文侧 hover 可以启动词汇记录。
- 只有同一个源文侧 alignment span 稳定保持 2 秒后才记录。
- alignment 改变、移出、滚动、resize、关闭、路由变化或 DOM 更新时，都要取消待记录计时器。

## 存储模型

设置存储在 `chrome.storage.local`。
已启用 tab 状态只用于当前文档生命周期。完整页面导航开始时必须清理该状态，使新文档从默认 `翻译本页` 动作开始，而不是继承上一页的 `关闭翻译` 状态。

IndexedDB stores：

- `translation_cache`：按 alignment-contract version、source text 加 adjacent context hash、源语言、目标语言、base URL、model 以及 strict/tolerant output mode 缓存翻译块。
- `dictionary_cache`：按 provider、edition、源语言、目标语言和规范化词缓存字典查询结果。
- `word_records`：按规范化词、源语言和目标语言聚合记录。
- `word_events`：每次 hover 命中的事件历史，关联回聚合记录。

记录聚合字段应保留 count、first/last seen timestamps、last URL、last source sentence 和 last translated sentence。

## Options 页面规则

- 设置必须包含 `baseUrl`、`apiKey`、`model`、`targetLang`、`timeoutMs`、`requestChunkSize`、`requestConcurrency`、`contextWindowChars`、`translationRetryCount`、`dictionaryProvider`、`dictionaryEdition`、`dictionaryHoverHoldMs` 和 `tolerantProviderOutput`。
- `targetLang` 默认是 `zh-CN`（中文），并且必须作为权威配置目标语言注入 provider prompts；对已知语言要附带人类可读描述；few-shot 示例不能暗示固定目标语言。
- 在 background sanitizer 中将 `requestChunkSize`、`requestConcurrency`、`contextWindowChars`、`translationRetryCount` 和 `dictionaryHoverHoldMs` 限制在合理范围。
- `dictionaryProvider` 默认是 `wiktapi`。支持值是 `wiktapi`、`freedictionaryapi` 和 `off`。
- `dictionaryEdition` 默认是 `en`，控制 WiktApi 使用的 Wiktionary edition。
- `dictionaryHoverHoldMs` 默认是 `1000`，控制鼠标从源文移动到 tooltip 期间字典弹窗保留多久。
- `tolerantProviderOutput` 必须保持为显式 boolean option，并默认开启。
- 每个设置控件都应包含简洁的英文帮助说明，并使用低强调的 `small` 元素。
- Records 页面默认显示聚合记录。
- 搜索应匹配 word、URL、源句子、译句子和语言字段。
- CSV 导出必须包含 UTF-8 BOM，使中文在 Excel/WPS 中正确打开。
- CSV 导出必须中和不可信网页文本中的电子表格公式前缀。

## Git 和产物

- `dist/`、`artifacts/`、`.npm-cache/`、生成的 CRX 文件和 `node_modules/` 应保持未追踪。
- 不要提交 API keys、截图、浏览器 profiles 或 zip 输出。
- GitHub Release workflow 只会在推送到 `main` 且 `package.json` 的 `version` 变化后发布；release tag 使用 `v<version>`，并上传 `artifacts/metatranslation-<version>.zip`。
- bump release 版本时，应保持根 `package-lock.json` 版本与 `package.json` 同步。
- 除非用户明确要求 minor、major、prerelease 或自定义版本，否则只递增语义化版本的最后一段 patch，例如从 `0.1.0` 到 `0.1.1`。
- 验证后优先使用小而聚焦的 commits。
- 在真实 `LICENSE` 文件添加之前，不要在 README、package metadata 或 release notes 中声明具体开源 license。

## 文档同步规则

- 当项目环境、用法、能力、架构或贡献流程变化时，更新 `README.md`。
- README 更新应保持开源 onboarding 结构：status、quick start、configuration、usage、architecture、development、testing、packaging、privacy/security、contributing、roadmap 和 license status。
- 当技术方向、实现进度、已知风险、测试状态或下一步变化时，更新 `docs/TECHNICAL_PLAN.md`。
- 当 agent 工作流、约束、项目约定或常见失败点变化时，更新 `AGENTS.md`。
- 每个新增或修改的英文 Markdown 文档，都要在同次变更中更新同名 `*_cn.md` 中文文件。
- 如果以后新增 prompt 文档，主 prompt 使用英文，并添加同步的 `*_cn.md` 版本。
- 修改英文源文档后，不要留下过期中文文档；除非明确要求，不要添加只有中文的项目文档。

## 最近已解决的 Review 项

- 对齐校验不再把合法翻译重排误判为 target overlap。
- 关闭功能现在会移除注入运行时产物，不再遗留 style/highlight 节点。
- Input button 翻译现在支持基于几何位置的 hover/highlight。
- `reasoning: { effort: "none" }` 默认通过通用 OpenAI 兼容请求体发送。
- Source-level link/button 翻译现在作为内部第二行渲染，以避免在横向导航栏中重叠或挤压。
- 横向 flex/grid 布局中的普通文本，以及 absolute/fixed overlay label，现在会作为内部第二行渲染，避免在密集项目页中出现左右并排或远离源文的译文。
- Grok prompt 和 sanitization 现在能处理纯标点上意外出现的 `sourceSpanIds`，该问题此前会导致有效真实翻译被跳过。
- Tolerant provider-output 恢复现在是可配置且默认开启；严格模式仍会重试或报告数量/对齐不匹配。
