// @vitest-environment jsdom
/**
 * S10 (sync-L1 / sync-L2) — dead-letter cleanup: orphaned photos + correct
 * tenant binding.
 *
 * sync-L1 — ROOT CAUSE (confirmed against code): `discardFailedObservation`
 * deletes only the `pending_observations` row. Its queued `pending_photos`
 * rows (keyed by `observation_local_id`, indexed `by_observation`) are never
 * touched, so every discarded dead-letter leaks its photo Blobs in IndexedDB
 * forever — unreachable garbage no UI lists and no sweep collects.
 *
 * sync-L2 — ROOT CAUSE (confirmed against code): `getDBName` resolves the
 * tenant DB as module-global → sessionStorage → URL segment. Both memos can
 * go stale across a farm switch / hard reload (e.g. a tab whose
 * sessionStorage still holds the previously-visited farm), so a queue write
 * made while the URL says farm B could bind to farm A's DB — silent
 * cross-tenant queue pollution. #393 made the URL `[farmSlug]` the single
 * tenant source of truth; the offline store must follow it. The fix inverts
 * the order: when the active URL is a tenant page (per the canonical
 * `isTenantNavigationRequest` predicate), its slug WINS; the memos remain
 * fallbacks for non-tenant surfaces (/farms) and non-DOM environments.
 *
 * Harness mirrors `__tests__/offline/discard-poison-row.test.ts`:
 * fake-indexeddb + vi.resetModules + a unique farm slug per test.
 */

import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  // Park every test on a non-tenant URL so the memo path stays in control
  // unless a test explicitly navigates to a tenant URL.
  window.history.replaceState({}, '', '/');
});

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

async function loadStore() {
  return import('@/lib/offline-store');
}

function makeBlob(): Blob {
  return new Blob(['img'], { type: 'image/jpeg' });
}

function makeObservation(clientLocalId: string) {
  return {
    type: 'health_issue',
    camp_id: 'A',
    details: '{}',
    created_at: '2026-06-12T08:00:00Z',
    synced_at: null,
    sync_status: 'pending' as const,
    clientLocalId,
  };
}

/** Raw row-count in a store of a named tenant DB, bypassing the module API. */
async function rawCount(dbName: string, store: string): Promise<number> {
  const db = await openDB(dbName);
  try {
    const all = await db.getAll(store);
    return all.length;
  } finally {
    db.close();
  }
}

// ── sync-L1 — discard cascades to queued photos ──────────────────────────────

describe('discardFailedObservation — cascades to queued photos (sync-L1)', () => {
  it('deletes the dead-lettered observation AND its pending photo rows, leaving other observations’ photos intact', async () => {
    const mod = await loadStore();
    const slug = uniqueSlug('test');
    mod.setActiveFarmSlug(slug);

    const poisoned = await mod.queueObservation(
      makeObservation('11111111-2222-4333-8444-555555555555'),
    );
    await mod.queuePhoto(poisoned, makeBlob());

    const healthy = await mod.queueObservation(
      makeObservation('66666666-7777-4888-9999-000000000000'),
    );
    await mod.queuePhoto(healthy, makeBlob());

    await mod.markObservationFailed(poisoned, {
      statusCode: 422,
      error: 'HEALTH_FIELD_REQUIRED',
    });
    await mod.discardFailedObservation(poisoned);

    // Observation gone…
    expect(await mod.getFailedObservations()).toHaveLength(0);
    // …and its photo gone with it — no orphaned Blob row.
    expect(await mod.getPhotoForObservation(poisoned)).toBeNull();
    const photos = await mod.getPendingPhotos();
    expect(photos).toHaveLength(1);
    expect(photos[0].observation_local_id).toBe(healthy);
  });

  it('removes the discarded observation’s photo rows in EVERY sync_status (synced + failed too)', async () => {
    const mod = await loadStore();
    const slug = uniqueSlug('test');
    mod.setActiveFarmSlug(slug);

    const poisoned = await mod.queueObservation(
      makeObservation('11111111-2222-4333-8444-555555555555'),
    );
    const p1 = await mod.queuePhoto(poisoned, makeBlob());
    const p2 = await mod.queuePhoto(poisoned, makeBlob());
    await mod.markPhotoSynced(p1);
    await mod.markPhotoFailed(p2);

    await mod.markObservationFailed(poisoned, {
      statusCode: 404,
      error: 'ANIMAL_NOT_FOUND',
    });
    await mod.discardFailedObservation(poisoned);

    // The parent row is gone, so ANY remaining photo row referencing it is
    // unreachable garbage — assert raw deletion, not just API filtering.
    expect(await rawCount(`farmtrack-${slug}`, 'pending_photos')).toBe(0);
  });

  it('stays a NO-OP for a transient (retryable) row — observation AND photos remain', async () => {
    const mod = await loadStore();
    const slug = uniqueSlug('test');
    mod.setActiveFarmSlug(slug);

    const transient = await mod.queueObservation(
      makeObservation('11111111-2222-4333-8444-555555555555'),
    );
    await mod.queuePhoto(transient, makeBlob());
    await mod.markObservationFailed(transient, {
      statusCode: 500,
      error: 'Internal Server Error',
    });

    await mod.discardFailedObservation(transient);

    expect(await mod.getFailedObservations()).toHaveLength(1);
    expect(await mod.getPendingPhotos()).toHaveLength(1);
  });
});

