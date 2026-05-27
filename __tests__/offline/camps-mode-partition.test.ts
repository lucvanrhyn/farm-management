// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Issue #437 — IDB camps cache must partition by FarmMode.
 *
 * Background
 * ──────────
 *   Pre-fix the offline store keyed camp rows by `camp_id` only, so the
 *   sync-manager's `seedCamps` call after a mode flip overwrote the other
 *   mode's `animal_count` and `last_inspected_at` fields. Symptom on Trio:
 *   flipping cattle → sheep → cattle painted "0 animals · Just now" on the
 *   cattle return because the most-recent write was the sheep refresh.
 *
 *   The fix mode-partitions the cache: `seedCampsForMode(mode, camps)` /
 *   `getCachedCampsForMode(mode)` keep cattle and sheep rows on disjoint
 *   keys so one mode's refresh never overwrites the other.
 *
 *   Back-compat: `seedCamps(camps)` / `getCachedCamps()` continue to work
 *   for callers that pre-date the mode-partition (initial first paint
 *   before FarmMode is resolved). The legacy `camps` store is read as a
 *   fallback when the mode-partition has no rows for the current mode.
 */

import "fake-indexeddb/auto";

beforeEach(() => {
  vi.resetModules();
});

async function loadStore() {
  const mod = await import("@/lib/offline-store");
  // Unique DB name per test keeps each spec isolated without resetting the
  // IDB factory (which has no published type declarations).
  mod.setActiveFarmSlug(`test-${Math.random().toString(36).slice(2)}`);
  return mod;
}

describe("IDB camps mode partition (issue #437)", () => {
  it("cattle and sheep mode caches do not overwrite each other", async () => {
    const { seedCampsForMode, getCachedCampsForMode } = await loadStore();

    await seedCampsForMode("cattle", [
      {
        camp_id: "NORTH-01",
        camp_name: "North",
        animal_count: 42,
        last_inspected_at: "2026-05-26T11:00:00.000Z",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ]);
    await seedCampsForMode("sheep", [
      {
        camp_id: "NORTH-01",
        camp_name: "North",
        animal_count: 0,
        // No last_inspected_at — no sheep inspection has happened.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ]);

    const cattle = await getCachedCampsForMode("cattle");
    const sheep = await getCachedCampsForMode("sheep");

    expect(cattle).toHaveLength(1);
    expect(cattle[0].animal_count).toBe(42);
    expect(cattle[0].last_inspected_at).toBe("2026-05-26T11:00:00.000Z");

    expect(sheep).toHaveLength(1);
    expect(sheep[0].animal_count).toBe(0);
    expect(sheep[0].last_inspected_at).toBeUndefined();
  });

  it("a second seedCampsForMode call on the SAME mode overwrites (latest-wins within partition)", async () => {
    const { seedCampsForMode, getCachedCampsForMode } = await loadStore();

    await seedCampsForMode("cattle", [
      {
        camp_id: "NORTH-01",
        camp_name: "North",
        animal_count: 10,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ]);
    await seedCampsForMode("cattle", [
      {
        camp_id: "NORTH-01",
        camp_name: "North",
        animal_count: 42,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ]);

    const cattle = await getCachedCampsForMode("cattle");
    expect(cattle).toHaveLength(1);
    expect(cattle[0].animal_count).toBe(42);
  });

  it("orphan-sweep deletes a camp removed server-side from the SAME mode partition only", async () => {
    const { seedCampsForMode, getCachedCampsForMode } = await loadStore();

    await seedCampsForMode("cattle", [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { camp_id: "A", camp_name: "A" } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { camp_id: "B", camp_name: "B" } as any,
    ]);
    await seedCampsForMode("sheep", [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { camp_id: "A", camp_name: "A" } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { camp_id: "B", camp_name: "B" } as any,
    ]);

    // Server deletes B for cattle. Sheep partition is untouched.
    await seedCampsForMode("cattle", [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { camp_id: "A", camp_name: "A" } as any,
    ]);

    const cattle = await getCachedCampsForMode("cattle");
    const sheep = await getCachedCampsForMode("sheep");

    expect(cattle.map((c) => c.camp_id).sort()).toEqual(["A"]);
    expect(sheep.map((c) => c.camp_id).sort()).toEqual(["A", "B"]);
  });

  it("getCachedCampsForMode falls back to the legacy camps store when the mode partition is empty (back-compat)", async () => {
    const { seedCamps, getCachedCampsForMode } = await loadStore();

    // Legacy `seedCamps` (no mode) still works for first-paint callers.
    await seedCamps([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { camp_id: "LEGACY-01", camp_name: "Legacy" } as any,
    ]);

    // First call after migration: mode partition has no rows → fall back
    // to the legacy store so the picker is not blank during the seam.
    const cattle = await getCachedCampsForMode("cattle");
    expect(cattle.map((c) => c.camp_id)).toEqual(["LEGACY-01"]);
  });
});
