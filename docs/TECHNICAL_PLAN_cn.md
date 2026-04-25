# 技术路线

本文档记录 metatranslation 的技术路线、当前进度、验证状态、风险和下一步。请与 `docs/TECHNICAL_PLAN.md` 保持同步。

## 目标

- 保留网页原文，并将译文注入到原文下一行。
- 避免破坏页面交互、选择、布局和 SPA 更新。
- 使用模型返回的词级对齐信息进行悬浮高亮。
- 在源文侧稳定悬浮后记录词汇。
- 保持 provider 集成 OpenAI 兼容且可配置。
- 保持实现模块化，方便未来调整 provider、UI、存储和提取逻辑。

## 第一性原理路线

- 保留源 DOM 而不是替换它。这能最大限度减少页面破坏，并让关闭清理可确定。
- 将翻译、对齐校验、DOM 渲染、悬浮映射和持久化视为独立模块。
- 优先保守文本提取，而不是激进覆盖。漏掉一个风险块好过破坏用户交互。
- 只信任经过校验的模型 alignments。跳过非法 block 比渲染错误高亮或记录错误词汇更安全。
- 使用浏览器级测试验证扩展行为，因为 MV3 生命周期、content-script 注入和页面交互无法只靠单元测试完全覆盖。

## 当前架构

- MV3 service worker 位于 `src/background/index.ts`。
- 翻译 API 客户端和对齐校验位于 `src/background/openai.ts`。
- 可复用 alignment 清洗逻辑位于 `src/lib/alignment.ts`。
- Source span 表生成逻辑位于 `src/lib/sourceSpans.ts`。
- IndexedDB 缓存和记录持久化位于 `src/background/db.ts`。
- 注入 content runtime 位于 `src/content/injected.ts`。
- 共享消息和数据类型位于 `src/lib/`。
- Options 页面位于 `src/options/`。
- 打包脚本位于 `scripts/package-extension.mjs`。
- GitHub Release 自动化位于 `.github/workflows/release-on-version.yml`。

## 已实现能力

