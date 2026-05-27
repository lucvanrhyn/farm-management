// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Issue #450 — `getAnimalsByCampCached` must be case-insensitive on the
 * camp_id argument.
 *
 * Background
 * ──────────
 *   PR #421 made the camp **resolver** (`resolveCampByUrlSegment`)
 *   case-insensitive so deep links like `/trio-b-boerdery/logger/a` would
 *   land on Camp `A`. But the animal-count fetch
 *   (`getAnimalsByCampCached(decodedId)` in the Logger page) still passed
 *   the raw lowercase URL segment to a case-sensitive IDB index lookup.
 *   Symptom on Trio-B: `/logger/a` rendered the Camp A page but showed
 *   "0 animals", while `/logger/A` showed all 71.
 *
 *   Fix: `getAnimalsByCampCached` case-folds the campId argument and
 *   compares against `current_camp` case-insensitively. This is symmetric
 *   with the resolver — both ends of the URL→camp pipeline now ignore
 *   case. No IDB schema bump; the on-disk value of `current_camp` is left
 *   untouched (it stays as the server's canonical case).
 */

import "fake-indexeddb/auto";

beforeEach(() => {
  vi.resetModules();
});

async function loadStore() {
  const mod = await import("@/lib/offline-store");
  mod.setActiveFarmSlug(`test-${Math.random().toString(36).slice(2)}`);
  return mod;
}

describe("getAnimalsByCampCached case-insensitive lookup (issue #450)", () => {
  it("returns the same animals for uppercase and lowercase camp ids", async () => {
    const { seedAnimals, getAnimalsByCampCached } = await loadStore();

    await seedAnimals([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { animal_id: "a1", current_camp: "A", species: "cattle" } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { animal_id: "a2", current_camp: "A", species: "cattle" } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { animal_id: "b1", current_camp: "B", species: "cattle" } as any,
    ]);

    const upper = await getAnimalsByCampCached("A");
    const lower = await getAnimalsByCampCached("a");

    expect(upper).toHaveLength(2);
    expect(lower).toHaveLength(2);
    expect(lower.map((a) => a.animal_id).sort()).toEqual(["a1", "a2"]);
  });

  it("matches mixed-case input against mixed-case stored current_camp", async () => {
    const { seedAnimals, getAnimalsByCampCached } = await loadStore();

    await seedAnimals([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { animal_id: "x1", current_camp: "North-01", species: "cattle" } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { animal_id: "x2", current_camp: "North-01", species: "cattle" } as any,
    ]);

    const a = await getAnimalsByCampCached("north-01");
    const b = await getAnimalsByCampCached("NORTH-01");
    const c = await getAnimalsByCampCached("North-01");

    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(c).toHaveLength(2);
  });

  it("returns an empty array when no animal matches (any case)", async () => {
    const { seedAnimals, getAnimalsByCampCached } = await loadStore();

    await seedAnimals([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { animal_id: "z1", current_camp: "Z", species: "cattle" } as any,
    ]);

    const empty = await getAnimalsByCampCached("does-not-exist");
    expect(empty).toEqual([]);
  });

  it("only returns animals whose current_camp matches (no spurious matches across camps)", async () => {
    const { seedAnimals, getAnimalsByCampCached } = await loadStore();

    await seedAnimals([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { animal_id: "a1", current_camp: "A", species: "cattle" } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { animal_id: "a2", current_camp: "AA", species: "cattle" } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { animal_id: "a3", current_camp: "a", species: "cattle" } as any,
    ]);

    // Only "A" / "a" (same case-fold) — NOT "AA".
    const result = await getAnimalsByCampCached("a");
    expect(result.map((x) => x.animal_id).sort()).toEqual(["a1", "a3"]);
  });
});
