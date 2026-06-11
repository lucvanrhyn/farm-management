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

type MockState = {
  existingAnimalIds: string[];
  insertedAnimals: InsertedAnimal[];
  /** Queue of errors: next create() call rejects with shift()'d error. */
  createErrorsByAnimalId: Map<string, Error>;
  importJobUpdateError: Error | null;
  importJobUpdateCalls: Array<{ where: unknown; data: unknown }>;
  transactionCalls: number;
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

  const prisma = {
    animal: {
      findMany: animalFindMany,
      create: animalCreate,
    },
    importJob: {
      update: importJobUpdate,
    },
    $transaction,
  } as unknown as PrismaClient;

  return { prisma, animalCreate, animalFindMany, importJobUpdate, $transaction };
}

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    existingAnimalIds: [],
    insertedAnimals: [],
    createErrorsByAnimalId: new Map(),
    importJobUpdateError: null,
    importJobUpdateCalls: [],
    transactionCalls: 0,
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
    expect(res.errors[0]).toMatchObject({
      earTag: "WILL-FAIL",
      reason: expect.stringContaining("UNIQUE"),
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
});