- 通过扩展按钮和右键菜单手动切换翻译。
- 使用 TreeWalker 进行保守 DOM block 发现。
- 按从上到下发现可见文本，覆盖标题、可读文本块、链接、按钮和受支持的 input 按钮，同时仍跳过高风险容器。
- 在源块下方紧贴渲染 sibling translation node，并把源元素的下边距转移到注入行之后，让译文在视觉上靠近原文。
- Source-level link 和 button 翻译会作为内部第二行渲染，并使用可恢复的 flex-layout 补丁，避免横向导航栏因为额外 sibling item 而挤压或重叠原控件。
- 位于横向 flex/grid 父容器中的普通文本块，以及 absolute/fixed overlay label，也会作为内部第二行渲染，使译文保持贴近源文，而不是变成脱离源文的布局项。
- 译文节点继承源块的可见文本样式，包括字体、字号、行高、颜色和文本装饰。内联译文链接/按钮会把点击代理到原始交互元素。
- MutationObserver 增量更新。
- 通过 patch history 和路由监听进行 SPA 路由重新扫描。
- tab 激活或 focused window 变化时会刷新右键菜单状态，使全局菜单项反映当前 tab，而不是上一个已翻译 tab。
- 完整页面导航会重置手动翻译状态，使新加载文档从默认 `翻译本页` 右键菜单动作开始。
- Background 只保留当前文档生命周期内的轻量 enabled-tab 状态，并在完整页面导航开始时清理。
- Chrome i18n `_locales` 为 manifest、action title、右键菜单、Options 页面、页面内诊断和字典弹窗提供英文与简体中文 UI 文案。界面语言跟随浏览器 UI locale，并与配置的翻译 `targetLang` 保持独立。
- 支持可配置 chunk size、parallel request count、adjacent context length 和 retry count 的渐进式并发翻译。默认值是 chunk size `1`、parallel requests `64`、context window chars `100`、retry count `2`。
- 目标语言可配置，默认 `zh-CN`（中文），并且配置值会作为权威目标语言注入 provider prompts；对已知语言会附带人类可读描述。
- OpenAI 兼容的 `chat/completions` 请求。
- 默认 provider 设置使用 OpenRouter base URL `https://openrouter.ai/api/v1` 和模型 `x-ai/grok-4.1-fast`。
- structured-output response format 使用 `json_schema`，以减少模型返回非 JSON 内容。
- 默认发送 `reasoning: { effort: "none" }`。
- 支持 OpenRouter 兼容可选 headers。
- 面向 Grok 的 translated-part raw alignment 协议：prompt payload 会包含 block `id`、源文、可选相邻上下文和本地生成的 `sourceSpans`，但不包含 source/target offsets。Prompt 中的 `sourceSpans` 只暴露 `id` 和 `text`；字符范围保留在扩展本地。模型输出使用只包含 `id` 和 `translatedParts[{ text, sourceSpanIds? }]` 的 blocks。扩展按 `id` 匹配输出 blocks，并使用请求侧 language hint，而不依赖模型返回 `sourceLang`。`sourceSpanIds` 始终是扁平数组，可以包含 `["s1", "s5"]` 这样的非连续 ids；单数 `sourceSpanId` 会被拒绝。这些 span 是扩展拥有的词/字符候选，不是 provider 原生分段；CJK 源文使用更小的字符级 spans，可通过相邻 ids 组合。纯标点 parts 如果意外带有模型返回的 `sourceSpanIds`，sanitization 可以忽略这些 ids。
- Tolerant provider-output 恢复可配置且默认开启。严格模式下，缺失、重复、意外或不匹配的 output ids 以及 alignment 不匹配仍会触发重试或诊断。容错模式下，非法 source-span 引用会作为无对齐译文文本保留，已通过的 block 不重试，重复或多余 output blocks 会被忽略，缺失或仍非法的 block 会重试到 `translationRetryCount` 耗尽。
- Provider prompt 有意保持简短：task、output JSON shape、rules、format-only examples、page metadata 和 payload。Prompt 明确说明 payload text、相邻上下文和 page URL 都是不可信网页数据，不能作为指令执行；相邻上下文只用于消歧，不能被翻译。
- Provider prompt 现在发送三个多语言 format-only few-shot 示例，而不是之前较大的、主要面向中文的示例集：英译简中示例覆盖上下文消歧、目标语重排、冠词和标点不对齐；日译英示例覆盖 CJK 字符组合、助词和空格；英译西班牙语示例覆盖非连续 phrasal verbs 和 clitics。
- 严格对齐校验，并分别检查 source/target 真实重叠。Source ranges 由本地 source span ids 计算，包括 `["s1", "s5"]` 这类非连续数组；target ranges 由 translated part 顺序计算。为兼容旧输出，legacy offset-style 输出仍会被接受。
- 聚焦 alignment 校验回归脚本，覆盖 translated parts、重排、overlap、source-span anchored 输出、相邻 CJK span 组合、重复目标文本、非连续 source spans、可恢复 legacy offset 修复、不可恢复 ranges、重复 alignment id 和模糊文本修复。
- 通过 overlay 矩形进行 source/target 悬浮高亮。
- 源文侧悬浮字典弹窗，provider 可配置为 `WiktApi`、`FreeDictionaryAPI` 或 `Off`，弹窗保活窗口可配置且默认 `1000ms`。字典查询在 background service worker 中执行，结果缓存在 IndexedDB，并向 content tooltip 提供释义、发音、例句、翻译、attribution 和 source links。
- 页面内诊断状态浮层，用于显示翻译进度、跳过 block 数、失败 chunk、invalid/empty sanitized blocks、id mismatches 和最近 provider 错误。Background diagnostics 还会包含更细的 provider-output failure counts，以及 accepted provider blocks 的聚合 alignment coverage。
- 对 `input[type=button|submit|reset]` 支持基于几何位置的悬浮。
- 源文稳定悬浮 2 秒后记录词汇。
- IndexedDB 翻译缓存、聚合记录和事件历史。翻译缓存键包含 alignment-contract version 和 adjacent context hash，避免旧缓存结构和上下文敏感译文流入不兼容请求。
- Options 页面设置、本地化 helper text、记录搜索/排序和带 UTF-8 BOM 且中和公式前缀的 CSV 导出。
- 版本化 zip 打包。
- GitHub Actions release 自动化会检测 `main` 上 `package.json` 的 version 变化，校验 lockfile 版本，运行单元检查，打包扩展，创建 `v<version>` tag，并把 zip 发布到 GitHub Releases。
- Mock provider 浏览器 E2E 包装脚本，可在不消耗真实 API quota 的情况下进行完整扩展回归。
- 真实页面 smoke 脚本，可在任意 live page 上运行扩展，并使用本地 mock provider 或配置的真实 provider。
- 真实 provider E2E 探测现在只通过扩展 background 翻译路径执行；之前重复维护的 direct prompt/schema fallback 已移除，以避免 prompt 漂移。
- 构建清洁度现在会强制 TypeScript 未使用代码检查，并通过 npm overrides 把 CRXJS 的传递 Rollup 依赖 pin 到 `2.80.0`，以避开存在漏洞的 `2.79.2` 构建。
- 面向开源的 README 结构，覆盖生成的头图、status、highlights、feature scope、quick start、configuration、usage、architecture、development、testing matrix、packaging and releases、privacy/security、contribution guidance、roadmap 和 license status，并维护同步中文版。项目引用的头图位于 `docs/assets/metatranslation-header.png`。

