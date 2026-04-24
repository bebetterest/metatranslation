import type {
  AlignmentSpan,
  TextRange,
  TranslationBlockRequest,
  TranslationResultBlock,
} from './types.ts';
import { buildSourceSpans, type SourceSpan } from './sourceSpans.ts';

export type RawTranslationBlockLike = {
  id?: unknown;
  sourceLang?: unknown;
  translatedParts?: unknown;
  translatedText?: unknown;
  alignments?: unknown;
};

type RawTranslatedPartLike = {
  text?: unknown;
  sourceSpanIds?: unknown;
};

type RawAlignmentLike = {
  alignmentId?: unknown;
  sourceSpanId?: unknown;
  sourceSpanIds?: unknown;
  sourceStart?: unknown;
  sourceEnd?: unknown;
  targetStart?: unknown;
  targetEnd?: unknown;
  sourceText?: unknown;
  targetText?: unknown;
  targetOccurrence?: unknown;
};

interface SanitizeTranslationOptions {
  sourceLangHint: string;
  tolerantProviderOutput: boolean;
}

export function sanitizeTranslationResultBlock(
  rawBlock: RawTranslationBlockLike,
  sourceBlock: Pick<TranslationBlockRequest, 'id' | 'text'>,
  sourceLangHintOrOptions: string | Partial<SanitizeTranslationOptions> = 'auto',
): TranslationResultBlock | null {
  const options = normalizeSanitizeOptions(sourceLangHintOrOptions);

  if (!isPlainObject(rawBlock)) {
    return null;
  }

  const sourceSpans = buildSourceSpans(sourceBlock.text);

  if (Array.isArray(rawBlock.translatedParts)) {
    if (typeof rawBlock.id !== 'string' || rawBlock.id !== sourceBlock.id) {
      return null;
    }

    if (!options.tolerantProviderOutput && hasUnexpectedKeys(rawBlock, ['id', 'translatedParts'])) {
      return null;
    }

    return sanitizeTranslatedPartsBlock(
      {
        ...rawBlock,
        id: rawBlock.id,
        sourceLang: normalizeSourceLangHint(options.sourceLangHint),
        translatedParts: rawBlock.translatedParts,
      },
      sourceBlock,
      sourceSpans,
      options,
    );
  }

  if (typeof rawBlock.id !== 'string' || rawBlock.id !== sourceBlock.id) {
    return null;
  }

  if (typeof rawBlock.sourceLang !== 'string' || !rawBlock.sourceLang.trim()) {
    return null;
  }

  return sanitizeLegacyAlignmentBlock(rawBlock, sourceBlock, sourceSpans);
}

function sanitizeTranslatedPartsBlock(
  rawBlock: RawTranslationBlockLike & { id: string; sourceLang: string; translatedParts: unknown[] },
  sourceBlock: Pick<TranslationBlockRequest, 'id' | 'text'>,
  sourceSpans: SourceSpan[],
  options: SanitizeTranslationOptions,
): TranslationResultBlock | null {
  if (rawBlock.translatedParts.length === 0) {
    return null;
  }

  let cursor = 0;
  const textParts: string[] = [];
  const alignments: AlignmentSpan[] = [];

  for (const [index, rawPart] of rawBlock.translatedParts.entries()) {
    if (
      !isPlainObject(rawPart) ||
      (!options.tolerantProviderOutput && hasUnexpectedKeys(rawPart, ['text', 'sourceSpanIds'])) ||
      typeof rawPart.text !== 'string' ||
      rawPart.text.length === 0
    ) {
      if (options.tolerantProviderOutput) {
        continue;
      }
      return null;
    }

    const part = rawPart as RawTranslatedPartLike & { text: string };
    const targetStart = cursor;
    const targetEnd = targetStart + part.text.length;
    textParts.push(part.text);
    cursor = targetEnd;

    const sourceSpanIds = normalizeTranslatedPartSourceSpanIds(part, options.tolerantProviderOutput);
    if (sourceSpanIds === null) {
      return null;
    }

    if (sourceSpanIds.length === 0) {
      continue;
    }

    if (!hasSemanticText(part.text)) {
      continue;
    }

    if (!part.text.trim()) {
      if (options.tolerantProviderOutput) {
        continue;
      }
      return null;
    }

    const sourceRanges = resolveSourceSpanRanges(sourceSpanIds, sourceSpans);
    if (!sourceRanges) {
      if (options.tolerantProviderOutput) {
        continue;
      }
      return null;
    }

    if (
      options.tolerantProviderOutput &&
      hasRangeOverlap(sourceRanges, alignments.flatMap((alignment) => alignment.sourceRanges))
    ) {
      continue;
    }

    alignments.push({
      alignmentId: `${rawBlock.id}:${index}`,
      sourceRanges,
      targetStart,
      targetEnd,
      sourceText: buildSourceText(sourceBlock.text, sourceRanges),
    });
  }

  const translatedText = textParts.join('');
  if (
    !translatedText.trim() ||
    (!options.tolerantProviderOutput && alignments.length === 0) ||
    hasAxisOverlap(alignments, 'source')
  ) {
    return null;
  }

  return {
    id: rawBlock.id,
    sourceLang: rawBlock.sourceLang,
    translatedText,
    alignments,
  };
}

