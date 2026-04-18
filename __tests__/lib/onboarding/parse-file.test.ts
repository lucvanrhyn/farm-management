// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import * as XLSX from "xlsx";
import { parseSpreadsheet, hashFile } from "@/lib/onboarding/parse-file";
import { buildXlsxFile, TINY_ROWS } from "../../fixtures/build-xlsx";

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// parseSpreadsheet — happy path
// ---------------------------------------------------------------------------

describe("parseSpreadsheet", () => {
  it("returns parsedColumns, sampleRows, and fullRowCount from a tiny xlsx", async () => {
    const file = buildXlsxFile(TINY_ROWS);
    const result = await parseSpreadsheet(file);

    expect(result.parsedColumns).toEqual(["Ear Tag", "Sex", "Birth Date", "Breed"]);
    expect(result.fullRowCount).toBe(3);
    expect(result.sampleRows).toHaveLength(3);
    expect(result.sampleRows[0]).toMatchObject({
      "Ear Tag": "A001",
      Sex: "Female",
      Breed: "Bonsmara",
    });
  });

  // -------------------------------------------------------------------------
  // Error paths
  // -------------------------------------------------------------------------

  it("throws when the file exceeds the 10 MB cap", async () => {
    const file = new File([""], "huge.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    // Override reported size without allocating 11 MB of bytes.
    Object.defineProperty(file, "size", { value: 11 * 1024 * 1024 });

    await expect(parseSpreadsheet(file)).rejects.toThrow(/File too large/);
  });

  it("throws on an unparseable / corrupt file", async () => {
    // Random bytes that aren't a valid xlsx — exercises the XLSX.read catch
    // branch that surfaces a "Could not parse spreadsheet" error.
    const file = new File(
      [new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x00, 0x00, 0x00])],
      "corrupt.xlsx",
      {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    );
    // Depending on XLSX's leniency, the bytes may parse as an empty
    // workbook (zero data rows) or fail the initial read. Either way the
    // user-facing behaviour is a thrown Error — which is what we assert.
    await expect(parseSpreadsheet(file)).rejects.toThrow();
  });

  it("throws when the sheet has no header row", async () => {
    // aoa_to_sheet on [[]] produces an empty sheet; XLSX treats that as no rows.
    const file = buildXlsxFile([]);
    await expect(parseSpreadsheet(file)).rejects.toThrow(/no header row/i);
  });

  it("throws when header row is present but has no named columns", async () => {
    // Headers are all blanks — after trim+filter, zero named columns remain.
    const file = buildXlsxFile([
      ["", "", ""],
      ["a", "b", "c"],
    ]);
    await expect(parseSpreadsheet(file)).rejects.toThrow(/no named columns/i);
  });

  it("throws when there are more than 200 columns", async () => {
    const headers = Array.from({ length: 201 }, (_, i) => `col${i + 1}`);
    const dataRow = Array.from({ length: 201 }, () => "x");
    const file = buildXlsxFile([headers, dataRow]);
    await expect(parseSpreadsheet(file)).rejects.toThrow(/Too many columns/);
  });

  // -------------------------------------------------------------------------
  // Formula-injection sanitizer
  // -------------------------------------------------------------------------

  it("prefixes formula-injection payloads in sampleRows", async () => {
    const file = buildXlsxFile([
      ["A", "B", "C", "D"],
      ["=HYPERLINK(\"evil\")", "+CMD", "-ABC", "@func"],
      ["safe", "value", "here", "ok"],
    ]);
    const result = await parseSpreadsheet(file);

    // Cell values returned via `sheet_to_json` become strings with raw:false.
    const firstRow = result.sampleRows[0]!;
    expect(firstRow.A).toBe("'=HYPERLINK(\"evil\")");
    expect(firstRow.B).toBe("'+CMD");
    expect(firstRow.C).toBe("'-ABC");
    expect(firstRow.D).toBe("'@func");

    // Benign row untouched.
    const secondRow = result.sampleRows[1]!;
    expect(secondRow.A).toBe("safe");
  });
});

// ---------------------------------------------------------------------------
// hashFile
// ---------------------------------------------------------------------------

describe("hashFile", () => {
  it("returns a 64-char lowercase hex string", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "x.bin");
    const hash = await hashFile(file);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same hash for identical content", async () => {
    const f1 = new File([new Uint8Array([1, 2, 3])], "a.bin");
    const f2 = new File([new Uint8Array([1, 2, 3])], "b.bin");
    expect(await hashFile(f1)).toBe(await hashFile(f2));
  });

  it("produces different hashes for different content", async () => {
    const f1 = new File([new Uint8Array([1, 2, 3])], "a.bin");
    const f2 = new File([new Uint8Array([1, 2, 4])], "b.bin");
    expect(await hashFile(f1)).not.toBe(await hashFile(f2));
  });
});

// ---------------------------------------------------------------------------
// Sanity: ensure XLSX import works in jsdom (regression guard).
// ---------------------------------------------------------------------------

it("sanity check — XLSX can parse its own output in jsdom", async () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["a"], ["1"]]);
  XLSX.utils.book_append_sheet(workbook, sheet, "S1");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const reread = XLSX.read(bytes, { type: "array" });
  expect(reread.SheetNames).toEqual(["S1"]);
});
