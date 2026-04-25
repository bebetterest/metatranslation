# metatranslation

面向桌面 Chrome/Edge 的 MV3 网页翻译扩展。它保留网页原文，在原文下一条视觉行渲染译文，支持源文/译文 span 悬浮联动，并在源文侧稳定悬浮后记录词汇。

> 状态：活跃原型。当前适合本地开发和未打包扩展测试；公开发布前应补充 license 文件、发布说明和最终隐私审查。

English documentation: [README.md](README.md)

## 目录

- [为什么做](#为什么做)
- [功能](#功能)
- [当前范围](#当前范围)
- [快速开始](#快速开始)
- [配置](#配置)
- [使用](#使用)
- [架构](#架构)
- [开发](#开发)
- [测试](#测试)
- [打包](#打包)
- [隐私与安全](#隐私与安全)
- [贡献](#贡献)
- [路线图](#路线图)
- [License](#license)

## 为什么做

多数网页翻译扩展会替换原文，或者隐藏过多原始页面结构。metatranslation 采用更保守的路线：

- 尽量保留源 DOM。
- 用相邻行注入译文，而不是替换原文。
- 使用模型返回的 source-span alignment 做悬浮高亮。
- 跳过不安全或模糊的 block，而不是猜测。
- 保持 provider 调用、DOM 提取、渲染、存储和 records UI 模块化。

## 功能

- 通过扩展按钮或网页右键菜单手动触发翻译。
- 按从上到下发现标题、段落、列表项、链接、按钮和受支持的 input 按钮。
- 原始 DOM 文本保持不变；注入译文继承源文本的字体、字号、行高、颜色和文本装饰。
- 链接、按钮、密集 flex/grid 布局、absolute/fixed 标签使用内部第二行策略，避免挤压横向 UI。
- 渐进式并发翻译：完成的 chunk 会立即渲染，不等待整页队列。
- 使用 `MutationObserver` 对 SPA 变化、局部重渲染和新增内容进行增量更新。
- 完整页面导航会重置当前文档的翻译状态，因此新文档中的右键菜单会回到 `翻译本页`。
- 使用已校验的模型 alignment，在源文词/短语和译文 span 之间悬浮联动高亮。
- 源文悬浮字典弹窗支持 WiktApi 或 FreeDictionaryAPI，并带本地查询缓存和来源链接。
- 源文侧稳定悬浮 2 秒后记录词汇，支持聚合词频和事件历史。
- Options 页面支持 provider 设置、目标语言、并发、重试、字典行为、记录搜索、排序和 CSV 导出。
- IndexedDB 存储翻译缓存、字典缓存、聚合词汇记录和词汇事件历史。
- CSV 导出包含 UTF-8 BOM，并中和电子表格公式前缀。
- 提供可重复执行的构建、测试、浏览器 smoke、E2E 和 zip 打包脚本。

## 当前范围

- 支持浏览器：桌面 Chrome 和 Edge，Manifest V3。
- 支持安装方式：从 `dist` 加载未打包扩展。
- v1 暂不支持：Firefox、Safari、默认全站自动翻译、本地启发式 alignment 兜底。
- 翻译 API 形态：OpenAI 兼容的 `chat/completions`。
- 对齐策略：仅使用模型 alignment。非法输出会重试，仍失败则跳过，不做猜测。

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
| `WiktApi Edition` | `en` | WiktApi 查询使用的 Wiktionary edition。 |
| `Dictionary Hover Hold (ms)` | `1000` | 鼠标从源文移动到字典弹窗时的保活窗口；`0` 表示立即关闭。 |

Provider 请求细节：

- 发送 `response_format: { type: "json_schema", json_schema: ... }`。
- 默认发送 `reasoning: { "effort": "none" }`。
- 不发送 `reasoning_split`。
- OpenRouter 特定 headers 保持隔离在 provider-header 逻辑中。
- Provider prompt 会把网页 text、相邻 context 和 page URL 视为不可信数据。
- 使用三个多语言 format-only alignment 示例，并在 background diagnostics 中报告更细的 provider-output failure counts 和聚合 alignment coverage。

## 使用

- 使用扩展按钮或网页右键菜单手动触发翻译。
- 在同一文档中再次触发会关闭翻译并移除注入节点。
- 导航到新文档后需要再次触发翻译；完整页面导航会重置上一页状态。
- 悬浮源文 span 或译文 span 时，会高亮其对齐 counterpart。
- 当存在合法 alignment 时，在源文 span 上稳定悬浮 2 秒会记录词汇。
- 启用字典查询时，悬浮源文 span 会打开字典弹窗。
- 在 Options 页面可以搜索、排序和导出词汇记录。
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

关键路径：

- `manifest.config.ts`：MV3 manifest 定义。
- `src/background/index.ts`：service worker、action/context-menu 处理、消息路由、缓存编排、记录入口。
- `src/background/openai.ts`：OpenAI 兼容请求构建、JSON 提取、重试、输出校验。
- `src/background/dictionary.ts`：WiktApi 和 FreeDictionaryAPI 查询归一化。
- `src/background/db.ts`：IndexedDB stores，用于翻译缓存、字典缓存、词汇记录和词汇事件。
- `src/content/injected.ts`：注入 runtime、DOM 提取、mutation 跟踪、渲染、悬浮映射、高亮 overlay、记录计时器。
- `src/lib/alignment.ts`：alignment 清洗与校验。
- `src/lib/sourceSpans.ts`：为 provider prompt 生成 source spans。
- `src/lib/settings.ts`：设置归一化。
- `src/options/main.ts`：Options 和 records UI 行为。
- `scripts/`：构建、打包、单元测试、smoke、mock E2E、real E2E 和 live-page smoke 辅助脚本。
- `docs/TECHNICAL_PLAN.md`：当前技术路线、验证状态、风险和下一步。
- `AGENTS.md`：coding-agent 工作流和项目规则。

## 开发

使用仓库脚本和本地依赖。项目已经有脚本时，避免使用临时全局工具替代。

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

## 测试

聚焦检查：

```bash
npm run test:unit
```

当前覆盖 alignment 校验、translated-part provider schema、source-span 处理、tolerant output 恢复、字典 provider 解析、OpenRouter header 兼容、JSON 提取、设置归一化和 CSV 转义。

构建验证：

```bash
npm run build
```

浏览器 smoke test：

```bash
BROWSER_BIN="/path/to/Chromium-or-Chrome-for-Testing" npm run smoke:test
```

Mock provider 浏览器 E2E：

```bash
BROWSER_BIN="/path/to/Chrome for Testing" npm run e2e:mock
```

使用本地 mock provider 的真实页面 smoke：

```bash
BROWSER_BIN="/path/to/Chrome for Testing" \
PAGE_SMOKE_URL="https://www.reddit.com/r/MachineLearning/comments/b179cs/d_the_bitter_lesson/" \
npm run e2e:page
```

使用真实 provider 的真实页面 smoke：

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

真实 API fixture E2E：

```bash
BROWSER_BIN="/path/to/Chrome for Testing" \
REAL_TEST_BASE_URL="https://provider.example/v1" \
REAL_TEST_KEY="..." \
REAL_TEST_MODEL="model-id" \
REAL_TEST_TARGET_LANG="zh-CN" \
npm run e2e:real
```

自动化说明：建议使用 Chromium 或 Chrome for Testing。一些品牌版 Google Chrome 会在自动化场景中拒绝 `--load-extension`。

## 打包

```bash
npm run package:zip
```

打包脚本会重新构建扩展，并写入 `artifacts/metatranslation-<version>.zip`。生成的压缩包不要提交到 git。

### 自动 GitHub Release

向 `main` 推送并且 `package.json` 的 `version` 发生变化时，会运行 `Release on package version change` workflow。该 workflow 会比较前后两个 package version；当版本变化时，它会使用 `npm ci` 安装依赖，校验根 `package-lock.json` 版本，运行 `npm run test:unit`，运行 `npm run package:zip`，创建 `v<version>` tag，并发布包含 `artifacts/metatranslation-<version>.zip` 的 GitHub Release。

如果 `package.json` 有变化但 `version` 值没有变化，workflow 会直接退出，不发布 release。准备 release 版本时，应保持 `package-lock.json` 同步，并确认不存在同名 `v<version>` tag。

## 隐私与安全

- 被选中用于翻译的页面文本会发送到配置的 provider。
- API key 存储在 `chrome.storage.local`。
- 翻译缓存、字典缓存、词汇记录和词汇事件存储在本地 IndexedDB。
- 除配置的翻译 provider 和字典 provider 外，扩展不会有意发送 records 或 cache 内容。
- 字典查询会把悬浮的源词和语言元数据发送到选定字典 provider。
- CSV 导出包含网页文本和 URL；分享前应自行检查。
- 不要提交真实 API key、包含隐私页面的截图、浏览器 profile 或生成产物。

## 贡献

提交变更前：

1. 阅读 [AGENTS.md](AGENTS.md) 了解仓库约定。
2. 保持英文 Markdown 文档与对应 `*_cn.md` 翻译同步。
3. 逻辑改动使用聚焦模块测试；扩展行为改动使用浏览器测试。
4. 至少运行 `npm run test:unit` 和 `npm run build`。
5. 除非已经讨论清楚取舍，不要引入 provider-specific 行为。
6. 除非明确要求，不要添加本地启发式 alignment fallback。
7. 准备 GitHub Release 时，同时 bump `package.json` 和 `package-lock.json`。
8. 保持 `dist/`、`artifacts/`、`.npm-cache/`、截图和浏览器 profile 等生成文件不被追踪。

## 路线图

- 增加 content-runtime 提取边界的聚焦测试。
- 增加 skipped blocks 和非法 provider 输出的可选 debug export。
- 公开发布前完善 release metadata，包括 license 文件、changelog 和隐私政策。
- prompt 或输出契约变化后重新运行真实 provider E2E。
- 通过真实页面 smoke tests 持续调优页面布局处理，避免站点特化 hack。

## License

当前尚未包含 license 文件。公开开源分发前应添加明确的 `LICENSE` 文件。
