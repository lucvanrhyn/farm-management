/**
 * Test helper — synthesize a File containing a small xlsx workbook.
 *
 * Avoids checking a binary fixture into the repo by building the workbook
 * in-memory via SheetJS and wrapping the bytes in a browser File object.
 */

import * as XLSX from "xlsx";

export type XlsxRows = unknown[][];

export function buildXlsxFile(
  rows: XlsxRows,
  filename: string = "test.xlsx",
  opts: { emptySheets?: boolean } = {},
): File {
  const workbook = XLSX.utils.book_new();

  if (opts.emptySheets) {
    // Deliberately produce a workbook with no sheets for the zero-sheet test.
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    return new File([bytes], filename, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new File([bytes], filename, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** A minimal, valid workbook with three sample rows for happy-path tests. */
export const TINY_ROWS: XlsxRows = [
  ["Ear Tag", "Sex", "Birth Date", "Breed"],
  ["A001", "Female", "2022-01-15", "Bonsmara"],
  ["A002", "Male", "2022-03-02", "Bonsmara"],
  ["A003", "Female", "2023-05-20", "Angus"],
];