function hasSemanticText(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

function sanitizeLegacyAlignmentBlock(
  rawBlock: RawTranslationBlockLike,
  sourceBlock: Pick<TranslationBlockRequest, 'id' | 'text'>,
  sourceSpans: SourceSpan[],
): TranslationResultBlock | null {
  if (typeof rawBlock.translatedText !== 'string') {
    return null;
  }

  if (!Array.isArray(rawBlock.alignments) || rawBlock.alignments.length === 0) {
    return null;
  }

  const alignments: AlignmentSpan[] = [];

  for (const alignment of rawBlock.alignments) {
    if (isIgnorableWhitespaceAlignment(alignment as RawAlignmentLike)) {
      continue;
    }

    const sanitized = sanitizeLegacyAlignment(
      alignment as RawAlignmentLike,
      sourceBlock,
      rawBlock.translatedText,
      sourceSpans,
    );
    if (!sanitized) {
      return null;
    }

    alignments.push(sanitized);
  }

  alignments.sort((left, right) => firstSourceStart(left) - firstSourceStart(right) || left.targetStart - right.targetStart);

  if (
    !rawBlock.translatedText.trim() ||
    alignments.length === 0 ||
    hasDuplicateAlignmentIds(alignments) ||
    hasAxisOverlap(alignments, 'source') ||
    hasAxisOverlap(alignments, 'target')
  ) {
    return null;
  }

  return {
    id: rawBlock.id as string,
    sourceLang: rawBlock.sourceLang as string,
    translatedText: rawBlock.translatedText,
    alignments,
  };
}

function sanitizeLegacyAlignment(
  rawAlignment: RawAlignmentLike,
  sourceBlock: Pick<TranslationBlockRequest, 'id' | 'text'>,
  translatedText: string,
  sourceSpans: SourceSpan[],
): AlignmentSpan | null {
  const alignmentId = normalizeAlignmentId(rawAlignment);
  if (!alignmentId) {
    return null;
  }

  const sourceFragment = normalizeFragmentText(rawAlignment.sourceText);
  if (!sourceFragment) {
    return null;
  }

  const rawSourceSpanIds = normalizeSourceSpanIds(rawAlignment);
  const sourceRanges =
    rawSourceSpanIds.length > 0
      ? resolveSourceSpanRanges(rawSourceSpanIds, sourceSpans)
      : resolveTextRange(sourceBlock.text, sourceFragment, normalizeInteger(rawAlignment.sourceStart), normalizeInteger(rawAlignment.sourceEnd));
  if (!sourceRanges) {
    return null;
  }

  const actualSourceText = buildSourceText(sourceBlock.text, sourceRanges);
  if (actualSourceText.trim() !== sourceFragment) {
    return null;
  }

  const targetFragment =
    typeof rawAlignment.targetText === 'string'
      ? normalizeFragmentText(rawAlignment.targetText)
      : null;
  const targetRange = targetFragment
    ? resolveTargetTextRange(
        translatedText,
        targetFragment,
        normalizeInteger(rawAlignment.targetOccurrence),
        normalizeInteger(rawAlignment.targetStart),
        normalizeInteger(rawAlignment.targetEnd),
      )
    : resolveLegacyRange(
        translatedText,
        normalizeInteger(rawAlignment.targetStart),
        normalizeInteger(rawAlignment.targetEnd),
      );
  if (!targetRange) {
    return null;
  }

  return {
    alignmentId,
    sourceRanges,
    targetStart: targetRange.start,
    targetEnd: targetRange.end,
    sourceText: actualSourceText,
  };
}

function resolveSourceSpanRanges(
  spanIds: string[],
  sourceSpans: SourceSpan[],
): TextRange[] | null {
  if (spanIds.length === 0) {
    return null;
  }

  const entries = spanIds.map((spanId) => {
    const index = sourceSpans.findIndex((span) => span.id === spanId);
    return index === -1 ? null : { index, span: sourceSpans[index] };
  });

  if (entries.some((entry) => entry === null)) {
    return null;
  }

  const ordered = entries
    .filter((entry): entry is { index: number; span: SourceSpan } => Boolean(entry))
    .sort((left, right) => left.index - right.index);

  if (new Set(ordered.map((entry) => entry.span.id)).size !== ordered.length) {
    return null;
  }

  const ranges: TextRange[] = [];
  for (const entry of ordered) {
    const previous = ordered[ordered.indexOf(entry) - 1];
    const currentRange = ranges[ranges.length - 1];
    if (previous && currentRange && entry.index === previous.index + 1) {
      currentRange.end = entry.span.end;
      continue;
    }

    ranges.push({
      start: entry.span.start,
      end: entry.span.end,
    });
  }

  return ranges;
}

function resolveTextRange(
  text: string,
  expectedText: string,
  start: number | null,
  end: number | null,
): TextRange[] | null {
  const exactRange = resolveExactRange(text, expectedText, start, end);
  if (exactRange) {
    return [exactRange];
  }

  const uniqueRange = findUniqueRange(text, expectedText);
  return uniqueRange ? [uniqueRange] : null;
}

function hasDuplicateAlignmentIds(alignments: AlignmentSpan[]): boolean {
  return new Set(alignments.map((alignment) => alignment.alignmentId)).size !== alignments.length;
}

function hasAxisOverlap(alignments: AlignmentSpan[], axis: 'source' | 'target'): boolean {
  const ranges =
    axis === 'source'
      ? alignments.flatMap((alignment) => alignment.sourceRanges)
      : alignments.map((alignment) => ({ start: alignment.targetStart, end: alignment.targetEnd }));
  const ordered = [...ranges].sort((left, right) => left.start - right.start);

  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].start < ordered[index - 1].end) {
      return true;
    }
  }

  return false;
}

