export function contentRuntimeBootstrap() {
  const GLOBAL_KEY = '__dual_line_translator_runtime__';
  const ROOT_ROLE = 'dlt-root';
  const TRANSLATION_ROLE = 'dlt-translation';
  const HIGHLIGHT_ROLE = 'dlt-highlight';
  const DICTIONARY_ROLE = 'dlt-dictionary';
  const STYLE_ROLE = 'dlt-style';
  const CONTROL_ROLE = 'dlt-control';
  const STATUS_ROLE = 'dlt-status';
  const RECORD_DELAY_MS = 2000;
  const DEFAULT_DICTIONARY_HOVER_HOLD_MS = 1000;
  const MAX_DICTIONARY_HOVER_HOLD_MS = 5000;
  const MUTATION_FLUSH_DELAY_MS = 500;
  const MIN_TEXT_LENGTH = 3;
  const MAX_TEXT_LENGTH = 1600;
  const TEXT_BLOCK_TAGS = new Set([
    'P',
    'LI',
    'BLOCKQUOTE',
    'FIGCAPTION',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
  ]);
  const GENERIC_TEXT_TAGS = new Set([
    'DIV',
    'SPAN',
    'LABEL',
    'SUMMARY',
    'CAPTION',
    'DT',
    'DD',
    'TH',
    'TD',
  ]);
  const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT']);
  const BLOCK_DESCENDANT_SELECTOR = [
    'p',
    'li',
    'blockquote',
    'figcaption',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'a',
    'button',
    'input[type="button"]',
    'input[type="submit"]',
    'input[type="reset"]',
  ].join(',');
  const HARD_SKIP_SELECTOR = [
    'textarea',
    'select',
    'option',
    'code',
    'pre',
    'kbd',
    'samp',
    'script',
    'style',
    'svg',
    'canvas',
    'video',
    'audio',
    'iframe',
    'noscript',
    '[contenteditable]:not([contenteditable="false"])',
    '[data-dlt-role]',
  ].join(',');

  const win = window as Window & {
    [GLOBAL_KEY]?: { initialized: boolean };
  };

  if (win[GLOBAL_KEY]?.initialized) {
    return;
  }

  win[GLOBAL_KEY] = { initialized: true };

  type AlignmentSpan = {
    alignmentId: string;
    sourceRanges: Array<{
      start: number;
      end: number;
    }>;
    targetStart: number;
    targetEnd: number;
    sourceText: string;
  };

  type TranslationResultBlock = {
    id: string;
    sourceLang: string;
    translatedText: string;
    alignments: AlignmentSpan[];
  };

  type TranslationDiagnostics = {
    outputFailures: number;
    lastOutputError: string;
    failureCounts: Partial<Record<
      | 'parse_error'
      | 'missing_blocks_array'
      | 'missing_output_id'
      | 'duplicate_output_id'
      | 'unexpected_output_id'
      | 'missing_output_block'
      | 'invalid_output_block',
      number
    >>;
    alignmentCoverage: {
      acceptedBlocks: number;
      alignedBlocks: number;
      unalignedBlocks: number;
      sourceSpansTotal: number;
      sourceSpansAligned: number;
      sourceSpanCoverage: number;
      targetCharsTotal: number;
      targetCharsAligned: number;
      targetCharCoverage: number;
    };
  };

  type TranslationResponse = {
    blocks: TranslationResultBlock[];
    diagnostics?: TranslationDiagnostics;
  };

  type ExtensionSettings = {
    baseUrl: string;
    apiKey: string;
    model: string;
    targetLang: string;
    timeoutMs: number;
    requestChunkSize: number;
    requestConcurrency: number;
    contextWindowChars: number;
    translationRetryCount: number;
    dictionaryProvider: 'off' | 'wiktapi' | 'freedictionaryapi';
    dictionaryEdition: string;
    dictionaryHoverHoldMs: number;
    tolerantProviderOutput: boolean;
  };

  type DictionaryEntry = {
    provider: 'wiktapi' | 'freedictionaryapi';
    word: string;
    sourceLang: string;
    partOfSpeech: string;
    pronunciations: string[];
    definitions: string[];
    examples: string[];
    translations: string[];
    sourceUrl: string;
    license: string;
  };

  type DictionaryLookupResult = {
    provider: 'off' | 'wiktapi' | 'freedictionaryapi';
    word: string;
    normalizedWord: string;
    sourceLang: string;
    targetLang: string;
    entries: DictionaryEntry[];
    sourceUrl: string;
    attribution: string;
    fetchedAt: number;
  };

  type Segment = {
    node: Text;
    start: number;
    end: number;
  };

  type BlockState = {
    id: string;
    element: Element;
    text: string;
    segments: Segment[];
    segmentMap: Map<Text, Segment>;
    renderMode: 'text' | 'interactive';
    renderSignature: string;
    revision: number;
    translation: TranslationResultBlock | null;
    translationNode: HTMLElement | null;
  };

  type ActiveHighlight = {
    blockId: string;
    alignmentId: string;
    origin: 'source' | 'target';
  };

  type RuntimeStats = {
    discovered: number;
    requested: number;
    translated: number;
    skipped: number;
    failed: number;
    lastError: string;
  };

  let enabled = false;
  let settings: ExtensionSettings | null = null;
  let nextBlockId = 1;
  let observer: MutationObserver | null = null;
  let styleElement: HTMLStyleElement | null = null;
  let highlightLayer: HTMLDivElement | null = null;
  let dictionaryTooltip: HTMLDivElement | null = null;
  let statusElement: HTMLDivElement | null = null;
  let blocksById = new Map<string, BlockState>();
  let elementToBlockId = new WeakMap<Element, string>();
  let inlineControlLayoutPatches = new WeakMap<
    HTMLElement,
    { flexWrap: string; widthPx: number; appliedFlexWrap: boolean }
  >();
  let dirtyBlockIds = new Set<string>();
  let pendingRoots = new Set<Element>();
  let mutationTimer: number | null = null;
  let translationQueue = Promise.resolve();
  let lifecycleVersion = 0;
  let activeHighlight: ActiveHighlight | null = null;
  let recordTimer: number | null = null;
  let dictionaryHideTimer: number | null = null;
  let pendingRecordSignature = '';
  let completedRecordSignature = '';
  let activeDictionarySignature = '';
  let dictionaryRequestSerial = 0;
  const dictionaryResultCache = new Map<string, DictionaryLookupResult>();
  let currentHref = location.href;
  let historyPatched = false;
  let runtimeStats: RuntimeStats = createRuntimeStats();

  ensureChromeBridge();
  attachGlobalListeners();
  patchHistory();

  chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
    if (message?.type === 'runtime:ping') {
      sendResponse({ ok: true, enabled });
      return false;
    }

    if (message?.type === 'runtime:toggle') {
      void toggleEnabled()
        .then((currentEnabled) => sendResponse({ ok: true, enabled: currentEnabled }))
        .catch((error: unknown) =>
          sendResponse({
            error: error instanceof Error ? error.message : getUiMessage('runtimeToggleFailed'),
          }),
        );
      return true;
    }

    return false;
  });

  void chrome.runtime.sendMessage({
    type: 'runtime:ready',
    href: location.href,
  }).catch(() => undefined);

  async function toggleEnabled(): Promise<boolean> {
    if (enabled) {
      disableRuntime();
      return false;
    }

    await enableRuntime();
    return true;
  }

  async function enableRuntime(): Promise<void> {
    if (enabled) {
      return;
    }

    const version = ++lifecycleVersion;
    settings = await getSettings();
    runtimeStats = createRuntimeStats();
    resetTranslationQueue();
    ensureStyle();
    ensureHighlightLayer();
    ensureStatusPanel();
    updateStatusPanel(getUiMessage('statusScanningPage'));
    enabled = true;
    currentHref = location.href;
    cleanupAllBlocks();
    observeMutations();
    void translateDiscoveredBlocks([document.body], version).catch((error: unknown) => {
      if (!enabled || version !== lifecycleVersion) {
        return;
      }
      reportRuntimeError(error);
    });
  }

  function disableRuntime(): void {
    if (!enabled) {
      return;
    }

    enabled = false;
    lifecycleVersion += 1;
    resetTranslationQueue();
    observer?.disconnect();
    observer = null;
    cancelMutationFlush();
    cancelRecordTimer();
    clearHighlight();
    cleanupAllBlocks();
    destroyRuntimeArtifacts();
  }

  function cleanupAllBlocks(): void {
    for (const block of blocksById.values()) {
      block.translationNode?.remove();
      restoreInlineControlLayout(block.element);
    }

    blocksById = new Map();
    elementToBlockId = new WeakMap();
    inlineControlLayoutPatches = new WeakMap();
    dirtyBlockIds = new Set();
    pendingRoots = new Set();
  }

  function destroyRuntimeArtifacts(): void {
    cancelDictionaryHideTimer();
    highlightLayer?.remove();
    highlightLayer = null;
    dictionaryTooltip?.remove();
    dictionaryTooltip = null;
    activeDictionarySignature = '';
    statusElement?.remove();
    statusElement = null;
    styleElement?.remove();
    styleElement = null;
  }

  function observeMutations(): void {
    observer?.disconnect();

    observer = new MutationObserver((mutations) => {
      if (!enabled) {
        return;
      }

      let sawPageMutation = false;

      for (const mutation of mutations) {
        if (isExtensionOnlyMutation(mutation)) {
          continue;
        }

        sawPageMutation = true;

        if (mutation.type === 'characterData') {
          const block = findBlockForNode(mutation.target);
          if (block) {
            dirtyBlockIds.add(block.id);
          }
          continue;
        }

        if (mutation.type === 'attributes') {
          const block = findBlockForNode(mutation.target);
          if (block) {
            dirtyBlockIds.add(block.id);
          }
          continue;
        }

        if (mutation.type === 'childList') {
          const targetBlock = findBlockForNode(mutation.target);
          if (targetBlock) {
            dirtyBlockIds.add(targetBlock.id);
          } else if (mutation.target instanceof Element) {
            pendingRoots.add(mutation.target);
          }

          for (const node of mutation.addedNodes) {
            if (node instanceof Element && !isExtensionNode(node)) {
              pendingRoots.add(node);
            }
          }

          for (const node of mutation.removedNodes) {
            const removedBlock = findBlockForNode(node);
            if (removedBlock) {
              dirtyBlockIds.add(removedBlock.id);
            }
          }
        }
      }

      if (sawPageMutation) {
        clearHighlight();
        scheduleMutationFlush();
      }
    });

    observer.observe(document.body, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  function scheduleMutationFlush(): void {
    if (mutationTimer !== null) {
      return;
    }

    mutationTimer = window.setTimeout(() => {
      mutationTimer = null;
      void flushMutations().catch(reportRuntimeError);
    }, MUTATION_FLUSH_DELAY_MS);
  }

  function cancelMutationFlush(): void {
    if (mutationTimer !== null) {
      window.clearTimeout(mutationTimer);
      mutationTimer = null;
    }
  }

  async function flushMutations(): Promise<void> {
    if (!enabled) {
      return;
    }

    const version = lifecycleVersion;
    const dirtyIds = Array.from(dirtyBlockIds);
    const roots = Array.from(pendingRoots);
    dirtyBlockIds.clear();
    pendingRoots.clear();

    const dirtyBlocks: BlockState[] = [];

    for (const blockId of dirtyIds) {
      const block = blocksById.get(blockId);
      if (!block) {
        continue;
      }

      if (!block.element.isConnected) {
        removeBlock(block);
        continue;
      }

      const extracted = extractBlock(block.element);
      if (!extracted) {
        removeBlock(block);
        continue;
      }

      if (extracted.text !== block.text) {
        block.text = extracted.text;
        block.segments = extracted.segments;
        block.segmentMap = extracted.segmentMap;
        block.renderMode = extracted.renderMode;
        block.renderSignature = extracted.renderSignature;
        block.revision += 1;
        dirtyBlocks.push(block);
        continue;
      }

      if (
        extracted.renderMode !== block.renderMode ||
        extracted.renderSignature !== block.renderSignature
      ) {
        block.segments = extracted.segments;
        block.segmentMap = extracted.segmentMap;
        block.renderMode = extracted.renderMode;
        block.renderSignature = extracted.renderSignature;
        if (block.translation) {
          renderTranslation(block);
        }
        continue;
      }

      if (block.translation) {
        ensureTranslationPosition(block);
      }
    }

    if (dirtyBlocks.length > 0) {
      await translateBlocksInternal(dirtyBlocks, version);
    }

    if (roots.length > 0) {
      await translateDiscoveredBlocks(roots, version);
    }

    cleanupDetachedBlocks();
  }

  async function translateDiscoveredBlocks(roots: Element[], version: number): Promise<void> {
    const newBlocks: BlockState[] = [];

    for (const root of roots) {
      for (const element of collectCandidateElements(root)) {
        if (!element.isConnected || elementToBlockId.has(element) || hasTrackedAncestor(element)) {
          continue;
        }

        const extracted = extractBlock(element);
        if (!extracted) {
          continue;
        }

        const state: BlockState = {
          id: `block-${nextBlockId++}`,
          element,
          text: extracted.text,
          segments: extracted.segments,
          segmentMap: extracted.segmentMap,
          renderMode: extracted.renderMode,
          renderSignature: extracted.renderSignature,
          revision: 0,
          translation: null,
          translationNode: null,
        };

        blocksById.set(state.id, state);
        elementToBlockId.set(element, state.id);
        newBlocks.push(state);
      }
    }

    if (newBlocks.length > 0) {
      runtimeStats.discovered += newBlocks.length;
      updateStatusPanel(
        getUiMessage('statusFoundBlocksTranslating', String(runtimeStats.discovered)),
      );
    } else if (blocksById.size === 0) {
      updateStatusPanel(getUiMessage('statusNoBlocks'));
    }

    if (newBlocks.length > 0) {
      await translateBlocksInternal(newBlocks, version);
    }
  }

  async function translateBlocksInternal(blocks: BlockState[], version: number): Promise<void> {
    const states = blocks.filter((block) => block.text.trim());
    if (states.length === 0 || !settings) {
      return;
    }

    const snapshot = new Map(states.map((block) => [block.id, block.revision]));
    const contextWindowChars = normalizeContextWindowChars(settings.contextWindowChars);
    const requestBlocks = states.map((block, index) => ({
      id: block.id,
      text: block.text,
      contextBefore: buildContextBefore(states[index - 1]?.text, contextWindowChars),
      contextAfter: buildContextAfter(states[index + 1]?.text, contextWindowChars),
    }));
    const requestChunkSize = normalizePositiveInteger(settings.requestChunkSize, 1);
    const requestConcurrency = normalizePositiveInteger(settings.requestConcurrency, 64);
    runtimeStats.requested += states.length;
    updateStatusPanel(buildStatusText(getUiMessage('statusTranslatingPrefix')));

    translationQueue = translationQueue
      .catch(() => undefined)
      .then(() =>
        translateBlocksProgressively(
          states,
          requestBlocks,
          snapshot,
          version,
          requestChunkSize,
          requestConcurrency,
        ),
      );

    await translationQueue;
  }

  async function translateBlocksProgressively(
    states: BlockState[],
    requestBlocks: Array<{
      id: string;
      text: string;
      contextBefore?: string;
      contextAfter?: string;
    }>,
    snapshot: Map<string, number>,
    version: number,
    requestChunkSize: number,
    requestConcurrency: number,
  ): Promise<void> {
    const stateChunks = chunkStates(states, requestChunkSize);
    const requestChunks = chunkStates(requestBlocks, requestChunkSize);
    let nextChunkIndex = 0;

    const workerCount = Math.min(requestConcurrency, stateChunks.length);
    if (workerCount === 0) {
      return;
    }

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (enabled && version === lifecycleVersion) {
          const chunkIndex = nextChunkIndex++;
          if (chunkIndex >= stateChunks.length) {
            return;
          }

          const stateChunk = stateChunks[chunkIndex];
          const requestChunk = requestChunks[chunkIndex];

          try {
            const response = await sendMessageToBackground<TranslationResponse>({
              type: 'translation:translate-blocks',
              payload: {
                targetLang: settings?.targetLang ?? 'zh-CN',
                pageUrl: location.href,
                sourceLang: getPageLanguageHint(),
                blocks: requestChunk,
              },
            });

            if (!enabled || version !== lifecycleVersion) {
              return;
            }

            const missingCount = stateChunk.length - response.blocks.length;
            if (missingCount > 0 && response.diagnostics?.lastOutputError) {
              runtimeStats.lastError = truncateStatusText(response.diagnostics.lastOutputError);
            }

            applyChunkTranslations(stateChunk, response.blocks, snapshot);
          } catch (error) {
            runtimeStats.failed += stateChunk.length;
            reportRuntimeError(error);
          }
        }
      }),
    );
  }

  function getPageLanguageHint(): string | undefined {
    const lang = document.documentElement.lang.trim();
    return lang || undefined;
  }

  function normalizeContextWindowChars(value: number): number {
    return Number.isFinite(value) && value >= 0 ? Math.min(1000, Math.floor(value)) : 200;
  }

  function buildContextBefore(text: string | undefined, contextWindowChars: number): string | undefined {
    if (!text || contextWindowChars <= 0) {
      return undefined;
    }

    return text.slice(-contextWindowChars);
  }

  function buildContextAfter(text: string | undefined, contextWindowChars: number): string | undefined {
    if (!text || contextWindowChars <= 0) {
      return undefined;
    }

    return text.slice(0, contextWindowChars);
  }

  function applyChunkTranslations(
    states: BlockState[],
    translatedBlocks: TranslationResultBlock[],
    snapshot: Map<string, number>,
  ): void {
    const resultMap = new Map(translatedBlocks.map((block) => [block.id, block]));

    for (const state of states) {
      if (snapshot.get(state.id) !== state.revision) {
        continue;
      }

      const translation = resultMap.get(state.id);
      if (!translation) {
        runtimeStats.skipped += 1;
        state.translation = null;
        state.translationNode?.remove();
        state.translationNode = null;
        restoreInlineControlLayout(state.element);
        continue;
      }

      state.translation = translation;
      renderTranslation(state);
      runtimeStats.translated += 1;
    }

    updateStatusPanel(buildStatusText(getUiMessage('statusTranslationUpdatedPrefix')));
  }

  function collectCandidateElements(root: Element): Element[] {
    const start = root.matches?.(HARD_SKIP_SELECTOR) ? root.parentElement ?? document.body : root;
    const candidates: Element[] = [];
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT);

    let current = walker.currentNode as Element | null;
    while (current) {
      const element = current;
      if (element !== document.body && isCandidateElement(element)) {
        candidates.push(element);
      }
      current = walker.nextNode() as Element | null;
    }

    return candidates;
  }

  function isCandidateElement(element: Element): boolean {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    if (element.dataset.dltRole || element.closest('[data-dlt-role]')) {
      return false;
    }

    if (element.matches(HARD_SKIP_SELECTOR)) {
      return false;
    }

    const tagName = element.tagName;
    const visibleText = collapseWhitespace(getElementSourceText(element));

    if (visibleText.length < MIN_TEXT_LENGTH || visibleText.length > MAX_TEXT_LENGTH) {
      return false;
    }

    if (!isElementVisible(element)) {
      return false;
    }

    if (INTERACTIVE_TAGS.has(tagName)) {
      if (tagName === 'INPUT') {
        return isTranslatableInputControl(element);
      }
      return !element.querySelector(HARD_SKIP_SELECTOR);
    }

    if (TEXT_BLOCK_TAGS.has(tagName)) {
      return isElementVisible(element);
    }

    if (isGenericTextCandidate(element)) {
      return true;
    }

    return false;
  }

  function isGenericTextCandidate(element: HTMLElement): boolean {
    if (!GENERIC_TEXT_TAGS.has(element.tagName) && !element.tagName.includes('-')) {
      return false;
    }

    if (element.children.length > 8 || element.querySelector(BLOCK_DESCENDANT_SELECTOR)) {
      return false;
    }

    return hasInlineOnlyReadableContent(element);
  }

  function hasInlineOnlyReadableContent(element: HTMLElement): boolean {
    let hasText = false;

    for (const child of Array.from(element.childNodes)) {
      if (child instanceof Text) {
        if (child.nodeValue?.trim()) {
          hasText = true;
        }
        continue;
      }

      if (!(child instanceof HTMLElement) || child.matches(HARD_SKIP_SELECTOR)) {
        continue;
      }

      if (!isInlineLikeElement(child)) {
        return false;
      }

      if (child.textContent?.trim()) {
        hasText = true;
      }
    }

    return hasText;
  }

  function isInlineLikeElement(element: HTMLElement): boolean {
    const display = window.getComputedStyle(element).display;
    return display === 'contents' || display.startsWith('inline');
  }

  function isElementVisible(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getElementSourceText(element: HTMLElement): string {
    if (isTranslatableInputControl(element)) {
      return element.value;
    }

    return getTextExcludingExtensionNodes(element);
  }

  function getTextExcludingExtensionNodes(element: HTMLElement): string {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return isExtensionNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    let text = '';
    let current = walker.nextNode();
    while (current) {
      text += current.textContent ?? '';
      current = walker.nextNode();
    }
    return text;
  }

  function isInteractiveElement(element: HTMLElement): boolean {
    if (element.tagName === 'INPUT') {
      return isTranslatableInputControl(element);
    }

    return INTERACTIVE_TAGS.has(element.tagName);
  }

  function isTranslatableInputControl(element: Element): element is HTMLInputElement {
    if (!(element instanceof HTMLInputElement)) {
      return false;
    }

    const type = (element.type || 'text').toLowerCase();
    return ['button', 'submit', 'reset'].includes(type) && Boolean(element.value.trim());
  }

  function getRenderMode(element: Element): 'text' | 'interactive' {
    return element instanceof HTMLElement && isInteractiveElement(element)
      ? 'interactive'
      : 'text';
  }

  function getRenderSignature(element: Element): string {
    if (!(element instanceof HTMLElement) || getRenderMode(element) !== 'interactive') {
      return '';
    }

    const attrs = [
      'class',
      'style',
      'href',
      'target',
      'rel',
      'disabled',
      'aria-disabled',
      'title',
      'type',
      'value',
    ];

    return attrs
      .map((name) => `${name}=${element.getAttribute(name) ?? ''}`)
      .join('|');
  }

  function hasTrackedAncestor(element: Element): boolean {
    let current = element.parentElement;
    while (current) {
      if (elementToBlockId.has(current)) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  function extractBlock(element: Element): {
    text: string;
    segments: Segment[];
    segmentMap: Map<Text, Segment>;
    renderMode: 'text' | 'interactive';
    renderSignature: string;
  } | null {
    if (isTranslatableInputControl(element)) {
      const text = element.value.trim();
      if (text.length < MIN_TEXT_LENGTH || text.length > MAX_TEXT_LENGTH) {
        return null;
      }

      return {
        text,
        segments: [],
        segmentMap: new Map(),
        renderMode: 'interactive',
        renderSignature: getRenderSignature(element),
      };
    }

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!(node instanceof Text)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!node.parentElement) {
          return NodeFilter.FILTER_REJECT;
        }
        const blockedAncestor = node.parentElement.closest(HARD_SKIP_SELECTOR);
        if (blockedAncestor && blockedAncestor !== element) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const segments: Segment[] = [];
    const segmentMap = new Map<Text, Segment>();
    let text = '';

    let current = walker.nextNode();
    while (current) {
      const node = current as Text;
      const start = text.length;
      text += node.nodeValue ?? '';
      const segment: Segment = {
        node,
        start,
        end: text.length,
      };
      segments.push(segment);
      segmentMap.set(node, segment);
      current = walker.nextNode();
    }

    if (collapseWhitespace(text).length < MIN_TEXT_LENGTH || text.length > MAX_TEXT_LENGTH) {
      return null;
    }

    return {
      text,
      segments,
      segmentMap,
      renderMode: getRenderMode(element),
      renderSignature: getRenderSignature(element),
    };
  }

  function renderTranslation(block: BlockState): void {
    if (!block.translation) {
      return;
    }

    const internalLineTranslation = shouldRenderInsideSource(block);
    const desiredTagName = getTranslationContainerTagName(block.element, internalLineTranslation);
    let container = block.translationNode;

    if (!container || container.tagName !== desiredTagName) {
      container?.remove();
      container = document.createElement(desiredTagName.toLowerCase());
    }

    container.className = getTranslationContainerClassName(block, internalLineTranslation);
    container.dataset.dltRole = TRANSLATION_ROLE;
    container.dataset.dltBlockId = block.id;
    if (internalLineTranslation && block.renderMode === 'interactive') {
      applyInlineControlTranslationStyle(container, block.element);
    } else if (internalLineTranslation) {
      applyInternalTextTranslationStyle(container, block.element);
    } else {
      restoreInlineControlLayout(block.element);
      applyTranslationContainerStyle(container, block.element, block.renderMode);
    }
    container.replaceChildren(
      internalLineTranslation
        ? buildTranslationFragment(block)
        : block.renderMode === 'interactive'
        ? buildInteractiveTranslationControl(block)
        : buildTranslationFragment(block),
    );

    block.translationNode = container;
    ensureTranslationPosition(block);
  }

  function shouldRenderInsideSource(block: BlockState): boolean {
    return (
      shouldRenderInsideInteractiveSource(block) ||
      shouldRenderInsideLayoutSensitiveTextSource(block)
    );
  }

  function shouldRenderInsideInteractiveSource(block: BlockState): boolean {
    return (
      block.renderMode === 'interactive' &&
      (block.element instanceof HTMLAnchorElement || block.element instanceof HTMLButtonElement)
    );
  }

  function shouldRenderInsideLayoutSensitiveTextSource(block: BlockState): boolean {
    if (block.renderMode !== 'text' || !(block.element instanceof HTMLElement)) {
      return false;
    }

    if (block.element.tagName === 'LI' || block.element.tagName === 'TR') {
      return false;
    }

    const sourceStyle = window.getComputedStyle(block.element);
    if (sourceStyle.position === 'absolute' || sourceStyle.position === 'fixed') {
      return true;
    }

    const parent = block.element.parentElement;
    if (!parent) {
      return false;
    }

    const parentStyle = window.getComputedStyle(parent);
    if (parentStyle.display.includes('grid')) {
      return true;
    }

    if (!parentStyle.display.includes('flex')) {
      return false;
    }

    return parentStyle.flexDirection === 'row' || parentStyle.flexDirection === 'row-reverse';
  }

  function getTranslationContainerClassName(
    block: BlockState,
    internalLineTranslation: boolean,
  ): string {
    if (internalLineTranslation && block.renderMode === 'interactive') {
      return 'dlt-translation dlt-translation-inline-control-line';
    }

    if (internalLineTranslation) {
      return 'dlt-translation dlt-translation-internal-line';
    }

    return block.renderMode === 'interactive'
      ? 'dlt-translation dlt-translation-control-host'
      : 'dlt-translation';
  }

  function getTranslationContainerTagName(
    source: Element,
    internalLineTranslation: boolean,
  ): string {
    if (internalLineTranslation) {
      return 'SPAN';
    }

    return source.tagName === 'LI' ? 'LI' : 'DIV';
  }

  function ensureTranslationPosition(block: BlockState): void {
    if (!block.translationNode || !block.element.isConnected) {
      return;
    }

    if (shouldRenderInsideSource(block)) {
      if (block.translationNode.parentElement !== block.element) {
        block.element.append(block.translationNode);
      }
      return;
    }

    if (block.element.nextElementSibling === block.translationNode) {
      return;
    }

    block.element.insertAdjacentElement('afterend', block.translationNode);
  }

  function buildTranslationFragment(block: BlockState): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const translation = block.translation;

    if (!translation) {
      return fragment;
    }

    const alignments = [...translation.alignments].sort(
      (left, right) => left.targetStart - right.targetStart,
    );

    let cursor = 0;
    for (const alignment of alignments) {
      if (alignment.targetStart > cursor) {
        fragment.append(document.createTextNode(translation.translatedText.slice(cursor, alignment.targetStart)));
      }

      fragment.append(
        buildAlignedTargetNode(
          block,
          alignment,
          translation.translatedText.slice(alignment.targetStart, alignment.targetEnd),
        ),
      );
      cursor = alignment.targetEnd;
    }

    if (cursor < translation.translatedText.length) {
      fragment.append(document.createTextNode(translation.translatedText.slice(cursor)));
    }

    return fragment;
  }

  function buildAlignedTargetNode(
    block: BlockState,
    alignment: AlignmentSpan,
    text: string,
  ): HTMLElement {
    const sourceInteractive = findSourceInteractiveElementForAlignment(block, alignment);
    const node = sourceInteractive
      ? buildInlineInteractiveTarget(sourceInteractive, text)
      : document.createElement('span');

    node.classList.add('dlt-target-span');
    node.dataset.dltRole = ROOT_ROLE;
    node.dataset.alignmentId = alignment.alignmentId;
    node.textContent = text;
    return node;
  }

  function buildInlineInteractiveTarget(source: HTMLElement, text: string): HTMLElement {
    const control = source.cloneNode(false) as HTMLElement;
    control.removeAttribute('id');
    control.removeAttribute('aria-labelledby');
    control.textContent = text;
    copyTextStyle(control, source);

    if (control instanceof HTMLButtonElement) {
      control.type = 'button';
      control.disabled = source instanceof HTMLButtonElement ? source.disabled : false;
    }

    if (control instanceof HTMLAnchorElement && source instanceof HTMLAnchorElement) {
      control.href = source.href;
    }

    bindInteractiveProxy(control, source);
    return control;
  }

  function findSourceInteractiveElementForAlignment(
    block: BlockState,
    alignment: AlignmentSpan,
  ): HTMLElement | null {
    if (block.renderMode === 'interactive') {
      return null;
    }

    let interactiveElement: HTMLElement | null = null;

    for (const sourceRange of alignment.sourceRanges) {
      let rangeHasInteractiveText = false;

      for (const segment of block.segments) {
        const start = Math.max(segment.start, sourceRange.start);
        const end = Math.min(segment.end, sourceRange.end);
        if (start >= end) {
          continue;
        }

        const candidate = segment.node.parentElement?.closest<HTMLElement>('a,button');
        if (!candidate || !block.element.contains(candidate)) {
          return null;
        }

        if (interactiveElement && interactiveElement !== candidate) {
          return null;
        }

        interactiveElement = candidate;
        rangeHasInteractiveText = true;
      }

      if (!rangeHasInteractiveText) {
        return null;
      }
    }

    return interactiveElement;
  }

  function buildInteractiveTranslationControl(block: BlockState): HTMLElement {
    const original = block.element;
    if (!(original instanceof HTMLElement)) {
      const fallback = document.createElement('div');
      fallback.append(buildTranslationFragment(block));
      return fallback;
    }

    const control = original.cloneNode(false) as HTMLElement;
    control.dataset.dltRole = CONTROL_ROLE;
    control.removeAttribute('id');
    control.removeAttribute('aria-labelledby');

    if (control instanceof HTMLButtonElement) {
      control.type = 'button';
      control.disabled = original instanceof HTMLButtonElement ? original.disabled : false;
    }

    if (control instanceof HTMLAnchorElement) {
      control.href = original instanceof HTMLAnchorElement ? original.href : control.href;
    }

    if (control instanceof HTMLInputElement && isTranslatableInputControl(original)) {
      control.value = block.translation?.translatedText ?? '';
    } else {
      control.replaceChildren(buildTranslationFragment(block));
    }

    bindInteractiveProxy(control, original);
    return control;
  }

  function bindInteractiveProxy(rendered: HTMLElement, original: HTMLElement): void {
    const triggerOriginal = (event: MouseEvent) => {
      if (
        (original instanceof HTMLButtonElement || original instanceof HTMLInputElement) &&
        original.disabled
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      original.focus({ preventScroll: true });
      original.click();
    };

    rendered.addEventListener('click', (event) => {
      triggerOriginal(event);
    });
  }

  function applyTranslationContainerStyle(
    container: HTMLElement,
    source: Element,
    renderMode: 'text' | 'interactive',
  ): void {
    if (!(source instanceof HTMLElement)) {
      return;
    }

    const sourceStyle = window.getComputedStyle(source);
    const marginBottom = Math.max(0, parsePixelValue(sourceStyle.marginBottom));

    copyTextStyle(container, source);
    if (renderMode === 'interactive' && source.parentElement instanceof HTMLElement) {
      container.style.textAlign = window.getComputedStyle(source.parentElement).textAlign;
    }
    container.style.display = container.tagName === 'LI' ? 'list-item' : 'block';
    container.style.boxSizing = 'border-box';
    container.style.background = 'transparent';
    container.style.border = '0';
    container.style.minHeight = '0';
    container.style.maxWidth = '100%';
    container.style.marginTop = marginBottom > 0 ? `${-marginBottom}px` : '0';
    container.style.marginRight = sourceStyle.marginRight;
    container.style.marginBottom = sourceStyle.marginBottom;
    container.style.marginLeft = sourceStyle.marginLeft;
    container.style.paddingTop = '0';
    container.style.paddingRight = renderMode === 'interactive' ? '0' : sourceStyle.paddingRight;
    container.style.paddingBottom = '0';
    container.style.paddingLeft = renderMode === 'interactive' ? '0' : sourceStyle.paddingLeft;
    container.style.listStylePosition = sourceStyle.listStylePosition;
    container.style.listStyleType = sourceStyle.listStyleType;
  }

  function applyInlineControlTranslationStyle(container: HTMLElement, source: Element): void {
    if (!(source instanceof HTMLElement)) {
      return;
    }

    const lineWidthPx = patchInlineControlLayout(source);
    copyTextStyle(container, source);
    container.style.display = 'block';
    container.style.boxSizing = 'border-box';
    if (lineWidthPx > 0) {
      const lineWidth = `${lineWidthPx}px`;
      container.style.flex = `0 1 ${lineWidth}`;
      container.style.width = lineWidth;
      container.style.maxWidth = lineWidth;
    } else {
      container.style.flex = '0 1 auto';
      container.style.width = 'auto';
      container.style.maxWidth = '100%';
    }
    container.style.minWidth = '0';
    container.style.margin = '0';
    container.style.padding = '0';
    container.style.border = '0';
    container.style.background = 'transparent';
    container.style.whiteSpace = 'normal';
    container.style.overflowWrap = 'anywhere';
  }

  function applyInternalTextTranslationStyle(container: HTMLElement, source: Element): void {
    if (!(source instanceof HTMLElement)) {
      return;
    }

    const sourceStyle = window.getComputedStyle(source);
    copyTextStyle(container, source);
    container.style.display = 'block';
    container.style.boxSizing = 'border-box';
    container.style.width = 'auto';
    container.style.minWidth = '0';
    container.style.maxWidth = '100%';
    container.style.margin = '0';
    container.style.padding = '0';
    container.style.border = '0';
    container.style.background = 'transparent';
    container.style.whiteSpace = sourceStyle.whiteSpace === 'nowrap' ? 'normal' : sourceStyle.whiteSpace;
    container.style.overflowWrap = 'anywhere';
  }

  function patchInlineControlLayout(source: HTMLElement): number {
    const existingPatch = inlineControlLayoutPatches.get(source);
    if (existingPatch) {
      return existingPatch.widthPx;
    }

    const sourceStyle = window.getComputedStyle(source);
    const widthPx = Math.ceil(source.getBoundingClientRect().width);
    if (!sourceStyle.display.includes('flex') || sourceStyle.flexWrap !== 'nowrap') {
      inlineControlLayoutPatches.set(source, {
        flexWrap: source.style.flexWrap,
        widthPx,
        appliedFlexWrap: false,
      });
      return widthPx;
    }

    inlineControlLayoutPatches.set(source, {
      flexWrap: source.style.flexWrap,
      widthPx,
      appliedFlexWrap: true,
    });
    source.style.flexWrap = 'wrap';
    return widthPx;
  }

  function restoreInlineControlLayout(source: Element): void {
    if (!(source instanceof HTMLElement)) {
      return;
    }

    const patch = inlineControlLayoutPatches.get(source);
    if (!patch) {
      return;
    }

    if (patch.appliedFlexWrap && source.style.flexWrap === 'wrap') {
      source.style.flexWrap = patch.flexWrap;
    }
    inlineControlLayoutPatches.delete(source);
  }

  function copyTextStyle(target: HTMLElement, source: HTMLElement): void {
    const sourceStyle = window.getComputedStyle(source);
    target.style.color = sourceStyle.color;
    target.style.fontFamily = sourceStyle.fontFamily;
    target.style.fontSize = sourceStyle.fontSize;
    target.style.fontStyle = sourceStyle.fontStyle;
    target.style.fontVariant = sourceStyle.fontVariant;
    target.style.fontWeight = sourceStyle.fontWeight;
    target.style.letterSpacing = sourceStyle.letterSpacing;
    target.style.lineHeight = sourceStyle.lineHeight;
    target.style.textAlign = sourceStyle.textAlign;
    target.style.textDecorationColor = sourceStyle.textDecorationColor;
    target.style.textDecorationLine = sourceStyle.textDecorationLine;
    target.style.textDecorationStyle = sourceStyle.textDecorationStyle;
    target.style.textDecorationThickness = sourceStyle.textDecorationThickness;
    target.style.textTransform = sourceStyle.textTransform;
    target.style.whiteSpace = sourceStyle.whiteSpace;
    target.style.wordBreak = sourceStyle.wordBreak;
    target.style.wordSpacing = sourceStyle.wordSpacing;
  }

  function attachGlobalListeners(): void {
    document.addEventListener(
      'pointermove',
      (event) => {
        if (!enabled) {
          return;
        }

        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('.dlt-dictionary-tooltip')) {
          cancelRecordTimer();
          cancelDictionaryHideTimer();
          return;
        }

        const translatedSpan = target?.closest<HTMLElement>('.dlt-target-span');

        if (translatedSpan) {
          const blockId = translatedSpan.closest<HTMLElement>('[data-dlt-block-id]')?.dataset.dltBlockId;
          const alignmentId = translatedSpan.dataset.alignmentId;
          const block = blockId ? blocksById.get(blockId) : null;

          if (block && alignmentId) {
            cancelDictionaryHideTimer();
            setActiveHighlight(block, alignmentId, 'target');
            return;
          }
        }

        const interactiveTargetHit =
          target instanceof HTMLElement
            ? getTranslatedInteractiveHit(target, event.clientX, event.clientY)
            : null;
        if (interactiveTargetHit) {
          cancelDictionaryHideTimer();
          setActiveHighlight(interactiveTargetHit.block, interactiveTargetHit.alignment.alignmentId, 'target');
          return;
        }

        const sourceHit = getSourceHit(event.clientX, event.clientY);
        if (sourceHit) {
          cancelDictionaryHideTimer();
          setActiveHighlight(sourceHit.block, sourceHit.alignment.alignmentId, 'source');
          return;
        }

        scheduleClearHighlight();
      },
      true,
    );

    document.addEventListener(
      'scroll',
      (event) => {
        if (!enabled) {
          return;
        }

        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('.dlt-dictionary-tooltip')) {
          cancelDictionaryHideTimer();
          return;
        }

        cancelRecordTimer();
        if (activeHighlight) {
          const block = blocksById.get(activeHighlight.blockId);
          if (block) {
            drawHighlight(block, activeHighlight.alignmentId);
            positionDictionaryTooltip(block, activeHighlight.alignmentId);
          }
        }
      },
      true,
    );

    window.addEventListener('resize', () => {
      if (!enabled) {
        return;
      }

      cancelRecordTimer();
      if (activeHighlight) {
        const block = blocksById.get(activeHighlight.blockId);
        if (block) {
          drawHighlight(block, activeHighlight.alignmentId);
          positionDictionaryTooltip(block, activeHighlight.alignmentId);
        }
      }
    });
  }

  function getSourceHit(
    clientX: number,
    clientY: number,
  ): { block: BlockState; alignment: AlignmentSpan } | null {
    const range = getCaretRangeFromPoint(clientX, clientY);
    if (range?.startContainer instanceof Text) {
      const block = findBlockForNode(range.startContainer);
      const segment = block?.segmentMap.get(range.startContainer);

      if (block?.translation && segment) {
        const absoluteOffset = segment.start + range.startOffset;
        const alignment = findAlignmentByOffset(block.translation.alignments, 'source', absoluteOffset);
        if (alignment) {
          return { block, alignment };
        }
      }
    }

    const pointedElement = document.elementFromPoint(clientX, clientY);
    if (!(pointedElement instanceof HTMLElement) || isExtensionNode(pointedElement)) {
      return null;
    }

    const block = findBlockForNode(pointedElement);
    if (!block || !block.translation) {
      return null;
    }

    return getInteractiveSourceHit(block, clientX, clientY);
  }

  function getTranslatedInteractiveHit(
    target: HTMLElement,
    clientX: number,
    clientY: number,
  ): { block: BlockState; alignment: AlignmentSpan } | null {
    const control = target.closest<HTMLElement>('[data-dlt-role="dlt-control"]');
    if (!(control instanceof HTMLInputElement)) {
      return null;
    }

    const blockId = control.closest<HTMLElement>('[data-dlt-block-id]')?.dataset.dltBlockId;
    const block = blockId ? blocksById.get(blockId) : null;
    if (!block || !block.translation || !isPointInsideRect(control.getBoundingClientRect(), clientX, clientY)) {
      return null;
    }

    const absoluteOffset = estimateLinearTextOffset(control, block.translation.translatedText, clientX, clientY);
    if (absoluteOffset === null) {
      return null;
    }

    const alignment = findAlignmentByOffset(block.translation.alignments, 'target', absoluteOffset);
    return alignment ? { block, alignment } : null;
  }

  function getInteractiveSourceHit(
    block: BlockState,
    clientX: number,
    clientY: number,
  ): { block: BlockState; alignment: AlignmentSpan } | null {
    if (!(block.element instanceof HTMLInputElement) || !isTranslatableInputControl(block.element)) {
      return null;
    }

    const absoluteOffset = estimateLinearTextOffset(block.element, block.text, clientX, clientY);
    if (absoluteOffset === null) {
      return null;
    }

    const alignment = findAlignmentByOffset(block.translation?.alignments ?? [], 'source', absoluteOffset);
    return alignment ? { block, alignment } : null;
  }

  function getCaretRangeFromPoint(clientX: number, clientY: number): Range | null {
    if (typeof document.caretRangeFromPoint === 'function') {
      return document.caretRangeFromPoint(clientX, clientY);
    }

    if (typeof document.caretPositionFromPoint === 'function') {
      const position = document.caretPositionFromPoint(clientX, clientY);
      if (position?.offsetNode) {
        const range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.setEnd(position.offsetNode, position.offset);
        return range;
      }
    }

    return null;
  }

  function setActiveHighlight(
    block: BlockState,
    alignmentId: string,
    origin: 'source' | 'target',
  ): void {
    cancelDictionaryHideTimer();

    if (
      activeHighlight &&
      activeHighlight.blockId === block.id &&
      activeHighlight.alignmentId === alignmentId &&
      activeHighlight.origin === origin
    ) {
      if (origin === 'source') {
        armRecordTimer(block, alignmentId);
        showDictionaryForSource(block, alignmentId);
      }
      return;
    }

    activeHighlight = {
      blockId: block.id,
      alignmentId,
      origin,
    };
    completedRecordSignature = '';

    drawHighlight(block, alignmentId);

    if (origin === 'source') {
      armRecordTimer(block, alignmentId);
      showDictionaryForSource(block, alignmentId);
      return;
    }

    cancelRecordTimer();
    hideDictionaryTooltip();
  }

  function drawHighlight(block: BlockState, alignmentId: string): void {
    const alignment = block.translation?.alignments.find((entry) => entry.alignmentId === alignmentId);
    if (!alignment || !highlightLayer) {
      clearHighlight();
      return;
    }

    const rects = [
      ...getSourceClientRects(block, alignment),
      ...getTargetClientRects(block, alignmentId),
    ].filter((rect) => rect.width > 0 && rect.height > 0);

    highlightLayer.replaceChildren();

    for (const rect of rects) {
      const node = document.createElement('div');
      node.className = `dlt-highlight-rect ${rect.kind === 'source' ? 'dlt-highlight-source' : 'dlt-highlight-target'}`;
      node.style.left = `${rect.left}px`;
      node.style.top = `${rect.top}px`;
      node.style.width = `${rect.width}px`;
      node.style.height = `${rect.height}px`;
      highlightLayer.append(node);
    }
  }

  function getSourceClientRects(
    block: BlockState,
    alignment: AlignmentSpan,
  ): Array<DOMRect & { kind: 'source' }> {
    if (block.segments.length === 0) {
      return alignment.sourceRanges
        .map((range) => getInteractiveTextRect(block.element, block.text, range.start, range.end))
        .filter((rect): rect is DOMRect => Boolean(rect))
        .map((rect) => Object.assign(rect, { kind: 'source' as const }));
    }

    const rects: Array<DOMRect & { kind: 'source' }> = [];

    for (const sourceRange of alignment.sourceRanges) {
      for (const segment of block.segments) {
        const start = Math.max(segment.start, sourceRange.start);
        const end = Math.min(segment.end, sourceRange.end);
        if (start >= end) {
          continue;
        }

        const range = document.createRange();
        range.setStart(segment.node, start - segment.start);
        range.setEnd(segment.node, end - segment.start);
        rects.push(
          ...Array.from(range.getClientRects()).map(
            (rect) => Object.assign(rect, { kind: 'source' as const }),
          ),
        );
      }
    }

    return rects;
  }

  function getTargetClientRects(
    block: BlockState,
    alignmentId: string,
  ): Array<DOMRect & { kind: 'target' }> {
    const rects: Array<DOMRect & { kind: 'target' }> = [];
    const spans = block.translationNode?.querySelectorAll<HTMLElement>(`.dlt-target-span[data-alignment-id="${cssEscape(alignmentId)}"]`) ?? [];

    for (const span of Array.from(spans)) {
      rects.push(
        ...Array.from(span.getClientRects()).map((rect) => Object.assign(rect, { kind: 'target' as const })),
      );
    }

    if (rects.length === 0) {
      const alignment = block.translation?.alignments.find((entry) => entry.alignmentId === alignmentId);
      const control = block.translationNode?.querySelector<HTMLElement>('[data-dlt-role="dlt-control"]');
      if (alignment && control) {
        const rect = getInteractiveTextRect(
          control,
          block.translation?.translatedText ?? '',
          alignment.targetStart,
          alignment.targetEnd,
        );
        if (rect) {
          rects.push(Object.assign(rect, { kind: 'target' as const }));
        }
      }
    }

    return rects;
  }

  function showDictionaryForSource(block: BlockState, alignmentId: string): void {
    if (!settings || settings.dictionaryProvider === 'off' || !block.translation) {
      hideDictionaryTooltip();
      return;
    }

    const alignment = block.translation.alignments.find((entry) => entry.alignmentId === alignmentId);
    if (!alignment) {
      hideDictionaryTooltip();
      return;
    }

    const sourceWord = alignment.sourceText.trim();
    const normalizedWord = normalizeWord(sourceWord);
    if (!normalizedWord) {
      hideDictionaryTooltip();
      return;
    }

    const lookupKey = [
      settings.dictionaryProvider,
      block.translation.sourceLang,
      settings.targetLang,
      normalizedWord,
    ].join('::');
    const signature = `${block.id}:${block.revision}:${alignmentId}:${lookupKey}`;

    if (activeDictionarySignature === signature && dictionaryTooltip?.isConnected) {
      positionDictionaryTooltip(block, alignmentId);
      return;
    }

    activeDictionarySignature = signature;
    const requestId = ++dictionaryRequestSerial;
    renderDictionaryLoading(sourceWord, block, alignmentId);

    const cached = dictionaryResultCache.get(lookupKey);
    if (cached) {
      renderDictionaryResult(cached, block, alignmentId);
      return;
    }

    void sendMessageToBackground<DictionaryLookupResult>({
      type: 'dictionary:lookup',
      payload: {
        word: sourceWord,
        sourceLang: block.translation.sourceLang,
        targetLang: settings.targetLang,
      },
    })
      .then((result) => {
        dictionaryResultCache.set(lookupKey, result);
        if (requestId !== dictionaryRequestSerial || activeDictionarySignature !== signature) {
          return;
        }
        renderDictionaryResult(result, block, alignmentId);
      })
      .catch((error: unknown) => {
        if (requestId !== dictionaryRequestSerial || activeDictionarySignature !== signature) {
          return;
        }
        renderDictionaryError(error, block, alignmentId);
      });
  }

  function renderDictionaryLoading(word: string, block: BlockState, alignmentId: string): void {
    const tooltip = ensureDictionaryTooltip();
    tooltip.replaceChildren(
      buildDictionaryHeader(
        word,
        settings?.dictionaryProvider ?? 'off',
        getUiMessage('dictionaryLoading'),
      ),
    );
    positionDictionaryTooltip(block, alignmentId);
  }

  function renderDictionaryResult(
    result: DictionaryLookupResult,
    block: BlockState,
    alignmentId: string,
  ): void {
    const tooltip = ensureDictionaryTooltip();
    const providerName = getDictionaryProviderLabel(result.provider);
    const header = buildDictionaryHeader(result.word, result.provider, providerName);

    if (result.entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dlt-dictionary-empty';
      empty.textContent = getUiMessage('dictionaryEmpty');
      tooltip.replaceChildren(header, empty, buildDictionaryFooter(result));
      positionDictionaryTooltip(block, alignmentId);
      return;
    }

    const list = document.createElement('div');
    list.className = 'dlt-dictionary-list';
    for (const entry of result.entries.slice(0, 3)) {
      list.append(buildDictionaryEntry(entry));
    }

    tooltip.replaceChildren(header, list, buildDictionaryFooter(result));
    positionDictionaryTooltip(block, alignmentId);
  }

  function renderDictionaryError(error: unknown, block: BlockState, alignmentId: string): void {
    const tooltip = ensureDictionaryTooltip();
    const message = error instanceof Error ? error.message : getUiMessage('dictionaryLookupFailed');
    const body = document.createElement('div');
    body.className = 'dlt-dictionary-empty';
    body.textContent = truncateStatusText(message);
    tooltip.replaceChildren(
      buildDictionaryHeader(
        getUiMessage('dictionaryTitle'),
        settings?.dictionaryProvider ?? 'off',
        getUiMessage('dictionaryLookupFailedTitle'),
      ),
      body,
    );
    positionDictionaryTooltip(block, alignmentId);
  }

  function buildDictionaryHeader(
    word: string,
    provider: DictionaryLookupResult['provider'],
    metaText: string,
  ): HTMLElement {
    const header = document.createElement('div');
    header.className = 'dlt-dictionary-header';

    const title = document.createElement('strong');
    title.textContent = word;

    const meta = document.createElement('span');
    meta.textContent = metaText || getDictionaryProviderLabel(provider);

    header.append(title, meta);
    return header;
  }

  function buildDictionaryEntry(entry: DictionaryEntry): HTMLElement {
    const item = document.createElement('section');
    item.className = 'dlt-dictionary-entry';

    const meta = document.createElement('div');
    meta.className = 'dlt-dictionary-entry-meta';
    meta.textContent = [
      entry.partOfSpeech,
      entry.pronunciations.length > 0 ? entry.pronunciations.join(' / ') : '',
    ]
      .filter(Boolean)
      .join(' · ');

    if (meta.textContent) {
      item.append(meta);
    }

    for (const definition of entry.definitions.slice(0, 3)) {
      const line = document.createElement('p');
      line.className = 'dlt-dictionary-definition';
      line.textContent = definition;
      item.append(line);
    }

    if (entry.translations.length > 0) {
      const translations = document.createElement('p');
      translations.className = 'dlt-dictionary-translations';
      translations.textContent = getUiMessage(
        'dictionaryTranslationsLabel',
        entry.translations.slice(0, 5).join(', '),
      );
      item.append(translations);
    }

    if (entry.examples.length > 0) {
      const example = document.createElement('p');
      example.className = 'dlt-dictionary-example';
      example.textContent = entry.examples[0];
      item.append(example);
    }

    return item;
  }

  function buildDictionaryFooter(result: DictionaryLookupResult): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'dlt-dictionary-footer';

    if (result.sourceUrl) {
      const link = document.createElement('a');
      link.href = result.sourceUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = getUiMessage('dictionaryOpenDictionary');
      footer.append(link);
    }

    if (result.attribution) {
      const attribution = document.createElement('span');
      attribution.textContent = result.attribution;
      footer.append(attribution);
    }

    return footer;
  }

  function positionDictionaryTooltip(block: BlockState, alignmentId: string): void {
    if (!dictionaryTooltip?.isConnected) {
      return;
    }

    const alignment = block.translation?.alignments.find((entry) => entry.alignmentId === alignmentId);
    if (!alignment) {
      hideDictionaryTooltip();
      return;
    }

    const sourceRect = getSourceClientRects(block, alignment)[0];
    if (!sourceRect) {
      hideDictionaryTooltip();
      return;
    }

    const margin = 10;
    const width = Math.min(360, window.innerWidth - margin * 2);
    dictionaryTooltip.style.width = `${width}px`;

    const tooltipRect = dictionaryTooltip.getBoundingClientRect();
    let left = Math.min(Math.max(sourceRect.left, margin), window.innerWidth - width - margin);
    let top = sourceRect.bottom + 8;
    if (top + tooltipRect.height > window.innerHeight - margin) {
      top = sourceRect.top - tooltipRect.height - 8;
    }
    if (top < margin) {
      top = margin;
    }

    dictionaryTooltip.style.left = `${left}px`;
    dictionaryTooltip.style.top = `${top}px`;
  }

  function hideDictionaryTooltip(): void {
    cancelDictionaryHideTimer();
    activeDictionarySignature = '';
    dictionaryRequestSerial += 1;
    dictionaryTooltip?.remove();
  }

  function getDictionaryProviderLabel(provider: DictionaryLookupResult['provider']): string {
    if (provider === 'wiktapi') {
      return 'WiktApi';
    }
    if (provider === 'freedictionaryapi') {
      return 'FreeDictionaryAPI';
    }
    return 'Dictionary off';
  }

  function armRecordTimer(block: BlockState, alignmentId: string): void {
    if (!block.translation) {
      cancelRecordTimer();
      return;
    }

    const signature = `${block.id}:${block.revision}:${alignmentId}`;
    if (pendingRecordSignature === signature && recordTimer !== null) {
      return;
    }
    if (completedRecordSignature === signature) {
      return;
    }

    cancelRecordTimer();
    pendingRecordSignature = signature;

    recordTimer = window.setTimeout(() => {
      recordTimer = null;
      void persistRecordedWord(block, alignmentId, signature).catch(reportRuntimeError);
    }, RECORD_DELAY_MS);
  }

  async function persistRecordedWord(
    block: BlockState,
    alignmentId: string,
    signature: string,
  ): Promise<void> {
    if (!enabled || pendingRecordSignature !== signature || !block.translation || !settings) {
      return;
    }

    const alignment = block.translation.alignments.find((entry) => entry.alignmentId === alignmentId);
    if (!alignment) {
      return;
    }

    const sourceWord = alignment.sourceText.trim();
    const normalizedWord = normalizeWord(sourceWord);

    if (!normalizedWord) {
      return;
    }

    completedRecordSignature = signature;

    await sendMessageToBackground({
      type: 'record:hover-hit',
      payload: {
        normalizedWord,
        sourceWord,
        sourceLang: block.translation.sourceLang,
        targetLang: settings.targetLang,
        pageUrl: location.href,
        sourceSentence: collapseWhitespace(block.text),
        translatedSentence: collapseWhitespace(block.translation.translatedText),
        timestamp: Date.now(),
      },
    });
  }

  function cancelRecordTimer(): void {
    pendingRecordSignature = '';
    if (recordTimer !== null) {
      window.clearTimeout(recordTimer);
      recordTimer = null;
    }
  }

  function scheduleClearHighlight(): void {
    if (!dictionaryTooltip?.isConnected || !activeDictionarySignature) {
      clearHighlight();
      return;
    }

    if (dictionaryHideTimer !== null) {
      return;
    }

    dictionaryHideTimer = window.setTimeout(() => {
      dictionaryHideTimer = null;
      clearHighlight();
    }, getDictionaryHoverHoldMs());
  }

  function getDictionaryHoverHoldMs(): number {
    const value = settings?.dictionaryHoverHoldMs;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? Math.min(MAX_DICTIONARY_HOVER_HOLD_MS, Math.floor(value))
      : DEFAULT_DICTIONARY_HOVER_HOLD_MS;
  }

  function cancelDictionaryHideTimer(): void {
    if (dictionaryHideTimer !== null) {
      window.clearTimeout(dictionaryHideTimer);
      dictionaryHideTimer = null;
    }
  }

  function clearHighlight(): void {
    activeHighlight = null;
    cancelRecordTimer();
    completedRecordSignature = '';
    hideDictionaryTooltip();
    highlightLayer?.replaceChildren();
  }

  function removeBlock(block: BlockState): void {
    block.translationNode?.remove();
    restoreInlineControlLayout(block.element);
    elementToBlockId.delete(block.element);
    blocksById.delete(block.id);
  }

  function cleanupDetachedBlocks(): void {
    for (const block of Array.from(blocksById.values())) {
      if (!block.element.isConnected) {
        removeBlock(block);
      }
    }
  }

  function findBlockForNode(node: Node): BlockState | null {
    const element = node instanceof Element ? node : node.parentElement;
    let current = element;

    while (current) {
      const blockId = elementToBlockId.get(current);
      if (blockId) {
        return blocksById.get(blockId) ?? null;
      }
      current = current.parentElement;
    }

    return null;
  }

  function patchHistory(): void {
    if (historyPatched) {
      return;
    }

    historyPatched = true;

    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = function pushState(...args: Parameters<History['pushState']>) {
      const result = originalPushState(...args);
      handleRouteChange();
      return result;
    };

    history.replaceState = function replaceState(...args: Parameters<History['replaceState']>) {
      const result = originalReplaceState(...args);
      handleRouteChange();
      return result;
    };

    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);
  }

  function handleRouteChange(): void {
    if (currentHref === location.href) {
      return;
    }

    currentHref = location.href;
    if (!enabled) {
      return;
    }

    const version = ++lifecycleVersion;
    resetTranslationQueue();
    clearHighlight();
    cleanupAllBlocks();
    void translateDiscoveredBlocks([document.body], version).catch(reportRuntimeError);
  }

  function ensureStyle(): void {
    if (styleElement?.isConnected) {
      return;
    }

    styleElement = document.createElement('style');
    styleElement.dataset.dltRole = STYLE_ROLE;
    styleElement.textContent = `
      .dlt-translation {
        color: inherit;
        font: inherit;
        line-height: inherit;
        margin: 0;
        word-break: break-word;
      }

      .dlt-target-span {
        border-radius: 0.2em;
      }

      .dlt-translation-control-host {
        color: inherit;
      }

      .dlt-translation-control-host > [data-dlt-role="dlt-control"] {
        max-width: 100%;
      }

      .dlt-translation-inline-control-line {
        display: block;
        flex: 0 0 100%;
        min-width: 0;
        width: 100%;
      }

      .dlt-translation-internal-line {
        display: block;
        min-width: 0;
        width: 100%;
      }

      .dlt-highlight-layer {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483647;
      }

      .dlt-highlight-rect {
        position: fixed;
        border-radius: 4px;
        box-sizing: border-box;
      }

      .dlt-highlight-source {
        background: rgba(255, 213, 79, 0.28);
        outline: 1px solid rgba(191, 138, 0, 0.75);
      }

      .dlt-highlight-target {
        background: rgba(79, 195, 247, 0.2);
        outline: 1px solid rgba(2, 119, 189, 0.75);
      }

      .dlt-dictionary-tooltip {
        position: fixed;
        z-index: 2147483647;
        max-height: min(420px, calc(100vh - 24px));
        overflow: auto;
        padding: 12px 14px;
        border: 1px solid rgba(31, 42, 46, 0.16);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.98);
        color: #1f2a2e;
        box-shadow: 0 18px 46px rgba(15, 23, 42, 0.22);
        font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: auto;
      }

      .dlt-dictionary-header {
        display: flex;
        gap: 8px;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: 8px;
      }

      .dlt-dictionary-header strong {
        font-size: 15px;
      }

      .dlt-dictionary-header span,
      .dlt-dictionary-entry-meta,
      .dlt-dictionary-footer,
      .dlt-dictionary-empty {
        color: #66757d;
      }

      .dlt-dictionary-entry {
        padding: 8px 0;
        border-top: 1px solid rgba(31, 42, 46, 0.08);
      }

      .dlt-dictionary-entry p {
        margin: 5px 0 0;
      }

      .dlt-dictionary-definition {
        color: #1f2a2e;
      }

      .dlt-dictionary-translations {
        color: #155e75;
      }

      .dlt-dictionary-example {
        color: #526067;
        font-style: italic;
      }

      .dlt-dictionary-footer {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        align-items: center;
        padding-top: 8px;
        border-top: 1px solid rgba(31, 42, 46, 0.08);
        font-size: 12px;
      }

      .dlt-dictionary-footer a {
        color: #1d4ed8;
        text-decoration: underline;
      }

      .dlt-status-panel {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483646;
        max-width: min(360px, calc(100vw - 32px));
        padding: 10px 12px;
        border: 1px solid rgba(24, 107, 74, 0.28);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.94);
        color: #174531;
        box-shadow: 0 8px 28px rgba(15, 23, 42, 0.16);
        font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: none;
      }

      .dlt-status-panel[data-has-error="true"] {
        border-color: rgba(180, 35, 24, 0.35);
        color: #8a1f17;
      }
    `;
    document.documentElement.append(styleElement);
  }

  function ensureHighlightLayer(): void {
    if (highlightLayer?.isConnected) {
      return;
    }

    highlightLayer = document.createElement('div');
    highlightLayer.className = 'dlt-highlight-layer';
    highlightLayer.dataset.dltRole = HIGHLIGHT_ROLE;
    document.documentElement.append(highlightLayer);
  }

  function ensureDictionaryTooltip(): HTMLDivElement {
    if (dictionaryTooltip?.isConnected) {
      return dictionaryTooltip;
    }

    dictionaryTooltip = document.createElement('div');
    dictionaryTooltip.className = 'dlt-dictionary-tooltip';
    dictionaryTooltip.dataset.dltRole = DICTIONARY_ROLE;
    document.documentElement.append(dictionaryTooltip);
    return dictionaryTooltip;
  }

  function ensureStatusPanel(): void {
    if (statusElement?.isConnected) {
      return;
    }

    statusElement = document.createElement('div');
    statusElement.className = 'dlt-status-panel';
    statusElement.dataset.dltRole = STATUS_ROLE;
    document.documentElement.append(statusElement);
  }

  function updateStatusPanel(message: string): void {
    ensureStatusPanel();
    if (!statusElement) {
      return;
    }

    statusElement.dataset.hasError = runtimeStats.lastError ? 'true' : 'false';
    statusElement.textContent = message;
  }

  function buildStatusText(prefix: string): string {
    const parts = [
      `${prefix}`,
      getUiMessage('statusRenderedCount', [
        String(runtimeStats.translated),
        String(runtimeStats.requested),
      ]),
    ];

    if (runtimeStats.skipped > 0) {
      parts.push(getUiMessage('statusSkippedInvalid', String(runtimeStats.skipped)));
    }

    if (runtimeStats.failed > 0) {
      parts.push(getUiMessage('statusFailedCount', String(runtimeStats.failed)));
    }

    if (runtimeStats.lastError) {
      parts.push(getUiMessage('statusLastError', runtimeStats.lastError));
    }

    return parts.join(' · ');
  }

  function getUiMessage(key: string, substitutions?: string | string[]): string {
    try {
      const message = chrome.i18n.getMessage(key, substitutions);
      return message || key;
    } catch {
      return key;
    }
  }

  function ensureChromeBridge(): void {
    if (!chrome?.runtime?.sendMessage) {
      throw new Error('Chrome runtime is unavailable in the injected content context.');
    }
  }

  async function getSettings(): Promise<ExtensionSettings> {
    const response = await sendMessageToBackground<{ settings: ExtensionSettings }>({
      type: 'settings:get',
    });
    return response.settings;
  }

  async function sendMessageToBackground<TResponse>(message: object): Promise<TResponse> {
    const response = (await chrome.runtime.sendMessage(message)) as { error?: string } & TResponse;
    if (response?.error) {
      throw new Error(response.error);
    }
    return response;
  }

  function isExtensionNode(node: Node): boolean {
    const element = node instanceof Element ? node : node.parentElement;
    return Boolean(element?.closest('[data-dlt-role]'));
  }

  function isExtensionOnlyMutation(mutation: MutationRecord): boolean {
    if (isExtensionNode(mutation.target)) {
      return true;
    }

    if (mutation.type !== 'childList') {
      return false;
    }

    const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
    return changedNodes.length > 0 && changedNodes.every((node) => isExtensionNode(node));
  }

  function normalizeWord(value: string): string {
    return value
      .trim()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
      .toLowerCase();
  }

  function chunkStates<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  function resetTranslationQueue(): void {
    translationQueue = Promise.resolve();
  }

  function normalizePositiveInteger(value: number, fallback: number): number {
    if (Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    return fallback;
  }

  function collapseWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  function cssEscape(value: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    return value.replace(/["\\]/g, '\\$&');
  }

  function reportRuntimeError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    runtimeStats.lastError = truncateStatusText(message);
    updateStatusPanel(buildStatusText(getUiMessage('statusTranslationErrorPrefix')));
    console.error('[metatranslation]', error);
  }

  function createRuntimeStats(): RuntimeStats {
    return {
      discovered: 0,
      requested: 0,
      translated: 0,
      skipped: 0,
      failed: 0,
      lastError: '',
    };
  }

  function truncateStatusText(value: string): string {
    return value.length > 220 ? `${value.slice(0, 217)}...` : value;
  }

  function findAlignmentByOffset(
    alignments: AlignmentSpan[],
    axis: 'source' | 'target',
    offset: number,
  ): AlignmentSpan | null {
    return (
      alignments.find((entry) => {
        if (axis === 'target') {
          return offset >= entry.targetStart && offset < entry.targetEnd;
        }

        return entry.sourceRanges.some((range) => offset >= range.start && offset < range.end);
      }) ?? null
    );
  }

  function estimateLinearTextOffset(
    element: HTMLElement,
    text: string,
    clientX: number,
    clientY: number,
  ): number | null {
    if (!text) {
      return null;
    }

    const contentRect = getElementTextRect(element);
    if (!contentRect || !isPointInsideRect(contentRect, clientX, clientY)) {
      return null;
    }

    const relativeX = Math.min(Math.max(clientX - contentRect.left, 0), contentRect.width);
    const ratio = contentRect.width > 0 ? relativeX / contentRect.width : 0;
    return Math.min(text.length - 1, Math.floor(ratio * text.length));
  }

  function getInteractiveTextRect(
    element: Element,
    text: string,
    start: number,
    end: number,
  ): DOMRect | null {
    if (!(element instanceof HTMLElement) || !text) {
      return null;
    }

    const contentRect = getElementTextRect(element);
    if (!contentRect) {
      return null;
    }

    const boundedStart = Math.max(0, Math.min(start, text.length));
    const boundedEnd = Math.max(boundedStart + 1, Math.min(end, text.length));
    const left = contentRect.left + (boundedStart / text.length) * contentRect.width;
    const right = contentRect.left + (boundedEnd / text.length) * contentRect.width;
    return new DOMRect(left, contentRect.top, Math.max(right - left, 2), contentRect.height);
  }

  function getElementTextRect(element: HTMLElement): DOMRect | null {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const style = window.getComputedStyle(element);
    const left =
      rect.left + parsePixelValue(style.borderLeftWidth) + parsePixelValue(style.paddingLeft);
    const right =
      rect.right - parsePixelValue(style.borderRightWidth) - parsePixelValue(style.paddingRight);
    const top = rect.top + parsePixelValue(style.borderTopWidth) + parsePixelValue(style.paddingTop);
    const bottom =
      rect.bottom - parsePixelValue(style.borderBottomWidth) - parsePixelValue(style.paddingBottom);

    return new DOMRect(
      left,
      top,
      Math.max(right - left, 1),
      Math.max(bottom - top, 1),
    );
  }

  function parsePixelValue(value: string): number {
    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function isPointInsideRect(rect: DOMRect, clientX: number, clientY: number): boolean {
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }
}
