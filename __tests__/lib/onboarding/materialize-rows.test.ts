/**
 * S11 (H1/OB-001) — canonical-vocabulary materializer + golden round-trip.
 *
 * Pre-S11 the import page built rows with `row[target] = value` behind an
 * `as ImportRow` cast while `commitImport` read DIFFERENT field names — so
 * dateOfBirth, camp, pedigree, category, and status silently vanished on
 * every import. These tests pin the cure end-to-end:
 *
 *   1. `materializeRows` only ever emits canonical `IMPORT_ROW_FIELDS`
 *      (typed — no cast), applying AI mapping + user overrides.
 *   2. GOLDEN ROUND-TRIP: raw spreadsheet rows → materializeRows →
 *      commitImport → every mapped field survives onto the inserted
 *      animal rows.
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  effectiveMappingEntries,
  materializeRows,
} from "@/lib/onboarding/materialize-rows";
import { commitImport } from "@/lib/onboarding/commit-import";
import { IMPORT_ROW_FIELDS } from "@/lib/onboarding/client-types";
import type { ProposalResult, ColumnMapping } from "@/lib/onboarding/adaptive-import";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProposal(mapping: Array<Pick<ColumnMapping, "source" | "target">>): ProposalResult {
  return {
    proposal: {
      mapping: mapping.map((m) => ({ ...m, confidence: 0.95 })),
      unmapped: [],
      warnings: [],
      row_count: 0,
    },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0,
      costZar: 0,
    },
    model: "gpt-4o-mini",
    promptVersion: "test",
  };
}

/** The Afrikaans header → canonical field mapping the SYSTEM_PROMPT teaches. */
const AFRIKAANS_MAPPING = makeProposal([
  { source: "Oormerk", target: "earTag" },
  { source: "Registrasienommer", target: "registrationNumber" },
  { source: "Ras", target: "breed" },
  { source: "Geslag", target: "sex" },
  { source: "Kategorie", target: "category" },
  { source: "Geboortedatum", target: "dateOfBirth" },
  { source: "Ma", target: "motherId" },
  { source: "Pa", target: "fatherId" },
  { source: "Kamp", target: "currentCamp" },
  { source: "Status", target: "status" },
  { source: "Sterfdatum", target: "deceasedAt" },
]);

// ---------------------------------------------------------------------------
// Minimal commitImport prisma mock (same surface as commit-import.test.ts)
// ---------------------------------------------------------------------------

function makeMockPrisma() {
  const insertedAnimals: Array<Record<string, unknown>> = [];
  const createdCamps: Array<Record<string, unknown>> = [];
  const animalCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    insertedAnimals.push(data);
    return { ...data, id: `cuid-${String(data.animalId)}` };
  });
  const prisma = {
    animal: {
      create: animalCreate,
      findMany: vi.fn(async () => []),
    },
    camp: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdCamps.push(data);
        return { ...data, id: `camp-cuid-${String(data.campId)}` };
      }),
    },
    importJob: { update: vi.fn(async () => ({})) },
    farmSettings: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ animal: { create: animalCreate } }),
    ),
  } as unknown as PrismaClient;
  return { prisma, insertedAnimals, createdCamps };
}

// ---------------------------------------------------------------------------
// materializeRows — typed mapping application
// ---------------------------------------------------------------------------

