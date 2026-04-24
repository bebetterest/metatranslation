const FORMULA_PREFIX_PATTERN = /^[=+\-@]/;

export function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = FORMULA_PREFIX_PATTERN.test(raw) ? `'${raw}` : raw;
  const escaped = safe.replaceAll('"', '""');

  return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
}
