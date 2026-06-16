/**
 * @vitest-environment node
 *
 * lib/server/triage/snapshot-detectors.ts — PURE per-animal attribute
 * detectors. No I/O: each takes already-fetched Animal rows (and, for the
 * weighing detector, a Set of animalIds that have a weighing on record) and
 * returns Findings.
 */
import { describe, it, expect } from "vitest";
import {
  detectNoCamp,
  detectMissingId,
  detectMissingDob,
  detectAgeForCategory,
  detectNoWeightOnRecord,
  runSnapshotDetectors,
  type TriageAnimal,
} from "@/lib/server/triage/snapshot-detectors";

function animal(overrides: Partial<TriageAnimal> = {}): TriageAnimal {
  return {
    animalId: "A1",
    species: "cattle",
    currentCamp: "NORTH-01",
    tagNumber: "12345",
    brandSequence: null,
    dateOfBirth: "2022-01-01",
    category: "Cow",
    ...overrides,
  };
}

describe("detectNoCamp", () => {
  it("flags an empty-string camp (the canonical 'unassigned' representation)", () => {
    const out = detectNoCamp([animal({ animalId: "A1", currentCamp: "" })]);
    expect(out).toEqual([{ animalId: "A1", reasonId: "no-camp", species: "cattle" }]);
  });
  it("flags whitespace-only camp", () => {
    expect(detectNoCamp([animal({ currentCamp: "   " })])).toHaveLength(1);
  });
  it("flags sentinel tokens case-insensitively", () => {
    expect(detectNoCamp([animal({ currentCamp: "Unassigned" })])).toHaveLength(1);
    expect(detectNoCamp([animal({ currentCamp: "none" })])).toHaveLength(1);
    expect(detectNoCamp([animal({ currentCamp: "-" })])).toHaveLength(1);
  });
  it("does NOT flag a real camp name", () => {
    expect(detectNoCamp([animal({ currentCamp: "NORTH-01" })])).toEqual([]);
  });
});

describe("detectMissingId", () => {
  it("flags when BOTH tagNumber and brandSequence are absent", () => {
    const out = detectMissingId([animal({ animalId: "A2", tagNumber: null, brandSequence: null })]);
    expect(out).toEqual([{ animalId: "A2", reasonId: "missing-id", species: "cattle" }]);
  });
  it("treats empty/whitespace strings as absent", () => {
    expect(detectMissingId([animal({ tagNumber: "", brandSequence: "  " })])).toHaveLength(1);
  });
  it("does NOT flag when a tagNumber is present", () => {
    expect(detectMissingId([animal({ tagNumber: "999", brandSequence: null })])).toEqual([]);
  });
  it("does NOT flag when a brandSequence is present", () => {
    expect(detectMissingId([animal({ tagNumber: null, brandSequence: "ABC-1" })])).toEqual([]);
  });
});

describe("detectMissingDob", () => {
  it("flags a null date of birth", () => {
    expect(detectMissingDob([animal({ dateOfBirth: null })])).toHaveLength(1);
  });
  it("flags an empty / whitespace dob string", () => {
    expect(detectMissingDob([animal({ dateOfBirth: "" })])).toHaveLength(1);
    expect(detectMissingDob([animal({ dateOfBirth: "  " })])).toHaveLength(1);
  });
  it("flags an unparseable dob string", () => {
    expect(detectMissingDob([animal({ dateOfBirth: "not-a-date" })])).toHaveLength(1);
  });
  it("does NOT flag a parseable dob", () => {
    expect(detectMissingDob([animal({ dateOfBirth: "2021-06-15" })])).toEqual([]);
  });
});

