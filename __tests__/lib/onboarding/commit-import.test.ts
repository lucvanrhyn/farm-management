import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  commitImport,
  type ImportRow,
  type CommitImportProgress,
} from "@/lib/onboarding/commit-import";

// -----------------------------------------------------------------------------
// Mock Prisma
//
// We hand-build a minimal PrismaClient-like surface. We don't use
// vitest-mock-extended (not installed). The mocks cover exactly what
// commitImport touches: prisma.animal.findMany, prisma.animal.create (inside
// the transaction callback), prisma.importJob.update, and prisma.$transaction.
// -----------------------------------------------------------------------------

type InsertedAnimal = Record<string, unknown>;

type MockCamp = { campId: string; campName: string; species: string };

type MockState = {
  existingAnimalIds: string[];
  insertedAnimals: InsertedAnimal[];
  /** Queue of errors: next create() call rejects with shift()'d error. */
  createErrorsByAnimalId: Map<string, Error>;
  importJobUpdateError: Error | null;
  importJobUpdateCalls: Array<{ where: unknown; data: unknown }>;
  transactionCalls: number;
  /** Camps already on the farm (S12 camp resolution). */
  existingCamps: MockCamp[];
  /** Camps the import created. */
  createdCamps: Array<Record<string, unknown>>;
  /** Queue of errors keyed by campId: next camp.create() for it rejects. */
  campCreateErrorsByCampId: Map<string, Error>;
};

function makeMockPrisma(state: MockState) {
  const animalCreate = vi.fn(async ({ data }: { data: InsertedAnimal }) => {
    const animalId = data.animalId as string;
    const queued = state.createErrorsByAnimalId.get(animalId);
    if (queued) {
      state.createErrorsByAnimalId.delete(animalId);
      throw queued;
    }
    state.insertedAnimals.push(data);
    return { ...data, id: `cuid-${animalId}` };
  });

  const animalFindMany = vi.fn(
    async ({ where }: { where: { animalId: { in: string[] } } }) => {
      const requested = where.animalId.in;
      return state.existingAnimalIds
        .filter((id) => requested.includes(id))
        .map((id) => ({ animalId: id }));
    },
  );

  const importJobUpdate = vi.fn(
    async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      state.importJobUpdateCalls.push(args);
      if (state.importJobUpdateError) {
        throw state.importJobUpdateError;
      }
      return { id: args.where.id, ...args.data };
    },
  );

  const $transaction = vi.fn(
    async (
      fn: (tx: unknown) => Promise<unknown>,
      _opts?: { maxWait?: number; timeout?: number },
    ) => {
      state.transactionCalls += 1;
      const tx = {
        animal: { create: animalCreate },
      };
      return fn(tx);
    },
  );

  const campFindMany = vi.fn(
    async ({ where }: { where?: { species?: { in: string[] } } } = {}) => {
      const speciesIn = where?.species?.in;
      return state.existingCamps.filter(
        (c) => speciesIn === undefined || speciesIn.includes(c.species),
      );
    },
  );

  const campCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const campId = data.campId as string;
    const queued = state.campCreateErrorsByCampId.get(campId);
    if (queued) {
      state.campCreateErrorsByCampId.delete(campId);
      throw queued;
    }
    state.createdCamps.push(data);
    return { ...data, id: `camp-cuid-${campId}` };
  });

  const prisma = {
    animal: {
      findMany: animalFindMany,
      create: animalCreate,
    },
    camp: {
      findMany: campFindMany,
      create: campCreate,
    },
    importJob: {
      update: importJobUpdate,
    },
    $transaction,
  } as unknown as PrismaClient;

  return {
    prisma,
    animalCreate,
    animalFindMany,
    campFindMany,
    campCreate,
    importJobUpdate,
    $transaction,
  };
}

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    existingAnimalIds: [],
    insertedAnimals: [],
    createErrorsByAnimalId: new Map(),
    importJobUpdateError: null,
    importJobUpdateCalls: [],
    transactionCalls: 0,
    existingCamps: [],
    createdCamps: [],
    campCreateErrorsByCampId: new Map(),
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

function mkRow(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    earTag: "A001",
    sex: "Female",
    breed: "Brangus",
    ...overrides,
  };
}

