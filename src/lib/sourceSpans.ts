export interface SourceSpan {
  id: string;
  text: string;
  start: number;
  end: number;
}

const SOURCE_SPAN_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu;

export function buildSourceSpans(text: string): SourceSpan[] {
  const spans: SourceSpan[] = [];
  SOURCE_SPAN_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(SOURCE_SPAN_PATTERN)) {
    const value = match[0];
    const start = match.index ?? 0;
    spans.push({
      id: `s${spans.length}`,
      text: value,
      start,
      end: start + value.length,
    });
  }

  return spans;
}