describe("detectAgeForCategory (conservative — clear mismatches only)", () => {
  const now = new Date("2026-06-15T00:00:00.000Z");

  it("flags a cattle 'Calf' that is clearly too old (> 2 years)", () => {
    // born 2022 → ~4y old, well past the conservative calf ceiling
    const out = detectAgeForCategory([animal({ category: "Calf", dateOfBirth: "2022-01-01" })], now);
    expect(out).toEqual([{ animalId: "A1", reasonId: "age-for-category", species: "cattle" }]);
  });
  it("flags a cattle adult 'Cow' that is clearly too young (< 1 year)", () => {
    const out = detectAgeForCategory([animal({ category: "Cow", dateOfBirth: "2026-01-01" })], now);
    expect(out).toHaveLength(1);
  });
  it("does NOT flag an age-appropriate calf", () => {
    expect(
      detectAgeForCategory([animal({ category: "Calf", dateOfBirth: "2026-03-01" })], now),
    ).toEqual([]);
  });
  it("does NOT flag when dob is missing/unparseable (that is missing-dob's job)", () => {
    expect(detectAgeForCategory([animal({ category: "Calf", dateOfBirth: null })], now)).toEqual([]);
    expect(detectAgeForCategory([animal({ category: "Calf", dateOfBirth: "junk" })], now)).toEqual([]);
  });
  it("does NOT flag a category with no defined age bound (avoid false positives)", () => {
    expect(
      detectAgeForCategory([animal({ category: "Ox", dateOfBirth: "2020-01-01" })], now),
    ).toEqual([]);
  });
  it("does NOT flag a borderline age within the conservative band", () => {
    // a Calf just over 1y — inside the conservative ceiling (2y) → no flag
    expect(
      detectAgeForCategory([animal({ category: "Calf", dateOfBirth: "2025-04-01" })], now),
    ).toEqual([]);
  });
});

describe("detectNoWeightOnRecord", () => {
  it("flags an animal NOT in the weighed set when SOME animals are weighed", () => {
    const animals = [animal({ animalId: "A1" }), animal({ animalId: "A2" })];
    const weighed = new Set(["A2"]);
    const out = detectNoWeightOnRecord(animals, weighed);
    expect(out).toEqual([{ animalId: "A1", reasonId: "no-weight-on-record", species: "cattle" }]);
  });

  it("SUPPRESSES the reason entirely when ZERO animals have any weighing (day-1 import)", () => {
    const animals = [animal({ animalId: "A1" }), animal({ animalId: "A2" })];
    const weighed = new Set<string>();
    expect(detectNoWeightOnRecord(animals, weighed)).toEqual([]);
  });

  it("does NOT flag an animal that IS in the weighed set", () => {
    const animals = [animal({ animalId: "A1" })];
    expect(detectNoWeightOnRecord(animals, new Set(["A1"]))).toEqual([]);
  });
});

describe("runSnapshotDetectors — composes all pure attribute detectors", () => {
  const now = new Date("2026-06-15T00:00:00.000Z");

  it("returns the union of every snapshot finding for the herd", () => {
    const animals = [
      animal({ animalId: "GOOD", currentCamp: "C1", tagNumber: "1", dateOfBirth: "2024-01-01", category: "Heifer" }),
      animal({ animalId: "BAD", currentCamp: "", tagNumber: null, brandSequence: null, dateOfBirth: null, category: "Cow" }),
    ];
    const weighed = new Set(["GOOD"]);
    const findings = runSnapshotDetectors(animals, weighed, now);
    const badReasons = findings.filter((f) => f.animalId === "BAD").map((f) => f.reasonId).sort();
    expect(badReasons).toEqual(["missing-dob", "missing-id", "no-camp", "no-weight-on-record"]);
    // GOOD animal: fully populated + weighed → no findings
    expect(findings.filter((f) => f.animalId === "GOOD")).toEqual([]);
  });

  it("is deterministic", () => {
    const animals = [animal({ animalId: "X", currentCamp: "" })];
    const weighed = new Set(["X"]);
    expect(runSnapshotDetectors(animals, weighed, now)).toEqual(
      runSnapshotDetectors(animals, weighed, now),
    );
  });
});