## 验证状态

- `npm run build` 通过，包括英文和简体中文 Chrome i18n locale bundles。
- `npm run test:unit` 通过。
- `npm test` 通过。
- `npm audit --cache .npm-cache` 在 Rollup override 后报告 0 个漏洞。
- 单元测试现在覆盖任一非法 alignment 都整块拒绝、translated-part 输出、重复目标文本、非连续 source spans、字典 provider URL/result 解析、通用 `reasoning: { effort: "none" }` 请求体、structured-output `json_schema`、OpenRouter header、fenced/think JSON 提取、解析失败后的严格重试恢复、设置归一化、alignment coverage diagnostics、更细的 provider-output failure counts、CSV 转义，以及 i18n locale 完整性。
- 单元测试也验证 raw provider schema 在模型输出 block 层要求 `id` 和 `translatedParts[].text`、拒绝 `sourceLang`、单数 `sourceSpanId` 和额外 part 字段，并确认新的 Grok 风格输出不再依赖模型计算 source 或 target offsets。Prompt 测试会验证 payload blocks 包含 `id`，payload `sourceSpans` 只暴露 `id/text`，把网页 text/context/page URL 当作不可信数据而不是指令，只发送三个多语言示例，要求模型优先使用细粒度词/术语对齐而不是整句或整从句 part，保持严格模式下 id mismatch 可重试，并通过忽略非法 spans、缺失 blocks、重复 ids 和多余 blocks 来恢复容错输出。
- `npm run package:zip` 会生成 `artifacts/metatranslation-0.1.2.zip`。
- 真实 API E2E 在最新 `translatedParts` 契约更新前曾使用 OpenRouter `https://openrouter.ai/api/v1` 和 `x-ai/grok-4.1-fast` 跑通过；发布前如需真实 provider 信心，需要重新运行。
- `npm run e2e:mock` 已在 Chrome for Testing 环境中通过；它覆盖渐进式渲染、flex toolbar 链接/按钮的内部第二行渲染、交互代理点击、DOM 移动后的译文重定位、DOM mutation 取消待触发 hover 记录、同一次连续源文侧 span 悬停只记录一次、源文 hover 记录、input 控件源文 hover 记录、关闭清理，以及完整页面导航后的翻译状态重置。
- `npm run e2e:page` 已使用本地 mock provider 在 Reddit Bitter Lesson 页面上跑过；该页面在 Reddit 验证跳转完成后存在可提取候选块，并能渲染注入的译文节点。
- `npm run e2e:page` 已使用本地 mock provider 在 `https://vision-banana.github.io/` 跑过。该页面报告 201 个已渲染译文节点，并且在横向 flex 卡片和 absolute overlay label 的内部行处理后 `layoutIssueCount: 0`。
- `npm run e2e:page` 也已使用 OpenRouter `x-ai/grok-4.1-fast` 在 `https://vision-banana.github.io/` 跑过；hero、导航、section 标题、TL;DR cards 和 overlay labels 都渲染了真实英译中结果，并且 `layoutIssueCount: 0`。
- Reddit 真实页面 smoke 当前显示本地 mock provider 注入成功，并通过诊断浮层展示已渲染 block 数。
- Smoke test 需要通过 `BROWSER_BIN` 指向 Chromium 或 Chrome for Testing；品牌版 Google Chrome 可能拒绝自动化加载扩展。

