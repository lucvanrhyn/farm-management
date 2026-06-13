/**
 * Thin compatibility shim over ExcelJS that preserves the small surface of
 * the abandoned `xlsx` (SheetJS CE) API our codebase actually used.
 *
 * Rationale: replacing `xlsx@0.18.5` resolves CVE-2023-30533 (prototype
 * pollution) and CVE-2024-22363 (ReDoS). ExcelJS is actively maintained on
 * npm — a CDN-pinned tarball install would have broken `pnpm audit` in CI.
 *
 * The shim intentionally exposes only the operations we need:
 *   - read first / named sheet → JSON or array-of-arrays
 *   - write a workbook from AOA or array-of-objects
 *   - configurable defval + raw=false (SheetJS semantics) for cell coercion
 *   - CSV ingestion (S13 / OB-csv): readWorkbook sniffs the bytes — zip
 *     container → xlsx path, text → an RFC-4180 CSV parse that loads into a
 *     synthetic worksheet so every existing reader produces the identical
 *     row model for both formats.
 *
 * It does NOT attempt to be a drop-in clone of SheetJS's `XLSX.utils.*` —
 * callsites have been migrated to the helpers below.
 */

import ExcelJS from "exceljs";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** A loaded workbook. Wraps an ExcelJS workbook with sheet-name index. */
export type LoadedWorkbook = ExcelJS.Workbook & { sheetNames: string[] };

export type ReadOptions = {
  /** Default value for missing/empty cells in object-mode reads. */
  defval?: unknown;
  /**
   * Match SheetJS `raw: false` semantics — coerce cell values to strings.
   * When `false`/undefined, native types (number, Date) are preserved.
   */
  raw?: boolean;
};

export type ColumnSpec = {
  /** Column header text (and the key used in object writes). */
  header: string;
  /** Column key used as object property when writing from records. */
  key?: string;
  /** Column width in characters. */
  width?: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Supported file types (S13 / OB-csv)
// ─────────────────────────────────────────────────────────────────────────────

/** File extensions the spreadsheet pipeline accepts, in display order. */
export const SUPPORTED_SPREADSHEET_EXTENSIONS = [".xlsx", ".csv"] as const;

/** `accept` attribute value for file inputs feeding `readWorkbook`. */
export const SPREADSHEET_ACCEPT = SUPPORTED_SPREADSHEET_EXTENSIONS.join(",");

/**
 * MIME types accepted when a file name carries no recognizable extension.
 * Windows commonly labels `.csv` files with the legacy Excel MIME type.
 */
const SUPPORTED_SPREADSHEET_MIME_TYPES: ReadonlySet<string> = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/**
 * Boundary guard for upload surfaces: does this file LOOK like a supported
 * spreadsheet? Extension wins; MIME type is the fallback for extension-less
 * names. `readWorkbook` still sniffs the actual bytes, so a mislabeled file
 * fails later with a specific parse error rather than crashing.
 */
export function isSupportedSpreadsheetFile(
  fileName: string,
  mimeType?: string,
): boolean {
  const name = fileName.toLowerCase();
  if (SUPPORTED_SPREADSHEET_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return true;
  }
  return mimeType
    ? SUPPORTED_SPREADSHEET_MIME_TYPES.has(mimeType.toLowerCase())
    : false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load a workbook from a Node Buffer or browser ArrayBuffer.
 *
 * Sniffs the leading bytes: a zip container is parsed as xlsx; anything
 * else is decoded as text and parsed as delimited CSV (S13 / OB-csv), so
 * both formats surface through the same `LoadedWorkbook` row model.
 * Throws a branch-specific error for binary non-spreadsheet input.
 */
export async function readWorkbook(
  data: ArrayBuffer | Buffer | Uint8Array,
): Promise<LoadedWorkbook> {
  // Normalize all inputs to a fresh Uint8Array. jszip (used internally by
  // ExcelJS) doesn't always accept Node's Buffer or sliced ArrayBuffers in
  // jsdom — but a plain Uint8Array view is always safe.
  let bytes: Uint8Array;
  if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else if (
    data &&
    typeof data === "object" &&
    "buffer" in data &&
    "byteOffset" in data &&
    "byteLength" in data
  ) {
    const view = data as {
      buffer: ArrayBuffer;
      byteOffset: number;
      byteLength: number;
    };
    bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  } else {
    throw new Error("readWorkbook: unsupported data type");
  }
  if (!isZipContainer(bytes)) {
    // Not a zip ⇒ cannot be xlsx. Parse as delimited text instead of letting
    // jszip throw its opaque "end of central directory" error (OB-csv).
    return csvToLoadedWorkbook(decodeSpreadsheetText(bytes));
  }
  const wb = new ExcelJS.Workbook();
  // ExcelJS's TypeScript types want a Node Buffer, but `load()` accepts any
  // ArrayBufferView at runtime (jszip handles the coercion). Cast through
  // `unknown` so the shim works in both Node and browser builds.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(bytes as any);
  // Surface sheet names in declaration order, matching SheetJS `SheetNames`.
  const sheetNames: string[] = [];
  wb.eachSheet((ws) => {
    sheetNames.push(ws.name);
  });
  return Object.assign(wb, { sheetNames });
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV read path (S13 / OB-csv)
// ─────────────────────────────────────────────────────────────────────────────

/** xlsx files are zip containers — local-file-header magic "PK\x03\x04". */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;

/**
 * Candidate CSV delimiters in tie-break priority order. `;` covers ZA-locale
 * exports (decimal comma ⇒ semicolon separator); `\t` covers Excel's
 * "Unicode Text" output.
 */
const CSV_DELIMITERS = [",", ";", "\t"] as const;

/** Worksheet name the CSV rows are loaded into (matches xlsx default). */
const CSV_SHEET_NAME = "Sheet1";

function isZipContainer(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((magicByte, i) => bytes[i] === magicByte);
}

/**
 * BOM-aware text decode. Supports UTF-8 (with or without BOM) and UTF-16
 * LE/BE with BOM — the encodings Excel and ZA bank/auction exports emit.
 * Fatal decoding doubles as binary detection: invalid byte sequences mean
 * "this is not a text file", and NUL characters catch BOM-less UTF-16 or
 * binary formats whose bytes happen to be UTF-8-valid.
 */
function decodeSpreadsheetText(bytes: Uint8Array): string {
  let encoding: string;
  let body: Uint8Array;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = "utf-8";
    body = bytes.subarray(3);
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
    body = bytes.subarray(2);
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
    body = bytes.subarray(2);
  } else {
    encoding = "utf-8";
    body = bytes;
  }
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(body);
  } catch {
    throw new Error(
      "readWorkbook: file is not a valid .xlsx workbook or text-based .csv",
    );
  }
  if (text.includes("\u0000")) {
    throw new Error(
      "readWorkbook: binary content is not a supported spreadsheet format",
    );
  }
  return text;
}

/**
 * Detect the delimiter by counting candidates outside quotes in the first
 * logical record (header row). Ties and zero-hit files fall back to comma.
 */
function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(CSV_DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') i++;
        else inQuotes = false;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === "\n" || ch === "\r") break;
    const seen = counts.get(ch);
    if (seen !== undefined) counts.set(ch, seen + 1);
  }
  let best: string = CSV_DELIMITERS[0];
  let bestCount = 0;
  for (const candidate of CSV_DELIMITERS) {
    const count = counts.get(candidate) ?? 0;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * RFC-4180 state-machine parse: quoted fields, `""` escapes, embedded
 * delimiters/newlines inside quotes, and LF / CRLF / bare-CR row breaks.
 * Lenient like Excel for quotes appearing mid-field (treated literally)
 * and for an unterminated trailing quote (field is flushed as-is).
 */
function parseDelimitedText(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    fields.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(fields);
    fields = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      endField();
      continue;
    }
    if (ch === "\n") {
      endRecord();
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRecord();
      continue;
    }
    field += ch;
  }
  // Flush the final record unless the text ended exactly at a record
  // boundary (i.e. a trailing newline must not yield a phantom row).
  if (field !== "" || fields.length > 0) endRecord();
  return records;
}

