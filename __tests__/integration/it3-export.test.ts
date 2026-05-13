// @vitest-environment node
/**
 * __tests__/integration/it3-export.test.ts
 *
 * Regression test for issue #257 — SARS IT3 export preview returned
 * `DB_QUERY_FAILED` (rendered to the user as "Could not generate the IT3
 * preview right now") for any tenant that had at least one Animal row, even
 * after the P1.4 resilience fix (#183) shipped on 2026-05-10.
 *
 * Root cause (confirmed via repro against the live basson-boerdery clone on
 * 2026-05-13): `lib/server/inventory-replay.ts:reconstructStockSnapshots`
 * called
 *
 *     prisma.observation.findMany({
 *       where: { observedAt: { gte: start, lte: end } },
 *     })
 *
 * with `start` / `end` as ISO date strings (`"2025-03-01"`, `"2026-02-28"`)
 * returned by `getSaTaxYearRange()`. The `Observation.observedAt` column is
 * typed `DateTime` in `prisma/schema.prisma`, so the Prisma validator
 * rejects the string with:
 *
 *     Invalid value for argument `gte`: premature end of input.
 *     Expected ISO-8601 DateTime.
 *
 * The error propagated through `getIt3Payload` → `tenantReadSlug` adapter →
 * `{error: "DB_QUERY_FAILED"}`. The pre-existing
 * `__tests__/server/inventory-replay.test.ts` stub accepted strings, so the
 * type mismatch never showed up in unit tests; this regression test pins
 * the contract via a stub that asserts every `observedAt` bound is a real
 * `Date` instance, mirroring Prisma's behaviour.
 *
 * Companion symbol-table fix lives in `lib/server/inventory-replay.ts`:
 * the function now coerces `start` / `end` (which `getSaTaxYearRange()`
 * returns as YYYY-MM-DD strings — that contract is shared with the
 * Transaction.date string column and must not change) into Date objects
 * before passing them through to the Observation predicate.
 *
 * Note on Animal vs Observation date fields:
 *   - `Animal.dateAdded` / `dateOfBirth` / `deceasedAt` are `String` columns
 *     in the schema (verified 2026-05-13). Therefore string comparisons in
 *     the inventory-replay algorithm against `start` / `end` remain correct.
 *   - `Transaction.date` is also `String` (verified). The
 *     `prisma.transaction.findMany({where: {date: {gte: start, lte: end}}})`
 *     in `lib/server/sars-it3.ts` is OK as-is.
 *   - Only `Observation.observedAt` is `DateTime`. That is the surface that
 *     needs the conversion.
 */

import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getIt3Payload } from "@/lib/server/sars-it3";

// ── Strict-DateTime Prisma stub ──────────────────────────────────────────────
//
// Mimics Prisma's runtime validation: the `where.observedAt.gte` and `lte`
// values MUST be `Date` instances (or `Date.toISOString()`-formatted strings
// — but never plain `YYYY-MM-DD`). Throws with the same shape as
// `PrismaClientValidationError` so the regression is detected end-to-end.

class FakePrismaValidationError extends Error {
  name = "PrismaClientValidationError";
}

function isAcceptableDateTime(v: unknown): boolean {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  if (typeof v === "string") {
    // Real Prisma accepts only full ISO-8601 timestamps with time and zone.
    // Bare YYYY-MM-DD ("2025-03-01") trips the "premature end of input" branch.
    return /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
  }
  return false;
}

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

interface StubObservation {
  id: string;
  type: string;
  animalId: string | null;
  observedAt: Date | string;
  details: string;
}