function hasRangeOverlap(candidateRanges: TextRange[], existingRanges: TextRange[]): boolean {
  return candidateRanges.some((candidate) =>
    existingRanges.some(
      (existing) => candidate.start < existing.end && existing.start < candidate.end,
    ),
  );
}

function normalizeTranslatedPartSourceSpanIds(
  rawPart: RawTranslatedPartLike,
  tolerantProviderOutput: boolean,
): string[] | null {
  if (!Object.prototype.hasOwnProperty.call(rawPart, 'sourceSpanIds')) {
    return [];
  }

  if (!Array.isArray(rawPart.sourceSpanIds)) {
    return tolerantProviderOutput ? [] : null;
  }

  const normalized = rawPart.sourceSpanIds
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim());

  if (!tolerantProviderOutput && normalized.length !== rawPart.sourceSpanIds.length) {
    return null;
  }

  if (!tolerantProviderOutput && normalized.length === 0) {
    return null;
  }

  return normalized;
}

function normalizeSourceSpanIds(rawAlignment: RawAlignmentLike): string[] {
  if (Array.isArray(rawAlignment.sourceSpanIds)) {
    return rawAlignment.sourceSpanIds
      .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      .map((value) => value.trim());
  }

  if (typeof rawAlignment.sourceSpanId === 'string' && rawAlignment.sourceSpanId.trim()) {
    return [rawAlignment.sourceSpanId.trim()];
  }

  return [];
}

function normalizeAlignmentId(rawAlignment: RawAlignmentLike): string | null {
  if (typeof rawAlignment.alignmentId === 'string' && rawAlignment.alignmentId.trim()) {
    return rawAlignment.alignmentId.trim();
  }

  return null;
}

