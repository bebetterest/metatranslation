# metatranslation

<p align="center">
  <img src="docs/assets/metatranslation-header.png" alt="metatranslation 保留网页原文，在下方渲染译文，并在悬浮时联动高亮对齐短语" width="100%">
</p>

<p align="center">
  面向桌面 Chrome 和 Edge 的双行网页翻译扩展。它保留网页原文，在原文下方渲染译文，支持模型对齐悬浮高亮，并在源文侧稳定悬浮后记录词汇。
</p>

<p align="center">
  <a href="README.md">English documentation</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#配置">配置</a> ·
  <a href="#测试矩阵">测试</a> ·
  <a href="#贡献">贡献</a>
</p>

<p align="center">
  <img alt="状态：活跃原型" src="https://img.shields.io/badge/status-active%20prototype-0f766e">
  <img alt="平台：Chrome 和 Edge MV3" src="https://img.shields.io/badge/platform-Chrome%2FEdge%20MV3-2563eb">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6.x-3178c6">
  <img alt="License：尚未选择" src="https://img.shields.io/badge/license-not%20selected-lightgrey">
</p>

> 状态：活跃原型。当前适合本地开发和未打包扩展测试；公开分发前仍需要明确的 `LICENSE` 文件、发布说明或 changelog，以及最终隐私审查。

## 目录

