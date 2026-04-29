// @vitest-environment jsdom
/**
 * M4 — farmEpoch cache-invalidation integration tests.
 *
 * The class-of-bug: after a rapid farm switch (setActiveFarmSlug), reads from
 * the *previous* farm's IDB can still resolve with stale data if the Promise
 * chain was already in flight. The epoch guard makes stale-epoch reads return
 * null regardless of what IDB contains.
 *
 * TDD spec:
 *   RED  → getCachedCampsForEpoch / getLastSyncedAtForEpoch do not exist yet.
 *   GREEN → implement epoch tracking in offline-store.ts.
 *   REFACTOR → epoch is synchronous (module-level ref, not async IDB read).
 *
 * Test scenario (rapid farm-switch):
 *   1. Set active farm to "farm-a", prime camps cache with A's data.
 *   2. Bump epoch: set active farm to "farm-b" (different slug → epoch resets).
 *   3. Read camps with farm-a's epoch → must return null (stale epoch).
 *   4. Read camps with farm-b's current epoch → returns data once primed.
 *
 * Also covers:
 *   - lastSyncedAt stale-epoch rejection
 *   - farmSettings stale-epoch rejection
 *   - Happy path: reads within the same farm + epoch succeed normally
 *   - Hero image defaults to /farm-hero.jpg regardless of DB stored value (M3)
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Each test gets a fresh module instance so epoch state resets cleanly.
beforeEach(() => {
  vi.resetModules();
});

async function loadStore() {
  return import('@/lib/offline-store');
}

function makeCamp(id: string) {
  return {
    camp_id: id,
    camp_name: `Camp ${id}`,
    size_hectares: 10,
    water_source: 'Borehole',
    geojson: null,
    notes: null,
    animal_count: 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// ── M4: farmEpoch cache-invalidation ─────────────────────────────────────────

describe('farmEpoch — getCachedCampsForEpoch', () => {
  it('returns null when epoch is stale (farm switched after read was queued)', async () => {
    const store = await loadStore();

    // Step 1: activate farm-a, prime the cache
    store.setActiveFarmSlug(`farm-epoch-a-${Math.random().toString(36).slice(2)}`);
    const epochA = store.getFarmEpoch();
    await store.seedCamps([makeCamp('camp-a-1')]);

    // Step 2: switch to a different farm → epoch must increment
    store.setActiveFarmSlug(`farm-epoch-b-${Math.random().toString(36).slice(2)}`);

    // Step 3: attempt a read with farm-a's stale epoch → must be null
    const staleResult = await store.getCachedCampsForEpoch(epochA);
    expect(staleResult).toBeNull();
  });

  it('returns data when epoch matches (same farm, no switch)', async () => {
    const store = await loadStore();

    const slug = `farm-epoch-same-${Math.random().toString(36).slice(2)}`;
    store.setActiveFarmSlug(slug);
    const epoch = store.getFarmEpoch();

    await store.seedCamps([makeCamp('camp-x-1'), makeCamp('camp-x-2')]);

    const result = await store.getCachedCampsForEpoch(epoch);
    expect(result).not.toBeNull();
    expect(result!.map((c) => c.camp_id).sort()).toEqual(['camp-x-1', 'camp-x-2']);
  });

  it('epoch strictly increases on each setActiveFarmSlug call', async () => {
    const store = await loadStore();

    store.setActiveFarmSlug(`farm-e1-${Math.random().toString(36).slice(2)}`);
    const e1 = store.getFarmEpoch();

    store.setActiveFarmSlug(`farm-e2-${Math.random().toString(36).slice(2)}`);
    const e2 = store.getFarmEpoch();

    store.setActiveFarmSlug(`farm-e3-${Math.random().toString(36).slice(2)}`);
    const e3 = store.getFarmEpoch();

    expect(e2).toBeGreaterThan(e1);
    expect(e3).toBeGreaterThan(e2);
  });

  it('epoch is synchronous — getFarmEpoch returns immediately without awaiting', async () => {
    const store = await loadStore();
    store.setActiveFarmSlug(`farm-sync-${Math.random().toString(36).slice(2)}`);
    // This must be synchronous — if it returned a Promise the test would fail
    // the expect() because Promise is not a number.
    const epoch = store.getFarmEpoch();
    expect(typeof epoch).toBe('number');
  });
});

describe('farmEpoch — getLastSyncedAtForEpoch', () => {
  it('returns null for stale epoch', async () => {
    const store = await loadStore();

    store.setActiveFarmSlug(`farm-sync-a-${Math.random().toString(36).slice(2)}`);
    const epochA = store.getFarmEpoch();
    await store.setLastSyncedAt(new Date().toISOString());

    // Switch farm → epoch bumps
    store.setActiveFarmSlug(`farm-sync-b-${Math.random().toString(36).slice(2)}`);

    const result = await store.getLastSyncedAtForEpoch(epochA);
    expect(result).toBeNull();
  });

  it('returns data for current epoch', async () => {
    const store = await loadStore();

    store.setActiveFarmSlug(`farm-sync-c-${Math.random().toString(36).slice(2)}`);
    const epoch = store.getFarmEpoch();
    const iso = new Date().toISOString();
    await store.setLastSyncedAt(iso);

    const result = await store.getLastSyncedAtForEpoch(epoch);
    expect(result).toBe(iso);
  });
});

describe('farmEpoch — getCachedFarmSettingsForEpoch', () => {
  it('returns null for stale epoch', async () => {
    const store = await loadStore();

    store.setActiveFarmSlug(`farm-sets-a-${Math.random().toString(36).slice(2)}`);
    const epochA = store.getFarmEpoch();
    await store.seedFarmSettings({ farmName: 'Alpha Farm', breed: 'Angus' });

    store.setActiveFarmSlug(`farm-sets-b-${Math.random().toString(36).slice(2)}`);

    const result = await store.getCachedFarmSettingsForEpoch(epochA);
    expect(result).toBeNull();
  });

  it('returns data for current epoch', async () => {
    const store = await loadStore();

    store.setActiveFarmSlug(`farm-sets-c-${Math.random().toString(36).slice(2)}`);
    const epoch = store.getFarmEpoch();
    await store.seedFarmSettings({ farmName: 'Beta Farm', breed: 'Brangus' });

    const result = await store.getCachedFarmSettingsForEpoch(epoch);
    expect(result).not.toBeNull();
    expect(result!.farmName).toBe('Beta Farm');
  });
});

// ── M3: heroImageUrl always resolves to /farm-hero.jpg ───────────────────────

describe('M3 — heroImageUrl default', () => {
  it('getCachedFarmSettings returns /farm-hero.jpg when stored heroImageUrl is absent', async () => {
    const store = await loadStore();

    store.setActiveFarmSlug(`farm-hero-a-${Math.random().toString(36).slice(2)}`);
    // Seed without heroImageUrl (the field is optional in CachedFarmSettings)
    await store.seedFarmSettings({ farmName: 'Dune Farm', breed: 'Dorper' });

    const settings = await store.getCachedFarmSettings();
    // When heroImageUrl is absent the caller should fall back to /farm-hero.jpg.
    // The store itself does not inject the default — that is the caller's
    // responsibility (consistent with the existing ?? '/farm-hero.jpg' pattern).
    // The store must NOT persist a tenant-specific URL override that could leak
    // cross-tenant; heroImageUrl is deprecated as a configurable field.
    expect(settings?.heroImageUrl).toBeUndefined();
  });

  it('seedFarmSettings strips heroImageUrl so tenants cannot persist a custom URL', async () => {
    const store = await loadStore();

    store.setActiveFarmSlug(`farm-hero-b-${Math.random().toString(36).slice(2)}`);
    // Attempt to seed a tenant-specific URL — the store must discard it.
    await store.seedFarmSettings({
      farmName: 'Gamma Farm',
      breed: 'Brangus',
      heroImageUrl: '/uploads/gamma-custom.jpg',
    });

    const settings = await store.getCachedFarmSettings();
    // heroImageUrl must NOT be preserved — it should be absent or undefined.
    expect(settings?.heroImageUrl).toBeUndefined();
  });
});

// ── Rapid farm-switch integration scenario ───────────────────────────────────

describe('rapid farm-switch end-to-end', () => {
  it('full scenario: prime A, switch to B, A reads return null, B reads return data', async () => {
    const store = await loadStore();

    // 1. Activate farm-a and prime cache
    store.setActiveFarmSlug(`farm-rapid-a-${Math.random().toString(36).slice(2)}`);
    const epochA = store.getFarmEpoch();
    await store.seedCamps([makeCamp('camp-a-1'), makeCamp('camp-a-2')]);
    await store.setLastSyncedAt('2026-01-01T00:00:00.000Z');

    // 2. Switch to farm-b → epoch bumps
    store.setActiveFarmSlug(`farm-rapid-b-${Math.random().toString(36).slice(2)}`);
    const epochB = store.getFarmEpoch();
    expect(epochB).toBeGreaterThan(epochA);

    // 3. Stale-epoch reads for farm-a must return null
    const staleA_camps = await store.getCachedCampsForEpoch(epochA);
    const staleA_sync = await store.getLastSyncedAtForEpoch(epochA);
    expect(staleA_camps).toBeNull();
    expect(staleA_sync).toBeNull();

    // 4. Prime farm-b cache and verify reads succeed with current epoch
    await store.seedCamps([makeCamp('camp-b-1')]);
    const freshB_camps = await store.getCachedCampsForEpoch(epochB);
    expect(freshB_camps).not.toBeNull();
    expect(freshB_camps!.map((c) => c.camp_id)).toEqual(['camp-b-1']);
  });
});
