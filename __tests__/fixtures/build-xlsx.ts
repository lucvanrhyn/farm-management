/**
 * Test helper — synthesize a File containing a small xlsx workbook.
 *
 * Avoids checking a binary fixture into the repo by building the workbook
 * in-memory via ExcelJS (the xlsx-shim) and wrapping the bytes in a browser
 * File object.
 */

import {
  buildWorkbookFromAOA,
  writeWorkbookToBuffer,
  ExcelJS,
} from "@/lib/xlsx-shim";

export type XlsxRows = unknown[][];

export async function buildXlsxFile(
  rows: XlsxRows,
  filename: string = "test.xlsx",
  opts: { emptySheets?: boolean } = {},
): Promise<File> {
  let buffer: Buffer;
  if (opts.emptySheets) {
    // Deliberately produce a workbook with no sheets for the zero-sheet test.
    const wb = new ExcelJS.Workbook();
    buffer = await writeWorkbookToBuffer(wb);
  } else {
    const wb = buildWorkbookFromAOA(rows, "Sheet1");
    buffer = await writeWorkbookToBuffer(wb);
  }
  // Wrap as Uint8Array so the BlobPart typing accepts it across both Node
  // and DOM lib targets. SharedArrayBuffer-vs-ArrayBuffer typing collision
  // means we cast through `any`.
  const bytes = new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  return new File(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [bytes as any],
    filename,
    {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  );
}

/** A minimal, valid workbook with three sample rows for happy-path tests. */
export const TINY_ROWS: XlsxRows = [
  ["Ear Tag", "Sex", "Birth Date", "Breed"],
  ["A001", "Female", "2022-01-15", "Bonsmara"],
  ["A002", "Male", "2022-03-02", "Bonsmara"],
  ["A003", "Female", "2023-05-20", "Angus"],
];