- [项目状态](#项目状态)
- [亮点](#亮点)
- [功能范围](#功能范围)
- [快速开始](#快速开始)
- [配置](#配置)
- [使用](#使用)
- [架构](#架构)
- [开发](#开发)
- [测试矩阵](#测试矩阵)
- [打包与发布](#打包与发布)
- [隐私与安全](#隐私与安全)
- [贡献](#贡献)
- [路线图](#路线图)
- [License](#license)

## 项目状态

metatranslation 是一个 Chromium Manifest V3 扩展，面向仍然需要保留原文阅读语境的网页翻译场景。它不会替换源文本，而是在原始阅读流旁注入译文行，使用模型返回的 source-span alignment 做悬浮高亮，并且只在源文侧稳定悬浮后记录词汇。

当前发布状态：

- 目标浏览器：桌面 Chrome 和 Edge，Manifest V3。
- 安装方式：从生成的 `dist` 目录加载本地未打包扩展。
- API 形态：OpenAI 兼容的 `chat/completions`。
- 对齐策略：仅使用模型 alignment。非法 block 会重试，仍失败则跳过，不做猜测。
- 发布准备度：已有打包和 GitHub Release 自动化；公开分发仍受 license、发布说明和隐私审查阻塞。

## 亮点

- 保留原始网页文本，并把译文注入为下一条视觉行。
- 渐进式并发翻译；完成的 chunk 立即渲染。
- 在使用悬浮 alignment 前先校验 translated-part 模型输出。
- Provider prompt 明确把网页文本、相邻上下文和页面 URL 视为不可信数据。
- 支持源文/译文悬浮高亮、源文悬浮字典查询和词汇记录。
- 通过 Chrome i18n 为 manifest、右键菜单、Options 页面、页面内诊断和字典弹窗提供英文与简体中文界面。
- 设置存储在 `chrome.storage.local`，缓存和记录数据存储在 IndexedDB。
- 提供可选测试模式日志，用于本地排查问题，并支持脱敏、有界保留和在 Options 页面导出 JSON。
- 提供聚焦单元检查、浏览器 smoke、mock-provider E2E、real-provider E2E 和打包自动化。

## 功能范围

| 领域 | 当前行为 |
| --- | --- |
| 激活 | 通过扩展按钮或网页右键菜单手动切换。默认不做全站自动翻译。 |
| 提取 | 使用保守的从上到下 `TreeWalker` 发现标题、段落、列表项、链接、按钮和受支持的 input 按钮。 |
| 渲染 | 源 DOM 文本保持原位。译文节点继承源文本样式，并可在关闭时清理。密集 flex/grid 和 overlay label 使用内部第二行渲染。 |
| 翻译 | OpenAI 兼容 provider 调用，使用 structured JSON schema 输出，并支持配置目标语言、上下文窗口、并发、chunk size、超时和重试次数。 |
| 对齐 | 模型返回 `translatedParts[].sourceSpanIds`；扩展在本地派生运行时 source/target ranges。支持严格和容错校验模式。 |
| 字典 | 源文悬浮字典弹窗可使用 WiktApi、FreeDictionaryAPI 或关闭。字典查询会保留原词大小写，拉丁词先查英文再回退到全语言查询，全语言结果会按可能的源语言排序，并本地缓存归一化结果。 |
| 记录 | 源文侧稳定悬浮 2 秒后记录词汇命中、聚合次数、最近上下文、URL 和事件历史。 |
| 导出 | Records CSV 导出包含 UTF-8 BOM，并中和来自不可信页面文本的电子表格公式前缀。 |
| 诊断 | 页面内状态面板和 background diagnostics 会展示 skipped blocks、failed chunks、provider-output failure categories、alignment coverage，以及可选测试模式事件日志。 |
| 界面语言 | 扩展界面跟随浏览器 UI 语言。默认 locale 为英文，并支持简体中文；这与 `Target Language` 相互独立。 |

当前范围暂不支持：

- Firefox 和 Safari。
- 默认全站自动翻译。
- 本地启发式 alignment fallback。
- 面向公开商店分发的打包流程。

## 快速开始

### 环境要求

- Node.js `20.19+` 或 `22.12+`。
- npm。
- 桌面 Chrome、Edge、Chromium 或 Chrome for Testing。
- 一个 OpenAI 兼容翻译 provider key。

### 安装依赖

```bash
npm install --cache .npm-cache
```

### 构建

```bash
npm run build
```

### 加载扩展

1. 打开 `chrome://extensions`。
2. 启用 `Developer mode`。
3. 点击 `Load unpacked`。
4. 选择本仓库的 `dist` 目录。
5. 打开扩展 Options 页面。
6. 配置 `Base URL`、`API Key`、`Model` 和 `Target Language`。
7. 打开任意普通 `http` 或 `https` 页面。
8. 点击扩展按钮或网页右键菜单项来翻译页面。

## 配置

扩展调用 OpenAI 兼容的 `chat/completions` endpoint。可以使用 `https://openrouter.ai/api/v1` 这类 provider 根地址；代码会移除尾部斜杠，并在尚未包含时自动追加 `/chat/completions`。

本地 Ollama 模型可使用 `http://127.0.0.1:11434` 或 `http://127.0.0.1:11434/v1`，`API Key` 填任意非空占位值例如 `ollama`，`Model` 填已安装模型例如 `qwen2.5:0.5b`。默认本地 Ollama 根地址会解析为 `/v1/chat/completions`。Chrome extension 请求通常会带 `chrome-extension://...` `Origin`，默认 Ollama 会拒绝；扩展会以最佳努力安装一个 session 级请求头规则，只对发往本地 Ollama `11434` 端口的 background 请求移除 `Origin`。OpenRouter 等远端 provider 不会命中该规则。如果把 Ollama 暴露在非默认 host 或 port，请改用 Ollama 的 `OLLAMA_ORIGINS` 配置。

扩展界面语言通过 `_locales` 跟随 Chrome 或 Edge 的 UI 语言。切换界面语言不会改变 `Target Language`；该设置仍只控制发送到 provider prompt 的译文目标语言。

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `Base URL` | `https://openrouter.ai/api/v1` | OpenAI 兼容 provider 根地址或完整 chat completions URL。 |
| `API Key` | 空 | 存储在 `chrome.storage.local`；不要提交真实 key。 |
| `Model` | `x-ai/grok-4.1-fast` | 用于翻译和 source-span alignment 的模型。 |
| `Target Language` | `zh-CN` | 作为权威目标语言注入 provider prompt。 |
| `Timeout (ms)` | `30000` | 单次请求超时时间。 |
| `Request Chunk Size` | `1` | 每个 provider 请求包含的文本 block 数量。 |
| `Parallel Requests` | `64` | content runtime 最大并发翻译请求数。 |
| `Context Window Chars` | `100` | 用于消歧的相邻源文上下文；`0` 表示关闭相邻上下文。 |
| `Retry Count` | `2` | 首次失败或非法模型调用后的重试次数；`0` 关闭 retry passes。 |
| `Tolerant Provider Output` | 开启 | 当模型 JSON 有瑕疵但可安全恢复时，保留有效文本；排查严格 provider 契约时可关闭。 |
| `Dictionary Provider` | `WiktApi` | `WiktApi`、`FreeDictionaryAPI` 或 `Off`。 |
| `Dictionary Hover Hold (ms)` | `1000` | 鼠标从源文移动到字典弹窗时的保活窗口；`0` 表示立即关闭。 |
| `Test Mode` | 关闭 | 为 background 和 content-runtime 事件写入有上限的本地排障日志。API key 和 auth token 会被脱敏。 |

Provider 请求细节：

- 发送 `response_format: { type: "json_schema", json_schema: ... }`。
- 默认发送 `reasoning: { "effort": "none" }`。
- 不发送 `reasoning_split`。
- OpenRouter 特定 headers 保持隔离在 provider-header 逻辑中。
- 只对发往本地 Ollama 默认 `http://localhost:11434` 系列 endpoint 的扩展 background 请求移除 `Origin`。
- 默认本地 Ollama 根地址会解析为 `/v1/chat/completions`；其他 provider root 仍追加 `/chat/completions`。
- Provider prompt 会把网页 text、相邻 context 和 page URL 视为不可信数据。
- 使用三个多语言 format-only alignment 示例。
- 在 background diagnostics 中报告更细的 provider-output failure counts 和聚合 alignment coverage。

## 使用

- 使用扩展按钮或网页右键菜单手动触发翻译。
- 在同一文档中再次触发会关闭翻译并移除注入节点。
- 导航到新文档后需要再次触发翻译；完整页面导航会重置上一页状态。
- 悬浮源文 span 或译文 span 时，会高亮其对齐 counterpart。
- 当存在合法 alignment 时，在源文 span 上稳定悬浮 2 秒会记录词汇。
- 启用字典查询时，悬浮源文 span 会打开字典弹窗。
- 在 Options 页面可以搜索、排序和导出词汇记录。
- 排查问题时，可在 Options 页面开启 `Test Mode`，复现后刷新或将 Test Logs 面板导出为 JSON。
- 通过浏览器 UI 语言在英文和简体中文扩展界面之间切换。`Target Language` 只用于控制译文输出。
- 如果开启翻译后页面看起来没有变化，先检查右下角诊断面板。没有面板表示 runtime 没有注入；错误面板通常表示 provider 失败；跳过数很高表示模型输出非法或为空。

## 架构

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
  - test logs
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
  - test log view/export/clear
  - records search/sort/export
```

关键路径：

- `manifest.config.ts`：MV3 manifest 定义。
- `public/_locales/*/messages.json`：英文与简体中文 UI 文案，用于 manifest、右键菜单、Options、诊断和字典弹窗。
- `docs/assets/metatranslation-header.png`：README 头图。
- `src/background/index.ts`：service worker、action/context-menu 处理、消息路由、缓存编排、记录入口。
- `src/background/openai.ts`：OpenAI 兼容请求构建、JSON 提取、重试、输出校验。
- `src/background/localOllama.ts`：共享的本地 Ollama URL 判断和默认 endpoint 解析 helper。
- `src/background/localOllamaCors.ts`：本地 Ollama 请求头规则作用域控制，用于 extension Origin 兼容。
- `src/background/dictionary.ts`：WiktApi 和 FreeDictionaryAPI 查询归一化。
- `src/background/testLogs.ts`：有界本地 Test Mode 日志存储、脱敏、查询和清空 helper。
- `src/background/db.ts`：IndexedDB stores，用于翻译缓存、字典缓存、词汇记录和词汇事件。
- `src/content/injected.ts`：注入 runtime、DOM 提取、mutation 跟踪、渲染、悬浮映射、高亮 overlay、记录计时器。
- `src/lib/alignment.ts`：alignment 清洗与校验。
- `src/lib/sourceSpans.ts`：为 provider prompt 生成 source spans。
- `src/lib/settings.ts`：设置归一化。
- `src/lib/i18n.ts`：Options/background 共享的 Chrome i18n message lookup 辅助函数。
- `src/options/main.ts`：Options 和 records UI 行为。
- `scripts/`：构建、打包、单元测试、smoke、mock E2E、real E2E 和 live-page smoke 辅助脚本。
- `docs/TECHNICAL_PLAN.md`：当前技术路线、验证状态、风险和下一步。
- `AGENTS.md`：coding-agent 工作流和项目规则。

## 开发

使用仓库脚本和本地依赖。项目已经有脚本时，避免使用临时全局工具替代。TypeScript 构建会开启严格的未使用代码检查。`package.json` 保留了 `rollup@2.80.0` 的 npm override，因为 `@crxjs/vite-plugin@2.4.0` 依赖较旧且存在漏洞的 Rollup 2 构建。

```bash
npm install --cache .npm-cache
npm run test:unit
npm run build
npm test
```

常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm run build` | 类型检查并构建扩展到 `dist`。 |
| `npm run test:unit` | 运行聚焦模块检查。 |
| `npm test` | 运行单元检查和构建。 |
| `npm run smoke:test` | 在浏览器中加载构建后的扩展并验证基础注册/UI。 |
| `npm run e2e:mock` | 使用本地 mock provider 运行浏览器 E2E。 |
| `npm run e2e:page` | 使用 mock 或真实 provider 运行真实页面 smoke。 |
| `npm run e2e:real` | 使用配置的真实 provider 运行 fixture E2E。 |
| `npm run package:zip` | 重新构建并生成 `artifacts/metatranslation-<version>.zip`。 |

## 测试矩阵

| 层级 | 命令 | 用途 |
| --- | --- | --- |
| 聚焦单元检查 | `npm run test:unit` | 校验 alignment validation、provider schema、prompt contract、dictionary parsing、settings normalization、diagnostics、Test Mode log sanitization、CSV escaping 和 i18n locale 完整性。 |
| 类型检查与构建 | `npm run build` | 确认 TypeScript 和 Vite 能把 MV3 扩展构建到 `dist`。 |
| 组合本地验证 | `npm test` | 一条命令运行聚焦检查和构建。 |
| 依赖审计 | `npm audit --cache .npm-cache` | 使用本地 npm cache 检查已安装依赖漏洞状态。 |
| 浏览器 smoke | `BROWSER_BIN="/path/to/Chromium-or-Chrome-for-Testing" npm run smoke:test` | 加载构建后的扩展并验证基础注册/UI。 |
| Mock-provider E2E | `BROWSER_BIN="/path/to/Chrome for Testing" npm run e2e:mock` | 不消耗真实 API quota 验证扩展行为。 |
| 真实页面 smoke | `BROWSER_BIN="/path/to/Chrome for Testing" PAGE_SMOKE_URL="https://example.com" npm run e2e:page` | 使用 mock 或真实 provider 设置在 live page 上运行扩展。 |
| 真实 provider fixture E2E | `BROWSER_BIN="/path/to/Chrome for Testing" REAL_TEST_BASE_URL="https://provider.example/v1" REAL_TEST_KEY="..." REAL_TEST_MODEL="model-id" npm run e2e:real` | 通过扩展 background 翻译路径验证配置的 provider。 |

自动化说明：建议使用 Chromium 或 Chrome for Testing。一些品牌版 Google Chrome 会在自动化场景中拒绝 `--load-extension`。

## 打包与发布

```bash
npm run package:zip
```

打包脚本会重新构建扩展，并写入 `artifacts/metatranslation-<version>.zip`。生成的压缩包不要提交到 git。

向 `main` 推送并且 `package.json` 的 `version` 发生变化时，会运行 `Release on package version change` workflow。该 workflow 会比较前后两个 package version；当版本变化时，它会使用 `npm ci` 安装依赖，校验根 `package-lock.json` 版本，运行 `npm run test:unit`，运行 `npm run package:zip`，创建 `v<version>` tag，并发布包含 `artifacts/metatranslation-<version>.zip` 的 GitHub Release。

如果 `package.json` 有变化但 `version` 值没有变化，workflow 会直接退出，不发布 release。准备 release 版本时，应保持 `package-lock.json` 同步，并确认不存在同名 `v<version>` tag。

## 隐私与安全

- 被选中用于翻译的页面文本会发送到配置的 provider。
- API key 存储在 `chrome.storage.local`。
- 翻译缓存、字典缓存、词汇记录和词汇事件存储在本地 IndexedDB。
- Test Mode 日志仅在开启时写入并存储在本地 `chrome.storage.local`，只保留有上限的最近历史，并会脱敏 API keys、authorization headers、tokens、secrets 和 passwords。日志可能包含页面 URL、事件元数据、diagnostics，以及悬浮或记录的词，但不会有意记录完整翻译请求文本。
- 除配置的翻译 provider 和字典 provider 外，扩展不会有意发送 records 或 cache 内容。
- 字典查询会把悬浮的源词和语言元数据发送到选定字典 provider。
- `declarativeNetRequestWithHostAccess` 权限只用于对发往本地 Ollama `11434` 端口的扩展 background 请求移除 `Origin` 请求头。
- CSV 导出包含网页文本和 URL；分享前应自行检查。
- 不要提交真实 API key、包含隐私页面的截图、浏览器 profile 或生成产物。

## 贡献

提交变更前：

1. 阅读 [AGENTS.md](AGENTS.md) 了解仓库约定。
2. 保持英文 Markdown 文档与对应 `*_cn.md` 翻译同步。
3. 当行为、验证状态、风险或发布状态变化时，更新 [docs/TECHNICAL_PLAN.md](docs/TECHNICAL_PLAN.md)。
4. 逻辑改动使用聚焦模块测试；扩展行为改动使用浏览器测试。
5. 至少运行 `npm run test:unit` 和 `npm run build`。
6. 除非已经讨论清楚取舍，不要引入 provider-specific 行为。
7. 除非明确要求，不要添加本地启发式 alignment fallback。
8. 准备 GitHub Release 时，同时 bump `package.json` 和 `package-lock.json`。
9. 保持 `dist/`、`artifacts/`、`.npm-cache/`、截图和浏览器 profile 等生成文件不被追踪。

## 路线图

- 增加 content-runtime 提取边界的聚焦测试。
- 为 Test Logs 面板增加过滤和搜索控件。
- 公开发布前完善 release metadata，包括 license 文件、changelog 和隐私政策。
- prompt 或输出契约变化后重新运行真实 provider E2E。
- 通过真实页面 smoke tests 持续调优页面布局处理，避免站点特化 hack。

## License

当前尚未包含 license 文件。公开开源分发前应添加明确的 `LICENSE` 文件。
