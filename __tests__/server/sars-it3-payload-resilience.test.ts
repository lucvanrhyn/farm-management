/**
 * __tests__/server/sars-it3-payload-resilience.test.ts
 *
 * Regression test for production-triage P1.4 (2026-05-03):
 *
 *   "Issue snapshot for 2026" on /tools/tax produced an empty-body response
 *   from /api/[farmSlug]/tax/it3/preview. Client.json() threw on empty body
 *   → setPreview(null) → button stayed disabled.
 *
 *   Read-only investigation (this session, 2026-05-10) traced the throw to
 *   `lookupStandardValue` inside `valueStockBlock` (lib/calculators/sars-stock.ts)
 *   called from `getIt3Payload` (lib/server/sars-it3.ts:319-321). Throws
 *   `UnknownLivestockClassError` for any animal whose (species, ageCategory)
 *   isn't in the gazetted STANDARD_VALUES table — caught for inventory-replay
 *   via `addToAcc` in inventory-replay.ts:198-209 (unmapped bucket), but
 *   leaked through `valueStockBlock` to the route handler.
 *
 *   Wave G8 (PR #172) wrapped tax/it3 routes in `tenantReadSlug` adapter, so
 *   the literal "empty body" symptom is now masked — the adapter emits
 *   `{error: "DB_QUERY_FAILED", message}` JSON. But the underlying brittleness
 *   remained, surfacing as a DB_QUERY_FAILED toast for the user with the
 *   button still disabled (preview=null).
 *
 *   This file pins the structural fix:
 *
 *   Test A (basson-shaped):
 *     `getIt3Payload(stub, 2026, 'luc@...')` with cattle-only fixture →
 *     succeeds, returns valid IT3Payload with all 3 stock blocks populated.
 *     Locks the happy-path regression.
 *
 *   Test B (foreign-species fixture):
 *     Animal with species='pigs', category='Boar' (non-gazetted combo) →
 *     payload returns successfully, NO throw. Inventory-replay's `unmapped`
 *     bucket catches the mapping miss; `valueStockBlock` resilience handles
 *     any class that *did* map (e.g. via `mapFarmTrackCategoryToSarsClass`
 *     fallthrough) but isn't gazetted in STANDARD_VALUES.
 *
 *   Test B was the RED that drove the fix. Pre-fix, both inventory-replay
 *   AND valueStockBlock had to swallow the unmapped class — the prior
 *   inventory-replay catch was sufficient when species was 'pigs' (its
 *   default branch passes through to lookupStandardValue), but
 *   valueStockBlock had no resilience. Post-fix, valueStockBlock buckets
 *   the misses into `unmappedLines`.
 */

import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getIt3Payload } from "@/lib/server/sars-it3";

// ── Stub builder ──────────────────────────────────────────────────────────────

interface StubAnimal {
  id: string;
  animalId: string;
  species: string;
  category: string;
  status: string;
  dateAdded: string;
  dateOfBirth: string | null;
  deceasedAt: string | null;
}

function buildStubPrisma(animals: StubAnimal[]): PrismaClient {
  return {
    transaction: {
      findMany: vi.fn(async () => []),
    },
    farmSettings: {
      findFirst: vi.fn(async () => ({
        farmName: "Basson Boerdery",
        ownerName: "Test Owner",
        ownerIdNumber: "7001015009088",
        taxReferenceNumber: "1234567890",
        physicalAddress: "1 Farm Rd",
        postalAddress: "",
        contactPhone: "0821234567",
        contactEmail: "owner@farm.co.za",
        propertyRegNumber: "SG21-123",
        farmRegion: "Free State",
      })),
    },
    animal: {
      // groupBy used by buildInventorySnapshot
      groupBy: vi.fn(async () => {
        const counts = new Map<string, number>();
        for (const a of animals) {
          if (a.status !== "Active") continue;
          counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
        }
        return [...counts.entries()].map(([category, count]) => ({
          category,
          _count: { id: count },
        }));
      }),
      // findMany used by inventory-replay's full-tenant scan
      findMany: vi.fn(async () => animals),
    },
    observation: {
      findMany: vi.fn(async () => []),
    },
    sarsLivestockElection: {
      findMany: vi.fn(async () => []),
    },
  } as unknown as PrismaClient;
}

const TAX_YEAR = 2026;

// ── Test A — basson-shaped happy path ─────────────────────────────────────────

