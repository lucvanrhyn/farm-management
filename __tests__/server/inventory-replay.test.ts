/**
 * __tests__/server/inventory-replay.test.ts
 *
 * Tests the closing/opening inventory reconstruction used by the SARS IT3
 * stock-movement calculation.
 *
 * Strategy: the replay module is tested through a tiny prisma-shaped stub
 * (typed `InventoryReplayPrisma` interface in inventory-replay.ts) so we
 * don't need to spin up a libsql in-memory DB just to validate the algorithm.
 *
 * Source: First Schedule paragraph 5(1) read with paragraph 2 + IT35 §3.4.
 */

import { describe, it, expect } from "vitest";
import {
  reconstructStockSnapshots,
  type InventoryReplayPrisma,
  type AnimalRow,
  type ObservationRow,
} from "@/lib/server/inventory-replay";

function makePrismaStub(animals: AnimalRow[], observations: ObservationRow[]): InventoryReplayPrisma {
  return {
    animal: {
      async findMany() {
        return animals;
      },
    },
    observation: {
      async findMany({ where }) {
        // Honour both `{ type: { in: [...] } }` and `{ type: "x" }`. (The prior
        // `a ?? b ? c : d` form mis-parsed the `{in}` object and silently
        // returned zero observations, masking the obs-driven exit path.)
        const types: string[] | undefined = Array.isArray(where?.type?.in)
          ? where.type.in
          : where?.type
            ? [where.type]
            : undefined;
        const animalIds: string[] | undefined = where?.animalId?.in;
        const start: string | undefined = where?.observedAt?.gte;
        const end: string | undefined = where?.observedAt?.lte;
        return observations.filter((o) => {
          if (types && !types.includes(o.type)) return false;
          if (animalIds && (!o.animalId || !animalIds.includes(o.animalId))) return false;
          const obsIso = typeof o.observedAt === "string" ? o.observedAt : o.observedAt.toISOString();
          if (start && obsIso < start) return false;
          if (end && obsIso > end) return false;
          return true;
        });
      },
    },
  };
}

const taxYear = 2026;
const yearStart = "2025-03-01";
const yearEnd = "2026-02-28";

describe("reconstructStockSnapshots — birth in tax year", () => {
  it("calf born during the tax year is in closing but NOT opening", async () => {
    const calf: AnimalRow = {
      id: "a1",
      animalId: "BAR-CALF-1",
      species: "cattle",
      category: "Calf",
      status: "Active",
      dateAdded: "2025-09-15",
      dateOfBirth: "2025-09-15",
      deceasedAt: null,
    };
    const prisma = makePrismaStub([calf], []);
    const result = await reconstructStockSnapshots(prisma, taxYear);
    // closing — present
    expect(result.closing.find((r) => r.ageCategory === "Calves")?.count).toBe(1);
    // opening — should NOT include this animal (added mid-year)
    expect(result.opening.find((r) => r.ageCategory === "Calves")?.count ?? 0).toBe(0);
  });
});

describe("reconstructStockSnapshots — death in tax year", () => {
  it("animal that died during the tax year is in opening but NOT closing", async () => {
    const cow: AnimalRow = {
      id: "a2",
      animalId: "BAR-COW-1",
      species: "cattle",
      category: "Cow",
      status: "Deceased",
      dateAdded: "2024-01-01",
      dateOfBirth: "2020-05-01",
      deceasedAt: "2025-08-10",
    };
    const prisma = makePrismaStub(
      [cow],
      [
        {
          id: "o1",
          type: "death",
          animalId: "BAR-COW-1", // Observation.animalId stores the TAG, not the cuid
          observedAt: "2025-08-10",
        },
      ],
    );
    const result = await reconstructStockSnapshots(prisma, taxYear);
    // closing — gone (deceased mid-year)
    expect(result.closing.find((r) => r.ageCategory === "Cows")?.count ?? 0).toBe(0);
    // opening — should INCLUDE this cow (was alive on 2025-03-01)
    expect(result.opening.find((r) => r.ageCategory === "Cows")?.count).toBe(1);
  });
});

describe("reconstructStockSnapshots — pre-existing animal alive throughout", () => {
  it("active cow added before yearStart and still alive is in BOTH opening and closing", async () => {
    const cow: AnimalRow = {
      id: "a3",
      animalId: "BAR-COW-2",
      species: "cattle",
      category: "Cow",
      status: "Active",
      dateAdded: "2023-01-01",
      dateOfBirth: "2020-01-01",
      deceasedAt: null,
    };
    const prisma = makePrismaStub([cow], []);
    const result = await reconstructStockSnapshots(prisma, taxYear);
    expect(result.opening.find((r) => r.ageCategory === "Cows")?.count).toBe(1);
    expect(result.closing.find((r) => r.ageCategory === "Cows")?.count).toBe(1);
  });
});

