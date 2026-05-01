/**
 * O2 sister test — verifies the static `/sample-pedigree.csv` asset exists in
 * `public/` and exposes the expected header row, so the link from
 * NoPedigreeEmptyState always points at a well-formed file. Catches anyone
 * silently editing the columns without updating the explainer copy.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const CSV_PATH = path.join(process.cwd(), "public", "sample-pedigree.csv");

const EXPECTED_HEADER =
  "animalId,sex,birthDate,motherId,fatherId,breed,category,sireRegNumber,damRegNumber,notes";

describe("public/sample-pedigree.csv", () => {
  it("exists at the documented path", () => {
    expect(existsSync(CSV_PATH)).toBe(true);
  });

  it("has the documented header row", () => {
    const raw = readFileSync(CSV_PATH, "utf8");
    const firstLine = raw.split(/\r?\n/)[0];
    expect(firstLine).toBe(EXPECTED_HEADER);
  });

  it("includes at least 5 example rows so users see realistic data", () => {
    const raw = readFileSync(CSV_PATH, "utf8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    // header + ≥ 5 data rows
    expect(lines.length).toBeGreaterThanOrEqual(6);
  });
});
