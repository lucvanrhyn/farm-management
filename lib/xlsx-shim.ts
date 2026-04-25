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
// Read
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load a workbook from a Node Buffer or browser ArrayBuffer.
 * Throws when the bytes aren't a valid xlsx.
 */
export async function readWorkbook(
  data: ArrayBuffer | Buffer | Uint8Array,
): Promise<LoadedWorkbook> {
  const wb = new ExcelJS.Workbook();
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