const DEFAULT_JOB_ID = "job-123";

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("commitImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Empty rows
  it("returns {inserted:0, skipped:0, errors:[]} for empty input and does not open a transaction", async () => {
    const state = makeState();
    const { prisma, $transaction, importJobUpdate } = makeMockPrisma(state);

    const res = await commitImport(prisma, { rows: [], importJobId: DEFAULT_JOB_ID, defaultSpecies: "cattle" });

    expect(res).toEqual({ inserted: 0, skipped: 0, errors: [] });
    expect($transaction).not.toHaveBeenCalled();
    expect(importJobUpdate).not.toHaveBeenCalled();
  });

  // 2. Missing earTag
  it("skips rows with missing earTag", async () => {
    const state = makeState();
    const { prisma } = makeMockPrisma(state);

    const res = await commitImport(
      prisma,
      { rows: [{ earTag: "  " } as ImportRow], importJobId: DEFAULT_JOB_ID, defaultSpecies: "cattle" },
    );

    expect(res.inserted).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.errors).toEqual([{ row: 1, reason: "missing earTag" }]);
  });

  // 3. Duplicate earTag within import
  it("inserts the first occurrence and skips duplicates within the same import", async () => {
    const state = makeState();
    const { prisma } = makeMockPrisma(state);

    const res = await commitImport(
      prisma,
      {
        rows: [mkRow({ earTag: "DUP-1" }), mkRow({ earTag: "DUP-1" })],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      },
    );

    expect(res.inserted).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.errors).toEqual([
      { row: 2, earTag: "DUP-1", reason: "duplicate earTag within import" },
    ]);
    expect(state.insertedAnimals).toHaveLength(1);
  });

  // 4. Invalid dateOfBirth
  it('skips rows with unparseable dateOfBirth and reports "invalid dateOfBirth"', async () => {
    const state = makeState();
    const { prisma } = makeMockPrisma(state);

    const res = await commitImport(
      prisma,
      {
        rows: [mkRow({ earTag: "BAD-DOB", dateOfBirth: "not a date" })],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      },
    );

    expect(res.inserted).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.errors[0]).toMatchObject({
      row: 1,
      earTag: "BAD-DOB",
      reason: "invalid dateOfBirth",
    });
  });

  // 5. Invalid sex
  it('skips rows with invalid sex and reports "invalid sex"', async () => {
    const state = makeState();
    const { prisma } = makeMockPrisma(state);

    const res = await commitImport(
      prisma,
      {
        rows: [{ earTag: "BAD-SEX", sex: "Bull" }],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      },
    );

    expect(res.inserted).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.errors[0]).toMatchObject({
      row: 1,
      earTag: "BAD-SEX",
      reason: "invalid sex",
    });
  });

  // 6. Pedigree — sire already exists in DB
  it("resolves a sire that already exists in the DB", async () => {
    const state = makeState({ existingAnimalIds: ["EXISTING-SIRE"] });
    const { prisma, animalFindMany } = makeMockPrisma(state);

    const res = await commitImport(
      prisma,
      {
        rows: [mkRow({ earTag: "CALF-1", fatherId: "EXISTING-SIRE" })],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      },
    );

    expect(res.inserted).toBe(1);
    expect(animalFindMany).toHaveBeenCalledWith({
      where: { animalId: { in: ["EXISTING-SIRE"] } },
      select: { animalId: true },
    });
    expect(state.insertedAnimals[0]).toMatchObject({
      animalId: "CALF-1",
      fatherId: "EXISTING-SIRE",
    });
  });

  // 6b. purchasePrice — parsed string → Float, lenient on absence, strict on garbage
  describe("purchasePrice (optional import column)", () => {
    it("parses a numeric purchasePrice string into a Float on the created animal", async () => {
      const state = makeState();
      const { prisma } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [mkRow({ earTag: "BUY-1", purchasePrice: "1500.50" })],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.inserted).toBe(1);
      expect(state.insertedAnimals[0]).toMatchObject({
        animalId: "BUY-1",
        purchasePrice: 1500.5,
      });
    });

    it("writes null purchasePrice when the column is absent (home-bred)", async () => {
      const state = makeState();
      const { prisma } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [mkRow({ earTag: "HOME-1" })],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.inserted).toBe(1);
      expect(state.insertedAnimals[0].purchasePrice).toBeNull();
    });

    it("writes null purchasePrice for a blank/whitespace cell (not 0, not error)", async () => {
      const state = makeState();
      const { prisma } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [mkRow({ earTag: "BLANK-1", purchasePrice: "   " })],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.inserted).toBe(1);
      expect(state.insertedAnimals[0].purchasePrice).toBeNull();
    });

    it('rejects a non-numeric purchasePrice with "invalid purchasePrice"', async () => {
      const state = makeState();
      const { prisma } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [mkRow({ earTag: "BAD-PRICE", purchasePrice: "R abc" })],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.inserted).toBe(0);
      expect(res.skipped).toBe(1);
      expect(res.errors[0]).toMatchObject({
        row: 1,
        earTag: "BAD-PRICE",
        reason: "invalid purchasePrice",
      });
    });

    it('rejects a negative purchasePrice with "invalid purchasePrice"', async () => {
      const state = makeState();
      const { prisma } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [mkRow({ earTag: "NEG-PRICE", purchasePrice: "-100" })],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.inserted).toBe(0);
      expect(res.errors[0]).toMatchObject({
        row: 1,
        earTag: "NEG-PRICE",
        reason: "invalid purchasePrice",
      });
    });
  });

  // 7. Pedigree — sire in same batch → topological sort
  it("inserts sires before children when both are in the same batch", async () => {
    const state = makeState();
    const { prisma } = makeMockPrisma(state);

    // Input deliberately has the child first.
    const res = await commitImport(
      prisma,
      {
        rows: [
          mkRow({ earTag: "CHILD", fatherId: "SIRE-A", sex: "Female" }),
          mkRow({ earTag: "SIRE-A", sex: "Male" }),
        ],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      },
    );

    expect(res.inserted).toBe(2);
    expect(res.skipped).toBe(0);
    expect(res.errors).toEqual([]);

    // SIRE-A must be inserted BEFORE CHILD.
    const order = state.insertedAnimals.map((a) => a.animalId);
    expect(order).toEqual(["SIRE-A", "CHILD"]);

    // CHILD's fatherId must resolve to SIRE-A's animalId.
    const childRow = state.insertedAnimals.find((a) => a.animalId === "CHILD")!;
    expect(childRow.fatherId).toBe("SIRE-A");
  });

  // 8. Pedigree cycle
  it('skips both rows in a pedigree cycle with reason "pedigree cycle"', async () => {
    const state = makeState();
    const { prisma } = makeMockPrisma(state);

    const res = await commitImport(
      prisma,
      {
        rows: [
          mkRow({ earTag: "A", fatherId: "B" }),
          mkRow({ earTag: "B", fatherId: "A" }),
        ],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      },
    );

    expect(res.inserted).toBe(0);
    expect(res.skipped).toBe(2);
    const reasons = res.errors.map((e) => e.reason);
    expect(reasons).toEqual(["pedigree cycle", "pedigree cycle"]);
    const tags = res.errors.map((e) => e.earTag);
    expect(tags.sort()).toEqual(["A", "B"]);
  });

  // 9. Insert failure on one row — continue with others
  it("captures a per-row insert failure and continues inserting subsequent rows", async () => {
    const state = makeState();
    state.createErrorsByAnimalId.set(
      "WILL-FAIL",
      new Error("UNIQUE constraint failed: Animal.animalId"),
    );
    const { prisma } = makeMockPrisma(state);

    const res = await commitImport(
      prisma,
      {
        rows: [
          mkRow({ earTag: "OK-1" }),
          mkRow({ earTag: "WILL-FAIL" }),
          mkRow({ earTag: "OK-2" }),
        ],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      },
    );

    expect(res.inserted).toBe(2);
    expect(res.skipped).toBe(1);
    expect(res.errors).toHaveLength(1);
    // S17 (OB-005/api-F2): the reason is the TYPED duplicate message — the
    // raw driver text ("UNIQUE constraint failed: Animal.animalId") carries
    // internal schema names and must never surface.
    expect(res.errors[0]).toMatchObject({
      earTag: "WILL-FAIL",
      reason: "earTag already exists",
    });

    const inserted = state.insertedAnimals.map((a) => a.animalId);
    expect(inserted).toEqual(["OK-1", "OK-2"]);
  });

  // 10. Progress callback fires with all 4 phases
  it("emits progress events covering validating, pedigree, inserting, and done phases", async () => {
    const state = makeState();
    const { prisma } = makeMockPrisma(state);

    const events: CommitImportProgress[] = [];
    const onProgress = vi.fn((p: CommitImportProgress) => {
      events.push(p);
    });

    await commitImport(
      prisma,
      {
        rows: [
          mkRow({ earTag: "P-1", fatherId: "P-SIRE", sex: "Female" }),
          mkRow({ earTag: "P-SIRE", sex: "Male" }),
        ],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      },
      onProgress,
    );

    const phases = new Set(events.map((e) => e.phase));
    expect(phases.has("validating")).toBe(true);
    expect(phases.has("pedigree")).toBe(true);
    expect(phases.has("inserting")).toBe(true);
    expect(phases.has("done")).toBe(true);

    // The final event is always "done" with processed === total.
    const last = events[events.length - 1];
    expect(last.phase).toBe("done");
    expect(last.processed).toBe(2);
    expect(last.total).toBe(2);
  });

  // 11. ImportJob updated on success
  it("updates the ImportJob row with final counts on success", async () => {
    const state = makeState();
    const { prisma, importJobUpdate } = makeMockPrisma(state);

    await commitImport(
      prisma,
      {
        rows: [mkRow({ earTag: "IJ-1" }), mkRow({ earTag: "IJ-2" })],
        importJobId: "job-abc",
        defaultSpecies: "cattle",
      },
    );

    expect(importJobUpdate).toHaveBeenCalledTimes(1);
    const call = state.importJobUpdateCalls[0];
    expect(call.where).toEqual({ id: "job-abc" });
    expect(call.data).toMatchObject({
      rowsImported: 2,
      rowsFailed: 0,
      status: "complete",
    });
    // completedAt should be a Date instance
    expect((call.data as { completedAt: unknown }).completedAt).toBeInstanceOf(Date);
  });

  // 12. ImportJob update failure is swallowed
  it("swallows ImportJob.update failure and still returns success result", async () => {
    const state = makeState({
      importJobUpdateError: new Error("turso transient failure"),
    });
    const { prisma, importJobUpdate } = makeMockPrisma(state);

    // Silence the console.error that the library emits.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await commitImport(
      prisma,
      {
        rows: [mkRow({ earTag: "IJ-FAIL" })],
        importJobId: "job-fail",
        defaultSpecies: "cattle",
      },
    );

    expect(res).toEqual({ inserted: 1, skipped: 0, errors: [] });
    expect(importJobUpdate).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });

  // 13. Species — row override beats defaultSpecies
  it("inserts a row with valid species overriding defaultSpecies", async () => {
    const state = makeState();
    const { prisma } = makeMockPrisma(state);

    const res = await commitImport(prisma, {
      rows: [mkRow({ earTag: "SHEEP-1", species: "sheep" })],
      importJobId: DEFAULT_JOB_ID,
      defaultSpecies: "cattle",
    });

    expect(res.inserted).toBe(1);
    expect(res.skipped).toBe(0);
    expect(state.insertedAnimals[0]).toMatchObject({
      animalId: "SHEEP-1",
      species: "sheep",
    });
  });

  // 14. Species — invalid per-row species is skipped
  it('skips rows with species outside the allowlist with reason "invalid species"', async () => {
    const state = makeState();
    const { prisma } = makeMockPrisma(state);

    const res = await commitImport(prisma, {
      rows: [mkRow({ earTag: "BAD-SPEC", species: "pig" })],
      importJobId: DEFAULT_JOB_ID,
      defaultSpecies: "cattle",
    });

    expect(res.inserted).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.errors[0]).toMatchObject({
      row: 1,
      earTag: "BAD-SPEC",
      reason: "invalid species",
    });
    expect(state.insertedAnimals).toHaveLength(0);
  });

  // 15. Missing / invalid defaultSpecies throws (caller contract)
  it("throws when defaultSpecies is missing or outside the allowlist", async () => {
    const state = makeState();
    const { prisma } = makeMockPrisma(state);

    // Missing
    await expect(
      commitImport(prisma, {
        rows: [mkRow({ earTag: "X" })],
        importJobId: DEFAULT_JOB_ID,
      } as unknown as Parameters<typeof commitImport>[1]),
    ).rejects.toThrow("invalid defaultSpecies");

    // Invalid
    await expect(
      commitImport(prisma, {
        rows: [mkRow({ earTag: "X" })],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "pig",
      }),
    ).rejects.toThrow("invalid defaultSpecies");
  });

  // 16. Species — row with no species falls back to defaultSpecies
  it("falls back to defaultSpecies when row has no species", async () => {
    const state = makeState();
    const { prisma } = makeMockPrisma(state);

    const res = await commitImport(prisma, {
      rows: [mkRow({ earTag: "FALLBACK-1" })],
      importJobId: DEFAULT_JOB_ID,
      defaultSpecies: "goats",
    });

    expect(res.inserted).toBe(1);
    expect(state.insertedAnimals[0]).toMatchObject({
      animalId: "FALLBACK-1",
      species: "goats",
    });
  });

  // ---------------------------------------------------------------------------
  // S11 (H1/OB-001) — canonical schema-name vocabulary.
  // The wizard/AI emits schema names (dateOfBirth, currentCamp, motherId,
  // fatherId, category, status, registrationNumber, deceasedAt). The commit
  // consumer must read THOSE names — every captured field persists.
  // ---------------------------------------------------------------------------
  describe("canonical vocabulary (S11 / H1 / OB-001)", () => {
    it("persists every schema-named field the wizard captures", async () => {
      const state = makeState();
      const { prisma } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [
          {
            earTag: "BB-C001",
            sex: "Female",
            breed: "Bonsmara",
            category: "Cow",
            dateOfBirth: "2019-03-14",
            currentCamp: "weiveld-1",
            status: "Active",
            registrationNumber: "BSB-2019-04412",
            motherId: "BB-C000",
            fatherId: "BB-B001",
          },
        ],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.errors).toEqual([]);
      expect(res.inserted).toBe(1);
      expect(state.insertedAnimals[0]).toMatchObject({
        animalId: "BB-C001",
        sex: "Female",
        breed: "Bonsmara",
        category: "Cow",
        dateOfBirth: "2019-03-14",
        currentCamp: "weiveld-1",
        status: "Active",
        registrationNumber: "BSB-2019-04412",
        // Parents not in batch or DB → notes fallback, never silent loss.
        sireNote: "Unresolved sire: BB-B001",
        damNote: "Unresolved dam: BB-C000",
      });
    });

    it("persists deceasedAt for a Deceased row (Afrikaans status normalized)", async () => {
      const state = makeState();
      const { prisma } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [
          {
            earTag: "BB-C002",
            sex: "Female",
            category: "Cow",
            status: "Gevrek",
            deceasedAt: "2024-06-01",
          },
        ],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.errors).toEqual([]);
      expect(state.insertedAnimals[0]).toMatchObject({
        animalId: "BB-C002",
        status: "Deceased",
        deceasedAt: "2024-06-01",
      });
    });

    it("resolves in-batch pedigree through motherId/fatherId ear-tag refs", async () => {
      const state = makeState();
      const { prisma } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [
          { earTag: "CALF-9", sex: "Female", fatherId: "SIRE-9" },
          { earTag: "SIRE-9", sex: "Male" },
        ],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.inserted).toBe(2);
      const order = state.insertedAnimals.map((a) => a.animalId);
      expect(order).toEqual(["SIRE-9", "CALF-9"]);
      const calf = state.insertedAnimals.find((a) => a.animalId === "CALF-9")!;
      expect(calf.fatherId).toBe("SIRE-9");
      expect(calf.sireNote).toBeNull();
    });

    it('rejects an unparseable deceasedAt with "invalid deceasedAt"', async () => {
      const state = makeState();
      const { prisma } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [{ earTag: "BAD-DA", deceasedAt: "not a date" }],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.inserted).toBe(0);
      expect(res.errors[0]).toMatchObject({
        row: 1,
        earTag: "BAD-DA",
        reason: "invalid deceasedAt",
      });
    });

    it('rejects an unrecognized status with "invalid status"', async () => {
      const state = makeState();
      const { prisma } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [{ earTag: "BAD-ST", status: "vermis" }],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.inserted).toBe(0);
      expect(res.errors[0]).toMatchObject({
        row: 1,
        earTag: "BAD-ST",
        reason: "invalid status",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // S12 (H2/OB-006) — referenced camps that don't exist yet are created as
  // species-scoped placeholders; existing camps are reused, never duplicated.
  // ---------------------------------------------------------------------------
  describe("camp resolution (S12 / H2 / OB-006)", () => {
    it("creates a species-scoped placeholder camp for an unknown reference and assigns its slug", async () => {
      const state = makeState();
      const { prisma, campCreate } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [{ earTag: "C-1", currentCamp: "Nuwe Kamp" }],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.errors).toEqual([]);
      expect(res.inserted).toBe(1);
      expect(campCreate).toHaveBeenCalledTimes(1);
      expect(state.createdCamps[0]).toMatchObject({
        campId: "nuwe-kamp",
        campName: "Nuwe Kamp",
        species: "cattle",
      });
      expect(state.insertedAnimals[0]).toMatchObject({
        animalId: "C-1",
        currentCamp: "nuwe-kamp",
      });
    });

    it("reuses an existing camp referenced by campId — no duplicate created", async () => {
      const state = makeState({
        existingCamps: [
          { campId: "weiveld-1", campName: "Weiveld 1", species: "cattle" },
        ],
      });
      const { prisma, campCreate } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [{ earTag: "C-2", currentCamp: "weiveld-1" }],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.errors).toEqual([]);
      expect(campCreate).not.toHaveBeenCalled();
      expect(state.insertedAnimals[0]).toMatchObject({
        currentCamp: "weiveld-1",
      });
    });

    it("reuses an existing camp matched by display name (trimmed, case-insensitive)", async () => {
      const state = makeState({
        existingCamps: [
          { campId: "bergkamp", campName: "Bergkamp", species: "cattle" },
        ],
      });
      const { prisma, campCreate } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [{ earTag: "C-3", currentCamp: " bergKAMP " }],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.errors).toEqual([]);
      expect(campCreate).not.toHaveBeenCalled();
      expect(state.insertedAnimals[0]).toMatchObject({
        currentCamp: "bergkamp",
      });
    });

    it("creates a sheep camp even when a cattle camp shares the same campId (composite key)", async () => {
      const state = makeState({
        existingCamps: [
          { campId: "north-01", campName: "North 01", species: "cattle" },
        ],
      });
      const { prisma, campCreate } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [{ earTag: "S-1", currentCamp: "north-01", species: "sheep" }],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.errors).toEqual([]);
      expect(campCreate).toHaveBeenCalledTimes(1);
      expect(state.createdCamps[0]).toMatchObject({
        campId: "north-01",
        species: "sheep",
      });
      expect(state.insertedAnimals[0]).toMatchObject({
        animalId: "S-1",
        species: "sheep",
        currentCamp: "north-01",
      });
    });

    it('keeps the "unassigned" sentinel for rows without a camp — nothing created', async () => {
      const state = makeState();
      const { prisma, campCreate, campFindMany } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [{ earTag: "C-4" }],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.inserted).toBe(1);
      expect(campCreate).not.toHaveBeenCalled();
      expect(campFindMany).not.toHaveBeenCalled();
      expect(state.insertedAnimals[0]).toMatchObject({
        currentCamp: "unassigned",
      });
    });

    it("treats a unique-constraint race on placeholder creation as the camp existing", async () => {
      const state = makeState();
      state.campCreateErrorsByCampId.set(
        "race-kamp",
        new Error("UNIQUE constraint failed: Camp.species, Camp.campId"),
      );
      const { prisma } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [{ earTag: "C-5", currentCamp: "Race Kamp" }],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.errors).toEqual([]);
      expect(res.inserted).toBe(1);
      expect(state.insertedAnimals[0]).toMatchObject({
        currentCamp: "race-kamp",
      });
    });

    it("sanitizes a formula-payload camp reference before it becomes a placeholder camp", async () => {
      const state = makeState();
      const { prisma } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [{ earTag: "C-INJ", currentCamp: "=HYPERLINK(evil)" }],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.inserted).toBe(1);
      expect(state.createdCamps[0]).toMatchObject({
        campId: "'=hyperlink(evil)",
        campName: "'=HYPERLINK(evil)",
      });
    });

    it("drops only the affected rows with a typed reason when placeholder creation fails hard", async () => {
      const state = makeState();
      state.campCreateErrorsByCampId.set(
        "dood-kamp",
        new Error("SQLITE_IOERR: disk I/O error"),
      );
      const { prisma } = makeMockPrisma(state);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await commitImport(prisma, {
        rows: [
          { earTag: "OK-CAMP", currentCamp: "Goeie Kamp" },
          { earTag: "BAD-CAMP", currentCamp: "Dood Kamp" },
        ],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });
      consoleSpy.mockRestore();

      expect(res.inserted).toBe(1);
      expect(res.errors).toEqual([
        {
          row: 2,
          earTag: "BAD-CAMP",
          reason: "camp could not be created",
        },
      ]);
      // The raw driver text must never surface in a per-row reason.
      expect(JSON.stringify(res.errors)).not.toContain("SQLITE_IOERR");
      expect(state.insertedAnimals.map((a) => a.animalId)).toEqual(["OK-CAMP"]);
    });
  });

  // ---------------------------------------------------------------------------
  // S17 (OB-005/api-F2) — per-row insert failures must surface TYPED,
  // user-safe reasons. The raw Prisma/driver message carries internal schema
  // text (table/column/invocation payload) and is streamed to the SSE client
  // AND persisted into ImportJob.warnings — it must never leave the server.
  // Same convention as mapApiDomainError's DB_QUERY_FAILED sanitization
  // (#483): typed message out, full error to the server log.
  // ---------------------------------------------------------------------------
  describe("insert-error sanitization (S17 / OB-005 / api-F2)", () => {
    const PRISMA_LEAK =
      "Invalid `prisma.animal.create()` invocation: column `secret_col` does not exist on table `Animal`";

    function makePrismaError(message: string): Error {
      const err = new Error(message);
      err.name = "PrismaClientKnownRequestError";
      return err;
    }

    it("never forwards raw Prisma text in a per-row reason — typed generic reason instead", async () => {
      const state = makeState();
      state.createErrorsByAnimalId.set("LEAK-1", makePrismaError(PRISMA_LEAK));
      const { prisma } = makeMockPrisma(state);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await commitImport(prisma, {
        rows: [mkRow({ earTag: "LEAK-1" }), mkRow({ earTag: "OK-AFTER" })],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });
      consoleSpy.mockRestore();

      expect(res.inserted).toBe(1);
      expect(res.skipped).toBe(1);
      expect(res.errors).toEqual([
        {
          row: 1,
          earTag: "LEAK-1",
          reason: "database error — row not inserted",
        },
      ]);
      // The raw message must not appear ANYWHERE in the client-bound result.
      const serialized = JSON.stringify(res.errors);
      expect(serialized).not.toContain("secret_col");
      expect(serialized).not.toContain("prisma.animal");
      expect(serialized).not.toContain(PRISMA_LEAK);
    });

    it("keeps the persisted ImportJob.warnings free of raw driver text too", async () => {
      const state = makeState();
      state.createErrorsByAnimalId.set("LEAK-2", makePrismaError(PRISMA_LEAK));
      const { prisma } = makeMockPrisma(state);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await commitImport(prisma, {
        rows: [mkRow({ earTag: "LEAK-2" })],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });
      consoleSpy.mockRestore();

      const call = state.importJobUpdateCalls[0];
      const warnings = (call.data as { warnings: string }).warnings;
      expect(warnings).toContain("database error — row not inserted");
      expect(warnings).not.toContain("secret_col");
      expect(warnings).not.toContain("prisma.animal");
    });

    it("logs the full insert error server-side so debugging detail is not lost", async () => {
      const { logger } = await import("@/lib/logger");
      const spy = vi.spyOn(logger, "error").mockImplementation(() => {});

      const state = makeState();
      state.createErrorsByAnimalId.set("LOGGED", makePrismaError(PRISMA_LEAK));
      const { prisma } = makeMockPrisma(state);

      try {
        await commitImport(prisma, {
          rows: [mkRow({ earTag: "LOGGED" })],
          importJobId: DEFAULT_JOB_ID,
          defaultSpecies: "cattle",
        });
        const insertLog = spy.mock.calls.find(([msg]) =>
          String(msg).includes("row insert failed"),
        );
        expect(insertLog).toBeDefined();
        const [, meta] = insertLog! as [string, { error?: unknown }];
        expect(meta.error).toBe(PRISMA_LEAK);
      } finally {
        spy.mockRestore();
      }
    });

    it("maps a typed P2002 unique violation to the duplicate reason", async () => {
      const state = makeState();
      const p2002 = Object.assign(new Error("\nUnique constraint failed on the fields: (`animalId`)"), {
        code: "P2002",
        name: "PrismaClientKnownRequestError",
      });
      state.createErrorsByAnimalId.set("DUP-DB", p2002);
      const { prisma } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [mkRow({ earTag: "DUP-DB" })],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.errors).toEqual([
        { row: 1, earTag: "DUP-DB", reason: "earTag already exists" },
      ]);
      expect(JSON.stringify(res.errors)).not.toContain("Unique constraint");
    });

    it("maps a non-Error throw to the typed generic reason", async () => {
      const state = makeState();
      // Drivers occasionally reject with plain objects/strings.
      state.createErrorsByAnimalId.set(
        "WEIRD",
        "SQLITE_CONSTRAINT: stringly-typed driver failure" as unknown as Error,
      );
      const { prisma } = makeMockPrisma(state);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await commitImport(prisma, {
        rows: [mkRow({ earTag: "WEIRD" })],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });
      consoleSpy.mockRestore();

      expect(res.errors).toEqual([
        { row: 1, earTag: "WEIRD", reason: "database error — row not inserted" },
      ]);
      expect(JSON.stringify(res.errors)).not.toContain("SQLITE_CONSTRAINT");
    });
  });

  // ---------------------------------------------------------------------------
  // S15 (M3) — formula-injection sanitization runs SERVER-SIDE in the commit
  // path. The client sanitizes parsed files, but a direct API POST bypasses
  // the client entirely — the boundary must neutralize `= + - @ \t \r`
  // prefixes itself before anything persists.
  // ---------------------------------------------------------------------------
  describe("server-side formula sanitization (S15 / M3)", () => {
    it("neutralizes formula-trigger prefixes on every persisted free-text field", async () => {
      const state = makeState();
      const { prisma } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [
          {
            earTag: "=cmd|' /C calc'!A0",
            registrationNumber: "+SUM(A1:A9)",
            breed: "@evil",
            category: "-2+3+cmd",
            sireNote: "=IMPORTXML(http://x)",
            // Whitespace-cloaked payload: trim strips the tab, then the
            // sanitizer must still catch the exposed "=".
            damNote: "\t=TAB-PAYLOAD",
          },
        ],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.errors).toEqual([]);
      expect(res.inserted).toBe(1);
      expect(state.insertedAnimals[0]).toMatchObject({
        animalId: "'=cmd|' /C calc'!A0",
        registrationNumber: "'+SUM(A1:A9)",
        breed: "'@evil",
        category: "'-2+3+cmd",
        sireNote: "'=IMPORTXML(http://x)",
        damNote: "'=TAB-PAYLOAD",
      });
    });

    it("leaves legitimate values untouched and is idempotent on pre-sanitized input", async () => {
      const state = makeState();
      const { prisma } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [
          {
            earTag: "BB-C001",
            breed: "Bonsmara",
            sireNote: "'=already-sanitized-client-side",
          },
        ],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.errors).toEqual([]);
      expect(state.insertedAnimals[0]).toMatchObject({
        animalId: "BB-C001",
        breed: "Bonsmara",
        // Already prefixed by the client — must NOT be double-prefixed.
        sireNote: "'=already-sanitized-client-side",
      });
    });

    it("keeps in-batch pedigree refs consistent when both sides carry a formula prefix", async () => {
      const state = makeState();
      const { prisma } = makeMockPrisma(state);

      const res = await commitImport(prisma, {
        rows: [
          { earTag: "=SIRE", sex: "Male" },
          { earTag: "CALF-X", sex: "Female", fatherId: "=SIRE" },
        ],
        importJobId: DEFAULT_JOB_ID,
        defaultSpecies: "cattle",
      });

      expect(res.errors).toEqual([]);
      expect(res.inserted).toBe(2);
      const calf = state.insertedAnimals.find((a) => a.animalId === "CALF-X")!;
      // Sanitized symmetrically on both sides — the ref still resolves.
      expect(calf.fatherId).toBe("'=SIRE");
      expect(calf.sireNote).toBeNull();
    });
  });
});