/**
 * Coerce a raw CSV field to match the cell types the xlsx path yields:
 * empty → undefined (empty cell), canonical numeric literal → number,
 * everything else stays a string. The `String(n) === field` round-trip
 * keeps leading-zero identifiers ("007"), precision-losing long digit
 * runs, and exponent notation as strings.
 */
function coerceCsvField(field: string): string | number | undefined {
  if (field === "") return undefined;
  const n = Number(field);
  if (Number.isFinite(n) && String(n) === field) return n;
  return field;
}

/** Load parsed CSV records into a single-sheet workbook. */
function csvToLoadedWorkbook(text: string): LoadedWorkbook {
  const delimiter = detectDelimiter(text);
  const records = parseDelimitedText(text, delimiter);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(CSV_SHEET_NAME);
  for (const record of records) {
    ws.addRow(record.map(coerceCsvField));
  }
  return Object.assign(wb, { sheetNames: [CSV_SHEET_NAME] });
}

/**
 * Read a workbook from a file path on disk (Node only).
 */
export async function readWorkbookFile(filePath: string): Promise<LoadedWorkbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheetNames: string[] = [];
  wb.eachSheet((ws) => {
    sheetNames.push(ws.name);
  });
  return Object.assign(wb, { sheetNames });
}

/**
 * Read the first sheet as an array of arrays. Index 0 is the header row.
 * Trailing empty cells in any row are preserved up to the longest row width.
 */
export function readFirstSheetAsArrays(wb: LoadedWorkbook): unknown[][] {
  const ws = wb.worksheets[0];
  if (!ws) return [];
  return readSheetAsArraysImpl(ws);
}

/** Read a named sheet as an array of arrays. */
export function readSheetAsArrays(
  wb: LoadedWorkbook,
  sheetName: string,
): unknown[][] {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return [];
  return readSheetAsArraysImpl(ws);
}