// ── sync-L2 — URL farm segment is the authoritative tenant binding ──────────

describe('getDBName — active URL tenant segment is authoritative (sync-L2)', () => {
  it('binds queue writes to the URL tenant even when the module-global memo holds a stale farm', async () => {
    const mod = await loadStore();
    const farmA = uniqueSlug('farm-a');
    const farmB = uniqueSlug('farm-b');

    // Farm A's OfflineProvider ran earlier — memo AND sessionStorage say A…
    mod.setActiveFarmSlug(farmA);
    // …but the user has since navigated to farm B's logger.
    window.history.pushState({}, '', `/${farmB}/logger/camp-1`);

    await mod.queueObservation(
      makeObservation('11111111-2222-4333-8444-555555555555'),
    );

    // The row must live in farm B's DB, not farm A's.
    expect(await rawCount(`farmtrack-${farmB}`, 'pending_observations')).toBe(1);
    expect(await mod.getPendingObservations()).toHaveLength(1);
  });

  it('hard reload: stale sessionStorage from a previously-visited farm loses to the URL segment', async () => {
    const farmA = uniqueSlug('farm-a');
    const farmB = uniqueSlug('farm-b');

    // Simulate a hard reload on farm B's URL before OfflineProvider mounts:
    // module-global unset (fresh module), sessionStorage still holds farm A.
    sessionStorage.setItem('activeFarmSlug', farmA);
    window.history.pushState({}, '', `/${farmB}/logger/camp-1`);

    const mod = await loadStore();
    await mod.queueObservation(
      makeObservation('11111111-2222-4333-8444-555555555555'),
    );

    expect(await rawCount(`farmtrack-${farmB}`, 'pending_observations')).toBe(1);
  });

  it('falls back to the active-slug memo on non-tenant surfaces (/farms)', async () => {
    const mod = await loadStore();
    const farmA = uniqueSlug('farm-a');
    mod.setActiveFarmSlug(farmA);
    window.history.pushState({}, '', '/farms');

    await mod.queueObservation(
      makeObservation('11111111-2222-4333-8444-555555555555'),
    );

    expect(await rawCount(`farmtrack-${farmA}`, 'pending_observations')).toBe(1);
  });

  it('never fabricates a tenant DB from a reserved top-level route — throws without an active slug', async () => {
    const mod = await loadStore();
    window.history.pushState({}, '', '/login');

    await expect(
      mod.queueObservation(
        makeObservation('11111111-2222-4333-8444-555555555555'),
      ),
    ).rejects.toThrow(/No active farm slug/);
  });
});