describe("getIt3Payload — basson-shaped cattle fixture (P1.4 Test A)", () => {
  it("returns a valid payload with stockMovement populated and no throw", async () => {
    const animals: StubAnimal[] = [
      {
        id: "a1",
        animalId: "BAR-BULL-1",
        species: "cattle",
        category: "Bull",
        status: "Active",
        dateAdded: "2024-01-01",
        dateOfBirth: "2022-05-01",
        deceasedAt: null,
      },
      {
        id: "a2",
        animalId: "BAR-COW-1",
        species: "cattle",
        category: "Cow",
        status: "Active",
        dateAdded: "2024-01-01",
        dateOfBirth: "2020-05-01",
        deceasedAt: null,
      },
      {
        id: "a3",
        animalId: "BAR-COW-2",
        species: "cattle",
        category: "Cow",
        status: "Active",
        dateAdded: "2024-01-01",
        dateOfBirth: "2020-06-01",
        deceasedAt: null,
      },
    ];
    const prisma = buildStubPrisma(animals);

    const payload = await getIt3Payload(prisma, TAX_YEAR, "luc@farmtrack.app");

    expect(payload.taxYear).toBe(TAX_YEAR);
    expect(payload.farm.farmName).toBe("Basson Boerdery");

    // All three stock blocks present.
    expect(payload.stockMovement).toBeDefined();
    expect(payload.stockMovement!.opening).toBeDefined();
    expect(payload.stockMovement!.closing).toBeDefined();

    // Mapped cattle should value: 1 Bull * R50 + 2 Cows * R40 = R130.
    expect(payload.stockMovement!.opening.totalZar).toBe(130);
    expect(payload.stockMovement!.closing.totalZar).toBe(130);
    expect(payload.stockMovement!.deltaZar).toBe(0);

    // No unmapped animals on this fixture.
    expect(payload.stockMovement!.unmapped).toEqual([]);

    // Inventory snapshot reflects active herd.
    expect(payload.inventory.activeAtPeriodEnd).toBe(3);
  });
});

// ── Test B — foreign-species fixture (the structural guarantee) ───────────────

describe("getIt3Payload — foreign-species fixture survives without throw (P1.4 Test B)", () => {
  it("does not throw on a (species, category) combo not in gazetted STANDARD_VALUES", async () => {
    // pigs/Boar is NOT in STANDARD_VALUES (gazetted: 'Over 6 months', 'Under 6 months').
    // mapFarmTrackCategoryToSarsClass falls through to the default branch
    // for non-cattle/sheep/goats species, returning {species: 'pigs',
    // ageCategory: 'Boar'} verbatim. lookupStandardValue then throws because
    // KNOWN_SPECIES contains 'pigs' but no STANDARD_VALUES row matches 'Boar'.
    //
    // RED on `main`: getIt3Payload throws → IT3 preview returns 500
    //                (or {error: "DB_QUERY_FAILED"} after Wave G8).
    // GREEN: payload returns; the unmapped class buckets at zero rand.
    const animals: StubAnimal[] = [
      {
        id: "p1",
        animalId: "BAR-BOAR-1",
        species: "pigs",
        category: "Boar",
        status: "Active",
        dateAdded: "2024-01-01",
        dateOfBirth: "2022-05-01",
        deceasedAt: null,
      },
      // One mapped Bull to prove the calculator continues processing other rows.
      {
        id: "b1",
        animalId: "BAR-BULL-1",
        species: "cattle",
        category: "Bull",
        status: "Active",
        dateAdded: "2024-01-01",
        dateOfBirth: "2022-05-01",
        deceasedAt: null,
      },
    ];
    const prisma = buildStubPrisma(animals);

    const payload = await getIt3Payload(prisma, TAX_YEAR, "luc@farmtrack.app");

    // The payload exists (no throw bubbled up).
    expect(payload).toBeDefined();
    expect(payload.stockMovement).toBeDefined();

    // The mapped Bull contributes its R50 standard value to opening + closing.
    // The unmapped pigs/Boar contributes ZERO rand.
    expect(payload.stockMovement!.opening.totalZar).toBe(50);
    expect(payload.stockMovement!.closing.totalZar).toBe(50);
    expect(payload.stockMovement!.deltaZar).toBe(0);

    // Lines should contain only the mapped class. The unmapped class is
    // surfaced separately for the PDF "uncategorised — taxpayer to value"
    // footer and inventory-replay's unmapped bucket.
    const closingLines = payload.stockMovement!.closing.lines;
    const allMapped = closingLines.every((l) => l.standardValueZar > 0 || l.species === "game");
    expect(allMapped).toBe(true);
  });

  it("does not throw with an unknown species ('alpaca')", async () => {
    // alpaca is NOT in KNOWN_SPECIES. lookupStandardValue throws on the
    // species check before even consulting STANDARD_VALUES.
    const animals: StubAnimal[] = [
      {
        id: "x1",
        animalId: "BAR-ALPACA-1",
        species: "alpaca",
        category: "Adult",
        status: "Active",
        dateAdded: "2024-01-01",
        dateOfBirth: "2022-05-01",
        deceasedAt: null,
      },
    ];
    const prisma = buildStubPrisma(animals);
    await expect(getIt3Payload(prisma, TAX_YEAR, "luc@farmtrack.app")).resolves.toBeDefined();
  });
});
