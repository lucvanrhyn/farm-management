/**
 * Browser-side spreadsheet parser + SHA-256 helper for the AI Import Wizard.
 *
 * Parses xlsx/csv files in the browser using ExcelJS (via lib/xlsx-shim),
 * reading headers and a preview of data rows that will be shipped to the
 * server-side mapping proposal endpoint. The full file never crosses the
 * wire — we send a small sample plus the SHA-256 fingerprint so duplicate
 * imports can be detected.
 */

import {
  readWorkbook,
  readFirstSheetAsArrays,
  readFirstSheetAsObjects,
} from "@/lib/xlsx-shim";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_COLUMNS = 200;
const PREVIEW_ROW_COUNT = 20;

export type ParsedSpreadsheet = {
  parsedColumns: string[];
  sampleRows: Record<string, unknown>[];
  fullRowCount: number;
};

/**
 * Parse the first sheet of an xlsx/csv file into header names + preview rows.
 * Throws with a user-facing message when the file is empty, too large, or
 * malformed so the wizard can render a simple error toast.
 */
export async function parseSpreadsheet(file: File): Promise<ParsedSpreadsheet> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("File too large — max 10 MB");
  }

  const buffer = await file.arrayBuffer();
  let workbook: Awaited<ReturnType<typeof readWorkbook>>;
  try {
    workbook = await readWorkbook(buffer);
  } catch (err) {
    throw new Error(
      `Could not parse spreadsheet — ${err instanceof Error ? err.message : "invalid file"}`,
    );
  }

  if (workbook.sheetNames.length === 0) {
    throw new Error("Spreadsheet has no sheets");
  }

  // Header row via array-of-arrays read; row 0 = headers.
  const arrays = readFirstSheetAsArrays(workbook);
  const headerRow = arrays[0];
  if (!Array.isArray(headerRow) || headerRow.length === 0) {
    throw new Error("Spreadsheet has no header row");
  }

  const parsedColumns = headerRow
    .map((h) => (h === undefined || h === null ? "" : String(h).trim()))
    .filter((h) => h.length > 0);

  if (parsedColumns.length === 0) {
    throw new Error("Spreadsheet has no named columns");
  }
  if (parsedColumns.length > MAX_COLUMNS) {
    throw new Error(`Too many columns (${parsedColumns.length}) — max ${MAX_COLUMNS}`);
  }

  // Row objects keyed by header name.
  const rows = readFirstSheetAsObjects(workbook, {
    defval: "",
    raw: false,
  });

  if (rows.length === 0) {
    throw new Error("Spreadsheet has no data rows");
  }

  // Defuse formula-injection payloads in string cells before they propagate
  // to the AI adapter prompt or any future CSV re-export. SheetJS with
  // `raw: false` returns the cached evaluated value as a string — we prefix
  // single-quote to neutralise anything that would be re-interpreted as a
  // formula (`=`, `+`, `-`, `@`) by Excel / Sheets on re-open.
  const sanitized = rows.slice(0, PREVIEW_ROW_COUNT).map(sanitizeRow);

  return {
    parsedColumns,
    sampleRows: sanitized,
    fullRowCount: rows.length,
  };
}

export function sanitizeCell(v: unknown): unknown {
  return typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/**
 * Defuse formula-injection payloads in every cell of a row. Exported so the
 * full-file re-parse path on the import step can apply the same sanitization
 * that parseSpreadsheet applies to the 20-row preview — otherwise rows 21+
 * would slip formulae through.
 */
export function sanitizeRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = sanitizeCell(v);
  return out;
}

/**
 * Compute a lowercase hex SHA-256 digest of the file contents.
 *
 * Uses the browser's SubtleCrypto API. Will throw on non-HTTPS origins
 * without crypto.subtle available — the wizard only runs on same-origin
 * authenticated routes, so that constraint is always met.
 */
export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