function buildStubPrisma(opts: {
  animals: StubAnimal[];
  observations?: StubObservation[];
}): PrismaClient {
  const observations = opts.observations ?? [];
  return {
    transaction: {
      findMany: vi.fn(async () => []),
    },
    farmSettings: {
      findFirst: vi.fn(async () => ({
        farmName: "Acme Cattle",
        ownerName: "Owner",
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
      groupBy: vi.fn(async () => {
        const counts = new Map<string, number>();
        for (const a of opts.animals) {
          if (a.status !== "Active") continue;
          counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
        }
        return [...counts.entries()].map(([category, count]) => ({
          category,
          _count: { id: count },
        }));
      }),
      findMany: vi.fn(async () => opts.animals),
    },
    observation: {
      // Strict DateTime validator on `observedAt.gte` / `lte`. Mirrors what
      // Prisma's runtime engine does for a `DateTime` column.
      findMany: vi.fn(async (args: { where?: Record<string, unknown> }) => {
        const where = args?.where ?? {};
        const observedAt = where.observedAt as
          | { gte?: unknown; lte?: unknown }
          | undefined;
        if (observedAt) {
          if (
            "gte" in observedAt &&
            observedAt.gte !== undefined &&
            !isAcceptableDateTime(observedAt.gte)
          ) {
            throw new FakePrismaValidationError(
              `Invalid value for argument 'gte': premature end of input. ` +
                `Expected ISO-8601 DateTime. (got: ${String(observedAt.gte)})`,
            );
          }
          if (
            "lte" in observedAt &&
            observedAt.lte !== undefined &&
            !isAcceptableDateTime(observedAt.lte)
          ) {
            throw new FakePrismaValidationError(
              `Invalid value for argument 'lte': premature end of input. ` +
                `Expected ISO-8601 DateTime. (got: ${String(observedAt.lte)})`,
            );
          }
        }
        return observations;
      }),
    },
    sarsLivestockElection: {
      findMany: vi.fn(async () => []),
    },
  } as unknown as PrismaClient;
}

const TAX_YEAR = 2026;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getIt3Payload — full-export integration (issue #257 regression)", () => {
  it("does not throw PrismaClientValidationError when the tenant has Animal rows + Observation lookup", async () => {
    // Tenant with > 0 active animals — exactly the shape that triggers the
    // observation lookup branch in inventory-replay (animalIds.length > 0).
    // Pre-fix this throws because `observedAt: { gte: "2025-03-01" }` is
    // not a valid Prisma DateTime.
    const prisma = buildStubPrisma({
      animals: [
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
      ],
    });

    const payload = await getIt3Payload(prisma, TAX_YEAR, "luc@farmtrack.app");
    expect(payload).toBeDefined();
    expect(payload.taxYear).toBe(TAX_YEAR);
    expect(payload.stockMovement).toBeDefined();
    expect(payload.stockMovement!.opening.totalZar).toBe(50);
    expect(payload.stockMovement!.closing.totalZar).toBe(50);
  });

  it("filters in-window observation correctly post-fix", async () => {
    const prisma = buildStubPrisma({
      animals: [
        {
          id: "a1",
          animalId: "BAR-COW-1",
          species: "cattle",
          category: "Cow",
          status: "Deceased",
          dateAdded: "2024-01-01",
          dateOfBirth: "2020-01-01",
          deceasedAt: "2025-09-15",
        },
      ],
      observations: [
        {
          id: "o1",
          type: "death",
          animalId: "a1",
          observedAt: new Date("2025-09-15T10:00:00.000Z"),
          details: "{}",
        },
      ],
    });

    const payload = await getIt3Payload(prisma, TAX_YEAR, "luc@farmtrack.app");
    // Cow died mid-tax-year → in opening (alive 1 March), NOT in closing.
    expect(payload.stockMovement).toBeDefined();
    expect(payload.stockMovement!.opening.totalZar).toBe(40); // 1 Cow * R40
    expect(payload.stockMovement!.closing.totalZar).toBe(0);
  });

  it("handles empty-tenant case (no Animal rows) without throwing", async () => {
    // Path where animalIds.length === 0 → observation.findMany is never called.
    const prisma = buildStubPrisma({ animals: [] });
    const payload = await getIt3Payload(prisma, TAX_YEAR, "luc@farmtrack.app");
    expect(payload.inventory.activeAtPeriodEnd).toBe(0);
    expect(payload.stockMovement!.opening.totalZar).toBe(0);
    expect(payload.stockMovement!.closing.totalZar).toBe(0);
  });
});