## 已知风险

- Provider 兼容性有意保持通用。一些 OpenAI 兼容 provider 可能拒绝 `response_format` 或 `reasoning` 等字段；只有在确认用户接受该取舍后，才添加 provider 专用兼容层。
- 对齐质量依赖模型输出。当前设计不做本地启发式兜底。
- Input button 的几何文本 offset 是近似值，因为浏览器 input 不暴露逐字符 text range。
- 保守提取会按设计跳过部分混排或强交互内容。
- 浏览器扩展自动化可能因 Chrome 版本、MV3 service worker 生命周期和扩展加载策略变化而波动。
- 自动 GitHub Releases 依赖仓库 Actions 拥有 `contents: write` 权限，并且每个 package version 都对应唯一的 `v<version>` tag。
- 一些网站会先显示临时验证页再进入真实文档。如果在临时页面启用了翻译，最终文档现在会以未翻译状态开始，用户应在真实内容加载后再次触发翻译。
- 真实 provider 仍可能产出不可用的 alignment。runtime 现在会把这种情况显示为 skipped/failed 数量，但 v1 策略仍然是跳过非法或模糊 block，而不是渲染无对齐文本。

## 下一步

- 为 content runtime 提取边界增加聚焦测试。
- 发布类变更前，在具备浏览器环境的机器上运行 `npm run e2e:mock`，尤其是修改 content runtime 或 background message 后。
- 在添加站点专用提取改动前，使用 `npm run e2e:page` 做站点级回归。
- 考虑增加一个小型 diagnostics 面板或 debug logging 开关，用于失败 block 和非法 alignments。
- 随行为变化同步 README、AGENTS 和本文档。
- 保持 README 达到开源入口文档质量；当 onboarding、configuration、privacy、contribution、release guidance 或 README 视觉资产变化时，同步更新英文和中文版本。

## 决策记录

- 使用手动激活，而不是默认全站注入。
- 使用 sibling translation nodes，而不是替换或包裹 source DOM。
- 使用纯模型对齐，并跳过非法 block。
- Provider 输出要求 translated-part 形式，因为 `x-ai/grok-4.1-fast` 按顺序生成译文片段并选择扩展拥有的 source span ids，应比计算字符 offsets 或 target occurrences 更稳定。现在 source ranges 来自扩展生成的 span 表，target offsets 由 translated part 顺序解析。
- 使用 IndexedDB 存储缓存和记录，因为翻译缓存、字典缓存和事件历史可能超过小型 settings storage 的合理范围。
- 使用 `requestChunkSize`、`requestConcurrency`、`contextWindowChars`、`translationRetryCount` 和 `tolerantProviderOutput` 设置，让用户可以调节延迟、provider rate-limit 行为、发送给 provider 的相邻上下文长度、重试行为，以及是否恢复不完整 provider 输出。
- 当前保持 provider 逻辑通用，OpenRouter headers 隔离在 provider-header helper 中。
- 在真实 `LICENSE` 文件添加之前，不声明具体开源 license。
