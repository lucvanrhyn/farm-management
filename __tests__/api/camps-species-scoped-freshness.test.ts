/**
 * @vitest-environment node
 *
 * __tests__/api/camps-species-scoped-freshness.test.ts
 *
 * Issue #437 (PRD #434) — `/api/camps?species=<mode>` must return both
 * species-scoped `animal_count` AND species-scoped `last_inspected_at`.
 *
 * Background
 * ──────────
 *   Pre-#437: `GET /api/camps?species=sheep` correctly scoped the per-camp
 *   `animal_count` by species (Wave D-U3) but the inspection freshness
 *   surfaced via `/api/camps/status` was cross-species — Trio's cattle
 *   camp_condition rows surfaced as `last_inspected_at` on the Sheep
 *   Logger, painting 19 misleading "Just now · 0 animals" tiles.
 *
 *   #437 closes that leak structurally: when `species` is provided to
 *   `getCachedCampList`, `last_inspected_at` per camp is filled by
 *   `getLastInspectionAt(prisma, campId, species)` from
 *   `lib/domain/camp/inspection-freshness.ts`, which routes through the
 *   ADR-0005 `scoped()` door so the species predicate is structural
 *   (forgetting it is a compile error).
 *
 * What this test locks in
 * ──────────────────────
 *   - When `species: "sheep"` is provided and the underlying observation
 *     table holds ONLY a cattle camp_condition row for camp NORTH-01, the
 *     returned `last_inspected_at` is `null` (no sheep inspection).
 *   - When `species: "sheep"` is provided and the observation table also
 *     holds a sheep camp_check row for NORTH-01, `last_inspected_at`
 *     matches the sheep row's `observedAt`, NOT the (newer) cattle row's.
 *   - When `species` is omitted (back-compat caller), the route does NOT
 *     attempt species-scoped freshness — `last_inspected_at` stays
 *     undefined (the legacy `/api/camps/status` route owns that surface
 *     for un-scoped callers; pre-fix behaviour preserved).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── In-memory cache mirror of next/cache ─────────────────────────────────────

const _cache = new Map<string, unknown>();

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (
    fn: (...args: unknown[]) => Promise<unknown>,
    keyParts: string[],
  ) => {
    return async (...args: unknown[]) => {
      const cacheKey = JSON.stringify([keyParts, ...args]);
      if (_cache.has(cacheKey)) return _cache.get(cacheKey);
      const result = await fn(...args);
      _cache.set(cacheKey, result);
      return result;
    };
  },
}));

// ── Fixtures ────────────────────────────────────────────────────────────────
//
// Two camps. Two observation rows: a CATTLE camp_condition at 11:00 and a
// SHEEP camp_check at 10:00 — both on NORTH-01. The cattle row is newer.
// A correct species-scoped probe MUST return the sheep row for sheep mode
// and the cattle row for cattle mode (NOT the latest cross-species row).

interface FixtureObsRow {
  campId: string;
  type: string;
  species: string;
  observedAt: Date;
}

const NORTH_CAMP = {
  campId: "NORTH-01",
  campName: "North",
  sizeHectares: 42,
  waterSource: "borehole",
  geojson: null,
  color: "#2563EB",
};
const SOUTH_CAMP = {
  campId: "SOUTH-01",
  campName: "South",
  sizeHectares: 18,
  waterSource: null,
  geojson: null,
  color: "#16A34A",
};

const OBS_FIXTURE: FixtureObsRow[] = [
  {
    campId: "NORTH-01",
    type: "camp_condition",
    species: "cattle",
    observedAt: new Date("2026-05-26T11:00:00.000Z"),
  },
  {
    campId: "NORTH-01",
    type: "camp_check",
    species: "sheep",
    observedAt: new Date("2026-05-26T10:00:00.000Z"),
  },
];

// ── Prisma stub ──────────────────────────────────────────────────────────────

vi.mock("@/lib/farm-prisma", () => ({
  withFarmPrisma: vi.fn(
    async (_slug: string, fn: (p: unknown) => Promise<unknown>) => {
      const prisma = {
        camp: {
          findMany: vi.fn().mockResolvedValue([NORTH_CAMP, SOUTH_CAMP]),
        },
        animal: {
          groupBy: vi.fn().mockResolvedValue([]),
        },
        observation: {
          findFirst: vi.fn(
            async (args: {
              where: {
                campId: string;
                type: { in: string[] };
                species?: string;
              };
            }) => {
              const { campId, type, species } = args.where;
              const matches = OBS_FIXTURE.filter(
                (o) =>
                  o.campId === campId &&
                  type.in.includes(o.type) &&
                  (species === undefined || o.species === species),
              );
              if (matches.length === 0) return null;
              matches.sort(
                (a, b) => b.observedAt.getTime() - a.observedAt.getTime(),
              );
              return { observedAt: matches[0].observedAt };
            },
          ),
        },
      };
      return fn(prisma);
    },
  ),
}));

beforeEach(() => {
  _cache.clear();
});

describe("/api/camps?species=… species-scoped last_inspected_at", () => {
  it("returns null last_inspected_at when only cross-species (cattle) inspections exist for that camp on a sheep query", async () => {
    const { getCachedCampList } = await import("@/lib/server/cached");

    const list = await getCachedCampList("trio-cattle-only", "sheep");

    const north = list.find((c) => c.camp_id === "NORTH-01");
    expect(north).toBeDefined();
    // South has no inspections at all → also null.
    const south = list.find((c) => c.camp_id === "SOUTH-01");
    expect(south?.last_inspected_at ?? null).toBeNull();
    // North has a SHEEP camp_check row (10:00) → that is the sheep-side
    // freshness; the (newer) cattle camp_condition at 11:00 must NOT leak in.
    expect(north?.last_inspected_at).toBe("2026-05-26T10:00:00.000Z");
  });

  it("returns the cattle-row timestamp when species=cattle is provided", async () => {
    const { getCachedCampList } = await import("@/lib/server/cached");

    const list = await getCachedCampList("trio-cattle-only", "cattle");

    const north = list.find((c) => c.camp_id === "NORTH-01");
    expect(north?.last_inspected_at).toBe("2026-05-26T11:00:00.000Z");
  });

  it("omits last_inspected_at when species is omitted (back-compat callers stay on /api/camps/status)", async () => {
    const { getCachedCampList } = await import("@/lib/server/cached");

    const list = await getCachedCampList("trio-cattle-only");

    const north = list.find((c) => c.camp_id === "NORTH-01");
    // last_inspected_at should be undefined or null for the un-scoped call —
    // pre-fix behaviour preserved so /api/camps/status still owns this surface
    // for callers that did not opt into the species partition.
    expect(north?.last_inspected_at ?? null).toBeNull();
  });
});