function normalizeInteger(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

function normalizeFragmentText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildSourceText(text: string, ranges: TextRange[]): string {
  return ranges.map((range) => text.slice(range.start, range.end).trim()).join(' ').trim();
}

function firstSourceStart(alignment: AlignmentSpan): number {
  return alignment.sourceRanges[0]?.start ?? Number.MAX_SAFE_INTEGER;
}

function resolveTargetTextRange(
  text: string,
  expectedText: string,
  targetOccurrence: number | null,
  start: number | null,
  end: number | null,
): TextRange | null {
  if (targetOccurrence !== null) {
    return findOccurrenceRange(text, expectedText, targetOccurrence);
  }

  const ranges = resolveTextRange(text, expectedText, start, end);
  return ranges?.[0] ?? null;
}

function resolveExactRange(
  text: string,
  expectedText: string,
  start: number | null,
  end: number | null,
): TextRange | null {
  if (start === null || end === null || start < 0 || end <= start || end > text.length) {
    return null;
  }

  if (text.slice(start, end) === expectedText) {
    return { start, end };
  }

  const trimmed = trimRange(text, start, end);
  return trimmed.text === expectedText ? { start: trimmed.start, end: trimmed.end } : null;
}

function resolveLegacyRange(
  text: string,
  start: number | null,
  end: number | null,
): TextRange | null {
  if (start === null || end === null || start < 0 || end <= start || end > text.length) {
    return null;
  }

  const trimmed = trimRange(text, start, end);
  return trimmed.text ? { start: trimmed.start, end: trimmed.end } : null;
}

function trimRange(
  text: string,
  start: number,
  end: number,
): { start: number; end: number; text: string } {
  let nextStart = start;
  let nextEnd = end;

  while (nextStart < nextEnd && /\s/u.test(text[nextStart] ?? '')) {
    nextStart += 1;
  }

  while (nextEnd > nextStart && /\s/u.test(text[nextEnd - 1] ?? '')) {
    nextEnd -= 1;
  }

  return {
    start: nextStart,
    end: nextEnd,
    text: text.slice(nextStart, nextEnd),
  };
}

function findUniqueRange(text: string, expectedText: string): TextRange | null {
  const first = text.indexOf(expectedText);
  if (first === -1) {
    return null;
  }

  if (text.indexOf(expectedText, first + expectedText.length) !== -1) {
    return null;
  }

  return {
    start: first,
    end: first + expectedText.length,
  };
}

function findOccurrenceRange(
  text: string,
  expectedText: string,
  occurrence: number,
): TextRange | null {
  if (occurrence < 0) {
    return null;
  }

  let start = -1;
  let searchFrom = 0;

  for (let index = 0; index <= occurrence; index += 1) {
    start = text.indexOf(expectedText, searchFrom);
    if (start === -1) {
      return null;
    }
    searchFrom = start + expectedText.length;
  }

  return {
    start,
    end: start + expectedText.length,
  };
}

function isIgnorableWhitespaceAlignment(rawAlignment: RawAlignmentLike): boolean {
  return (
    typeof rawAlignment.sourceText === 'string' &&
    rawAlignment.sourceText.trim() === '' &&
    (typeof rawAlignment.targetText !== 'string' || rawAlignment.targetText.trim() === '')
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasUnexpectedKeys(value: Record<string, unknown>, allowedKeys: string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).some((key) => !allowed.has(key));
}

function normalizeSanitizeOptions(
  sourceLangHintOrOptions: string | Partial<SanitizeTranslationOptions>,
): SanitizeTranslationOptions {
  if (typeof sourceLangHintOrOptions === 'string') {
    return {
      sourceLangHint: sourceLangHintOrOptions,
      tolerantProviderOutput: false,
    };
  }

  return {
    sourceLangHint: sourceLangHintOrOptions.sourceLangHint ?? 'auto',
    tolerantProviderOutput: sourceLangHintOrOptions.tolerantProviderOutput ?? false,
  };
}

function normalizeSourceLangHint(sourceLangHint: string): string {
  const trimmed = sourceLangHint.trim();
  return trimmed || 'auto';
}
