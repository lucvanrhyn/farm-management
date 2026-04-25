// @vitest-environment jsdom
/**
 * Adversarial Bug 1 (CRITICAL) — `readAllRows` in onboarding/import/page.tsx
 * still does `await import("xlsx")` even though Wave 1 W1d removed `xlsx`
 * from package.json. The dynamic import is invisible to the build but throws
 * `Cannot find module 'xlsx'` at runtime on every commit-import with > 20
 * rows, silently breaking onboarding.
 *
 * RED gate: this test imports `readAllRows` and parses a real ExcelJS-built
 * xlsx. Before the fix, the dynamic import errors and the test fails. After
 * the fix (route through lib/xlsx-shim), the rows parse correctly with
 * SheetJS-equivalent `defval: ""` / `raw: false` semantics.
 */
import { describe, it, expect } from "vitest";
import { readAllRows } from "@/lib/onboarding/read-all-rows";
import { buildXlsxFile, TINY_ROWS } from "../fixtures/build-xlsx";

describe("onboarding/import readAllRows — Bug 1 regression", () => {
  it("parses every row of a real xlsx through the xlsx-shim (no `xlsx` package)", async () => {
    // Build a real xlsx via ExcelJS — same path users hit in the wizard.
    const file = await buildXlsxFile(TINY_ROWS);

    const rows = await readAllRows(file);

    // 3 data rows after the header.
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      "Ear Tag": "A001",
      Sex: "Female",
      Breed: "Bonsmara",
    });
    expect(rows[1]).toMatchObject({
      "Ear Tag": "A002",
      Sex: "Male",
      Breed: "Bonsmara",
    });
    expect(rows[2]).toMatchObject({
      "Ear Tag": "A003",
      Sex: "Female",
      Breed: "Angus",
    });
  });

  it("applies sanitizeRow to defuse formula-injection in cells", async () => {
    const ROWS = [
      ["animal_id", "name"],
      ["A001", "=SUM(1+1)"], // would re-evaluate as a formula on re-open
      ["A002", "+CMD"],
    ];
    const file = await buildXlsxFile(ROWS);

    const rows = await readAllRows(file);

    expect(rows).toHaveLength(2);
    // sanitizeRow prefixes a single-quote so Excel/Sheets treats it as text.
    expect(rows[0].name).toBe("'=SUM(1+1)");
    expect(rows[1].name).toBe("'+CMD");
  });

  it("applies SheetJS-equivalent defval:'' for missing cells", async () => {
    // Row 2 has only 2 of 3 columns populated — defval should fill "".
    const ROWS: unknown[][] = [
      ["a", "b", "c"],
      ["1", "2", "3"],
      ["x", "y", ""], // ExcelJS preserves empty trailing cell
    ];
    const file = await buildXlsxFile(ROWS);

    const rows = await readAllRows(file);

    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ a: "x", b: "y", c: "" });
  });
});