describe("materializeRows", () => {
  it("emits only canonical IMPORT_ROW_FIELDS keys (no non-canonical leak-through)", () => {
    const proposal = makeProposal([
      { source: "Oormerk", target: "earTag" },
      { source: "Massa", target: "weightKg" }, // hallucinated/non-canonical
      { source: "Opmerkings", target: "notes" }, // removed dead UI target
      { source: "Prys", target: "__ignored__" },
    ]);
    const rows = materializeRows(
      [{ Oormerk: "A1", Massa: "480", Opmerkings: "mooi koei", Prys: "R12000" }],
      proposal,
      {},
      {},
    );
    expect(rows).toEqual([{ earTag: "A1" }]);
    for (const key of Object.keys(rows[0])) {
      expect(IMPORT_ROW_FIELDS).toContain(key);
    }
  });

  it("applies user mappingOverrides over the AI default and merges unmappedOverrides", () => {
    const proposal = makeProposal([
      { source: "Tag", target: "registrationNumber" }, // AI guessed wrong
    ]);
    const rows = materializeRows(
      [{ Tag: "BB-1", Kamp: "weiveld-1" }],
      proposal,
      { Tag: "earTag" }, // user corrected
      { Kamp: "currentCamp" }, // user rescued an unmapped column
    );
    expect(rows).toEqual([{ earTag: "BB-1", currentCamp: "weiveld-1" }]);
  });

  it("normalizes Date cells to ISO YYYY-MM-DD and skips blank cells", () => {
    const proposal = makeProposal([
      { source: "Oormerk", target: "earTag" },
      { source: "Geboortedatum", target: "dateOfBirth" },
      { source: "Geslag", target: "sex" },
    ]);
    const rows = materializeRows(
      [{ Oormerk: "A1", Geboortedatum: new Date("2019-03-14T00:00:00Z"), Geslag: "   " }],
      proposal,
      {},
      {},
    );
    expect(rows).toEqual([{ earTag: "A1", dateOfBirth: "2019-03-14" }]);
  });

  it('materializes a missing ear tag as "" so the server can reject just that row', () => {
    const proposal = makeProposal([
      { source: "Oormerk", target: "earTag" },
      { source: "Geslag", target: "sex" },
    ]);
    const rows = materializeRows([{ Geslag: "Female" }], proposal, {}, {});
    expect(rows).toEqual([{ earTag: "", sex: "Female" }]);
  });

  it("effectiveMappingEntries reports exactly the applied mapping (audit trail)", () => {
    const proposal = makeProposal([
      { source: "Oormerk", target: "earTag" },
      { source: "Massa", target: "weightKg" },
    ]);
    const entries = effectiveMappingEntries(proposal, {}, { Kamp: "currentCamp" });
    expect(entries).toEqual([
      { source: "Oormerk", target: "earTag" },
      { source: "Kamp", target: "currentCamp" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN round-trip — parsed file → materializeRows → commitImport → DB rows
// ---------------------------------------------------------------------------

describe("golden round-trip (S11 / H1 / OB-001)", () => {
  it("every mapped field survives from spreadsheet row to inserted animal", async () => {
    const rawRows: Record<string, unknown>[] = [
      {
        Oormerk: "BB-C000",
        Geslag: "Female",
        Kategorie: "Cow",
        Ras: "Bonsmara",
        Status: "Aktief",
        Kamp: "weiveld-1",
      },
      {
        Oormerk: "BB-C001",
        Registrasienommer: "BSB-2019-04412",
        Ras: "Bonsmara",
        Geslag: "Female",
        Kategorie: "Vers",
        Geboortedatum: "2019-03-14",
        Ma: "BB-C000", // in this batch → resolves to motherId
        Pa: "BB-B777", // NOT in batch/DB → damNote-style fallback
        Kamp: "weiveld-1",
        Status: "Aktief",
      },
      {
        Oormerk: "BB-C002",
        Geslag: "Female",
        Kategorie: "Koei",
        Status: "Gevrek",
        Sterfdatum: "2024-06-01",
      },
    ];

    const rows = materializeRows(rawRows, AFRIKAANS_MAPPING, {}, {});

    const { prisma, insertedAnimals, createdCamps } = makeMockPrisma();
    const res = await commitImport(prisma, {
      rows,
      importJobId: "job-golden",
      defaultSpecies: "cattle",
    });

    expect(res.errors).toEqual([]);
    expect(res.inserted).toBe(3);

    // S12: the referenced camp didn't exist — created ONCE (deduped across
    // the two rows that reference it), species-scoped.
    expect(createdCamps).toEqual([
      { campId: "weiveld-1", campName: "weiveld-1", species: "cattle" },
    ]);

    const byId = new Map(insertedAnimals.map((a) => [a.animalId, a]));

    // Dam inserted before the calf that references her.
    expect(insertedAnimals.map((a) => a.animalId).indexOf("BB-C000")).toBeLessThan(
      insertedAnimals.map((a) => a.animalId).indexOf("BB-C001"),
    );

    expect(byId.get("BB-C001")).toMatchObject({
      animalId: "BB-C001",
      registrationNumber: "BSB-2019-04412",
      breed: "Bonsmara",
      sex: "Female",
      category: "Vers",
      dateOfBirth: "2019-03-14",
      motherId: "BB-C000", // resolved in-batch pedigree
      fatherId: null,
      sireNote: "Unresolved sire: BB-B777", // never silently dropped
      currentCamp: "weiveld-1",
      status: "Active",
    });

    expect(byId.get("BB-C002")).toMatchObject({
      animalId: "BB-C002",
      status: "Deceased", // "Gevrek" normalized
      deceasedAt: "2024-06-01",
    });

    // The loss signature of the original bug: category hardcoded "Unknown",
    // camp hardcoded "unassigned", DOB null. None may reappear.
    expect(byId.get("BB-C001")).not.toMatchObject({ category: "Unknown" });
    expect(byId.get("BB-C001")).not.toMatchObject({ currentCamp: "unassigned" });
    expect(byId.get("BB-C001")!.dateOfBirth).not.toBeNull();
  });
});
