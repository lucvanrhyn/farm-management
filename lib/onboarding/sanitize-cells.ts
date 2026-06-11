/**
 * lib/onboarding/sanitize-cells.ts
 *
 * Formula-injection (CSV/DDE injection) neutralizer for spreadsheet cell
 * values. A value starting with `=`, `+`, `-`, `@`, tab, or CR would be
 * re-interpreted as a formula by Excel / Google Sheets on re-open or
 * re-export; prefixing a single quote renders it inert text.
 *
 * Extracted from `parse-file.ts` (S15 / M3) so the SERVER commit path can
 * apply the same sanitization without importing the browser parser (which
 * pulls ExcelJS via lib/xlsx-shim into the bundle). `parse-file.ts`
 * re-exports these for its existing client callers.
 *
 * The prefix check is idempotent by construction: a previously sanitized
 * value starts with `'`, which is not a trigger character, so it is never
 * double-prefixed.
 */

const FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/;

/** Neutralize a known-string cell value. */
export function sanitizeCellString(value: string): string {
  return FORMULA_TRIGGER_RE.test(value) ? `'${value}` : value;
}

/** Neutralize a cell of unknown type; non-strings pass through untouched. */
export function sanitizeCell(v: unknown): unknown {
  return typeof v === "string" ? sanitizeCellString(v) : v;
}

/** Neutralize every cell of a row (returns a NEW object — never mutates). */
export function sanitizeRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = sanitizeCell(v);
  return out;
}