function readSheetAsArraysImpl(ws: ExcelJS.Worksheet): unknown[][] {
  const out: unknown[][] = [];
  let maxCol = 0;
  ws.eachRow({ includeEmpty: false }, (row) => {
    // ExcelJS row.values is 1-indexed (index 0 is undefined). Slice it.
    const values = (row.values as unknown[]).slice(1);
    if (values.length > maxCol) maxCol = values.length;
    out.push(values.map(coerceCellRaw));
  });
  // Pad to maxCol so downstream consumers can rely on consistent width.
  for (const row of out) {
    while (row.length < maxCol) row.push(undefined);
  }
  return out;
}

/** Coerce an ExcelJS cell value to a primitive — used in raw mode. */
function coerceCellRaw(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  // ExcelJS returns rich-text objects { richText: [...] } for styled strings.
  if (typeof v === "object" && v !== null && "richText" in v) {
    const rt = (v as { richText: { text: string }[] }).richText;
    return rt.map((r) => r.text).join("");
  }
  // Hyperlink cells: { text, hyperlink }
  if (typeof v === "object" && v !== null && "text" in v && "hyperlink" in v) {
    return (v as { text: string }).text;
  }
  // Formula cells: { formula, result }
  if (typeof v === "object" && v !== null && "result" in v) {
    return (v as { result: unknown }).result;
  }
  return v;
}

/**
 * Read the first sheet as objects keyed by header row.
 * Mirrors SheetJS `sheet_to_json(sheet, { defval, raw })`.
 */
export function readFirstSheetAsObjects(
  wb: LoadedWorkbook,
  opts: ReadOptions = {},
): Record<string, unknown>[] {
  const arrays = readFirstSheetAsArrays(wb);
  return arraysToObjects(arrays, opts);
}

/** Read a named sheet as objects keyed by header row. */
export function readSheetAsObjects(
  wb: LoadedWorkbook,
  sheetName: string,
  opts: ReadOptions = {},
): Record<string, unknown>[] {
  const arrays = readSheetAsArrays(wb, sheetName);
  return arraysToObjects(arrays, opts);
}

function arraysToObjects(
  arrays: unknown[][],
  opts: ReadOptions,
): Record<string, unknown>[] {
  const { defval, raw } = opts;
  const headerRow = arrays[0];
  if (!headerRow) return [];
  const headers = headerRow.map((h) =>
    h === undefined || h === null ? "" : String(h),
  );
  const out: Record<string, unknown>[] = [];
  for (let i = 1; i < arrays.length; i++) {
    const row = arrays[i];
    // Skip wholly-empty rows so trailing blank rows don't surface as "{}".
    const allEmpty = row.every(
      (v) => v === undefined || v === null || v === "",
    );
    if (allEmpty) continue;
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      let val: unknown = row[c];
      if (val === undefined || val === null || val === "") {
        if (defval !== undefined) val = defval;
      } else if (raw === false) {
        // Match SheetJS string coercion under raw:false.
        val = stringifyCell(val);
      }
      obj[key] = val;
    }
    out.push(obj);
  }
  return out;
}

function stringifyCell(v: unknown): string {
  if (v instanceof Date) {
    // ISO date prefix matches SheetJS's "yyyy-mm-dd" formatted-string output
    // closely enough for the import wizard's preview pane.
    return v.toISOString().slice(0, 10);
  }
  return String(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// Write
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a workbook from an array-of-arrays. The first row is treated as
 * literal data — there's no implicit header semantics here; callers can
 * decide. Optional `colWidths` is a parallel array of column widths in
 * characters (matches SheetJS `!cols: [{wch: N}]`).
 */
export function buildWorkbookFromAOA(
  rows: unknown[][],
  sheetName: string = "Sheet1",
  colWidths?: number[],
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  for (const row of rows) ws.addRow(row);
  if (colWidths) applyColumnWidths(ws, colWidths);
  return wb;
}

/**
 * Build a workbook from an array of plain objects. Header row is derived
 * from `headers` (or, if omitted, the keys of the first record in stable
 * insertion order).
 */
export function buildWorkbookFromObjects(
  records: Record<string, unknown>[],
  sheetName: string = "Sheet1",
  headers?: string[],
  colWidths?: number[],
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  const cols = headers ?? (records[0] ? Object.keys(records[0]) : []);
  ws.columns = cols.map((h) => ({ header: h, key: h }));
  for (const r of records) ws.addRow(r);
  if (colWidths) applyColumnWidths(ws, colWidths);
  return wb;
}

function applyColumnWidths(ws: ExcelJS.Worksheet, widths: number[]) {
  for (let i = 0; i < widths.length; i++) {
    const col = ws.getColumn(i + 1);
    col.width = widths[i];
  }
}

/** Serialize a workbook to a Node Buffer (xlsx bytes). */
export async function writeWorkbookToBuffer(
  wb: ExcelJS.Workbook,
): Promise<Buffer> {
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

/** Write a workbook to a file path (Node only). */
export async function writeWorkbookFile(
  wb: ExcelJS.Workbook,
  filePath: string,
): Promise<void> {
  await wb.xlsx.writeFile(filePath);
}

// Re-export the underlying ExcelJS namespace for the rare callsite that
// needs raw access (e.g. styling). Most code should use the helpers above.
export { ExcelJS };