describe("reconstructStockSnapshots — sold animal", () => {
  it("animal sold during the tax year is in opening but NOT closing", async () => {
    const ox: AnimalRow = {
      id: "a4",
      animalId: "BAR-OX-1",
      species: "cattle",
      category: "Ox",
      status: "Sold",
      dateAdded: "2023-04-01",
      dateOfBirth: "2021-06-01",
      deceasedAt: null,
    };
    // Soldness is inferred from status="Sold" plus an explicit dispatch / sale
    // observation. We use animal_movement of type "sale" via observation type
    // when present.
    const prisma = makePrismaStub(
      [ox],
      [
        // Use an observation row even though the codebase may not currently
        // emit one for Sold; the replay falls back to status=Sold + dateAdded
        // anchoring when no obs is present (covered in the next test).
        {
          id: "o2",
          type: "animal_movement",
          animalId: "BAR-OX-1", // Observation.animalId stores the TAG, not the cuid
          observedAt: "2025-11-01",
          details: JSON.stringify({ direction: "sold" }),
        },
      ],
    );
    const result = await reconstructStockSnapshots(prisma, taxYear);
    expect(result.opening.find((r) => r.ageCategory === "Oxen")?.count).toBe(1);
    expect(result.closing.find((r) => r.ageCategory === "Oxen")?.count ?? 0).toBe(0);
  });
});

describe("reconstructStockSnapshots — purchase mid-year", () => {
  it("animal added mid-year is in closing but NOT opening", async () => {
    const heifer: AnimalRow = {
      id: "a5",
      animalId: "BAR-HFR-1",
      species: "cattle",
      category: "Heifer",
      status: "Active",
      dateAdded: "2025-10-15",
      dateOfBirth: "2024-04-01", // ~1.5y at year-end -> 1-2yr band
      deceasedAt: null,
    };
    const prisma = makePrismaStub([heifer], []);
    const result = await reconstructStockSnapshots(prisma, taxYear);
    expect(result.opening.find((r) => r.ageCategory === "Tollies & heifers 1-2 years")?.count ?? 0).toBe(0);
    expect(result.closing.find((r) => r.ageCategory === "Tollies & heifers 1-2 years")?.count).toBe(1);
  });
});

describe("reconstructStockSnapshots — exit via observation only (tag-joined)", () => {
  it("an ACTIVE animal dispatched mid-year via an animal_movement obs (no deceasedAt) drops from closing", async () => {
    // Production shape: Observation.animalId is the TAG, and the exit event is
    // the only signal (status never flipped, deceasedAt null). The replay must
    // join the obs on the tag — joining on the cuid silently keeps the animal
    // in closing stock and overstates the SARS closing inventory.
    const ox: AnimalRow = {
      id: "ckexitcuid000000000000001",
      animalId: "BAR-OX-MOVE",
      species: "cattle",
      category: "Ox",
      status: "Active",
      dateAdded: "2023-04-01",
      dateOfBirth: "2021-06-01",
      deceasedAt: null,
    };
    const prisma = makePrismaStub(
      [ox],
      [
        {
          id: "o3",
          type: "animal_movement",
          animalId: "BAR-OX-MOVE", // the TAG, not the cuid
          observedAt: "2025-11-01",
          details: JSON.stringify({ direction: "sold" }),
        },
      ],
    );
    const result = await reconstructStockSnapshots(prisma, taxYear);
    // alive on 1 March → in opening
    expect(result.opening.find((r) => r.ageCategory === "Oxen")?.count).toBe(1);
    // exited mid-year via the obs → NOT in closing
    expect(result.closing.find((r) => r.ageCategory === "Oxen")?.count ?? 0).toBe(0);
  });
});

describe("reconstructStockSnapshots — yearStart + yearEnd window", () => {
  it("returns yearStart and yearEnd ISO dates for the tax year window", async () => {
    const prisma = makePrismaStub([], []);
    const result = await reconstructStockSnapshots(prisma, taxYear);
    expect(result.yearStart).toBe(yearStart);
    expect(result.yearEnd).toBe(yearEnd);
  });
});
