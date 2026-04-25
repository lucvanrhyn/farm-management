// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  readWorkbook,
  readFirstSheetAsObjects,
  readFirstSheetAsArrays,
  readSheetAsObjects,
  buildWorkbookFromAOA,
  buildWorkbookFromObjects,
  writeWorkbookToBuffer,
} from "@/lib/xlsx-shim";

/**
 * Tests for the xlsx-shim — the small library that wraps ExcelJS to preserve
 * the (very narrow) subset of the abandoned `xlsx` package's API we actually
 * used across the codebase. If these pass, the migration is byte-equivalent
 * for our use cases.
 */

describe("xlsx-shim — round-trip", () => {
  it("writes an AOA workbook then reads it back as headers+rows", async () => {
    const rows = [
      ["Ear Tag", "Sex", "Birth Date", "Breed"],
      ["A001", "Female", "2022-01-15", "Bonsmara"],
      ["A002", "Male", "2022-03-02", "Bonsmara"],
    ];
    const wb = buildWorkbookFromAOA(rows, "Sheet1");
    const buffer = await writeWorkbookToBuffer(wb);
    const reread = await readWorkbook(buffer);

    expect(reread.sheetNames).toEqual(["Sheet1"]);
    const arrays = readFirstSheetAsArrays(reread);
    expect(arrays[0]).toEqual(["Ear Tag", "Sex", "Birth Date", "Breed"]);
    expect(arrays[1]).toEqual(["A001", "Female", "2022-01-15", "Bonsmara"]);
    expect(arrays).toHaveLength(3);
  });

  it("writes an objects workbook then reads it back as header-keyed rows", async () => {
    const records = [
      { animal_id: "B-001", sex: "Male", camp: "Kraal" },
      { animal_id: "C-001", sex: "Female", camp: "Rivier" },
    ];
    const wb = buildWorkbookFromObjects(records, "Animals", [
      "animal_id",
      "sex",
      "camp",
    ]);
    const buffer = await writeWorkbookToBuffer(wb);
    const reread = await readWorkbook(buffer);

    const objects = readFirstSheetAsObjects(reread, { defval: "" });
    expect(objects).toHaveLength(2);
    expect(objects[0]).toEqual({
      animal_id: "B-001",
      sex: "Male",
      camp: "Kraal",
    });
  });

  it("reads named sheet by name", async () => {
    const wb = buildWorkbookFromAOA(
      [
        ["camp_name", "size_hectares"],
        ["Rivier", 150],
      ],
      "Camps",
    );
    // Append a second sheet so we exercise multi-sheet lookup
    const wb2 = buildWorkbookFromAOA(
      [
        ["animal_id", "sex"],
        ["B-001", "Male"],
      ],
      "Animals",
    );
    // merge by adding the Animals sheet to wb
    const animalsSheet = wb2.getWorksheet("Animals");
    expect(animalsSheet).toBeDefined();
    const newSheet = wb.addWorksheet("Animals");
    animalsSheet!.eachRow((row, rowNumber) => {
      const values = (row.values as unknown[]).slice(1);
      // ExcelJS types row.values as CellValue[]; our unknown[] is fine at
      // runtime — cast through `any` for the test's type check.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newSheet.getRow(rowNumber).values = values as any;
    });

    const buffer = await writeWorkbookToBuffer(wb);
    const reread = await readWorkbook(buffer);

    expect(reread.sheetNames.sort()).toEqual(["Animals", "Camps"]);
    const camps = readSheetAsObjects(reread, "Camps", { defval: "" });
    expect(camps[0]).toMatchObject({ camp_name: "Rivier" });
    const animals = readSheetAsObjects(reread, "Animals", { defval: "" });
    expect(animals[0]).toMatchObject({ animal_id: "B-001", sex: "Male" });
  });

  it("preserves sheet order via SheetNames-like array", async () => {
    const wb = buildWorkbookFromAOA([["a"], ["1"]], "First");
    wb.addWorksheet("Second");
    wb.getWorksheet("Second")!.addRow(["b"]);
    const buffer = await writeWorkbookToBuffer(wb);
    const reread = await readWorkbook(buffer);
    expect(reread.sheetNames[0]).toBe("First");
    expect(reread.sheetNames[1]).toBe("Second");
  });

  it("returns empty array when first sheet is empty", async () => {
    const wb = buildWorkbookFromAOA([], "Empty");
    const buffer = await writeWorkbookToBuffer(wb);
    const reread = await readWorkbook(buffer);
    const arrays = readFirstSheetAsArrays(reread);
    expect(arrays).toEqual([]);
  });

  it("uses defval for missing/empty cells in object-mode read", async () => {
    const wb = buildWorkbookFromAOA(
      [
        ["a", "b", "c"],
        ["x", "", "z"],
      ],
      "S",
    );
    const buffer = await writeWorkbookToBuffer(wb);
    const reread = await readWorkbook(buffer);
    const rows = readFirstSheetAsObjects(reread, { defval: "" });
    expect(rows[0]).toEqual({ a: "x", b: "", c: "z" });
  });

  it("returns string values for numeric cells when raw=false", async () => {
    const wb = buildWorkbookFromAOA(
      [
        ["name", "count"],
        ["Bull", 42],
      ],
      "S",
    );
    const buffer = await writeWorkbookToBuffer(wb);
    const reread = await readWorkbook(buffer);
    const rows = readFirstSheetAsObjects(reread, { defval: "", raw: false });
    expect(rows[0]).toEqual({ name: "Bull", count: "42" });
  });

  it("throws when given un-parseable bytes", async () => {
    const garbage = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x00, 0x00, 0x00]);
    await expect(readWorkbook(garbage.buffer)).rejects.toThrow();
  });
});
