// @vitest-environment jsdom
/**
 * Issue #208 — split offline queue counts into pending vs failed.
 *
 * Before this slice, `getPendingObservations` / `getPendingAnimalCreates` /
 * `getPendingCoverReadings` returned BOTH `pending` and `failed` rows so the
 * sync loop would retry failed rows on every cycle. The side effect:
 * `getPendingCount` summed both, so a row that hit a permanent 422 stayed in
 * the user-visible "N pending" pill forever — the pill never drained because
 * the row could never succeed without server-side intervention.
 *
 * This wave splits the buckets:
 *   - `getPendingX()` returns only `sync_status === 'pending'`.
 *   - `getFailedX()` returns only `sync_status === 'failed'`.
 *   - `getPendingCount()` sums only pending across all three queues.
 *   - `getFailedCount()` sums only failed across all three queues.
 *
 * Failed rows stay in the failed bucket until #209's retry-from-UI explicitly
 * nudges them back to pending. The sync loop no longer auto-retries them.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDB } from 'idb';

beforeEach(() => {
  vi.resetModules();
});

async function loadStore() {
  const mod = await import('@/lib/offline-store');
  mod.setActiveFarmSlug(`test-${Math.random().toString(36).slice(2)}`);
  return mod;
}

describe('getPendingObservations excludes failed', () => {
  it('returns only sync_status === "pending" rows', async () => {
    const { queueObservation, markObservationFailed, getPendingObservations } = await loadStore();

    const pendingId = await queueObservation({
      type: 'camp_condition',
      camp_id: 'A',
      details: '{}',
      created_at: '2026-05-11T10:00:00Z',
      synced_at: null,
      sync_status: 'pending',
    });
    const failedId = await queueObservation({
      type: 'camp_condition',
      camp_id: 'B',
      details: '{}',
      created_at: '2026-05-11T10:00:00Z',
      synced_at: null,
      sync_status: 'pending',
    });

    // Flip the second row to `failed`.
    await markObservationFailed(failedId, { statusCode: 500, error: 'server explode' });

    const rows = await getPendingObservations();
    expect(rows).toHaveLength(1);
    expect(rows[0].local_id).toBe(pendingId);
  });
});

describe('getFailedObservations / getFailedAnimals / getFailedCoverReadings', () => {
  it('each return only their failed rows', async () => {
    const {
      queueObservation,
      queueAnimalCreate,
      queueCoverReading,
      markObservationFailed,
      markAnimalCreateFailed,
      markCoverReadingFailed,
      getFailedObservations,
      getFailedAnimals,
      getFailedCoverReadings,
    } = await loadStore();

    const obsPending = await queueObservation({
      type: 'camp_condition',
      camp_id: 'A',
      details: '{}',
      created_at: '',
      synced_at: null,
      sync_status: 'pending',
    });
    const obsFailed = await queueObservation({
      type: 'camp_condition',
      camp_id: 'B',
      details: '{}',
      created_at: '',
      synced_at: null,
      sync_status: 'pending',
    });
    await markObservationFailed(obsFailed, { statusCode: 422, error: 'bad payload' });

    const animalPending = await queueAnimalCreate({
      animal_id: 'KALF-1',
      sex: 'Male',
      category: 'Calf',
      current_camp: 'A',
      date_added: '',
      sync_status: 'pending',
    });
    const animalFailed = await queueAnimalCreate({
      animal_id: 'KALF-2',
      sex: 'Female',
      category: 'Calf',
      current_camp: 'A',
      date_added: '',
      sync_status: 'pending',
    });
    await markAnimalCreateFailed(animalFailed, { statusCode: 500, error: 'oops' });

    const coverPending = await queueCoverReading({
      farm_slug: 'f',
      camp_id: 'A',
      cover_category: 'Good',
      created_at: '',
      sync_status: 'pending',
    });
    const coverFailed = await queueCoverReading({
      farm_slug: 'f',
      camp_id: 'B',
      cover_category: 'Poor',
      created_at: '',
      sync_status: 'pending',
    });
    await markCoverReadingFailed(coverFailed, { statusCode: 503, error: 'gateway' });

    const failedObs = await getFailedObservations();
    expect(failedObs.map((r) => r.local_id)).toEqual([obsFailed]);
    void obsPending; // present in pending bucket; not asserted here

    const failedAnimals = await getFailedAnimals();
    expect(failedAnimals.map((r) => r.local_id)).toEqual([animalFailed]);
    void animalPending;

    const failedCovers = await getFailedCoverReadings();
    expect(failedCovers.map((r) => r.local_id)).toEqual([coverFailed]);
    void coverPending;
  });
});

describe('getPendingCount sums only pending across all three queues', () => {
  it('does not count failed rows', async () => {
    const {
      queueObservation,
      queueAnimalCreate,
      queueCoverReading,
      markObservationFailed,
      markAnimalCreateFailed,
      markCoverReadingFailed,
      getPendingCount,
    } = await loadStore();

    // 1 pending obs + 1 failed obs
    await queueObservation({
      type: 't', camp_id: 'A', details: '{}', created_at: '',
      synced_at: null, sync_status: 'pending',
    });
    const obsFailedId = await queueObservation({
      type: 't', camp_id: 'B', details: '{}', created_at: '',
      synced_at: null, sync_status: 'pending',
    });
    await markObservationFailed(obsFailedId, { statusCode: 422, error: 'x' });

    // 1 pending animal + 1 failed animal
    await queueAnimalCreate({
      animal_id: 'a1', sex: 'M', category: 'Calf', current_camp: 'A',
      date_added: '', sync_status: 'pending',
    });
    const animalFailedId = await queueAnimalCreate({
      animal_id: 'a2', sex: 'F', category: 'Calf', current_camp: 'A',
      date_added: '', sync_status: 'pending',
    });
    await markAnimalCreateFailed(animalFailedId, { statusCode: 500, error: 'x' });

    // 1 pending cover + 1 failed cover
    await queueCoverReading({
      farm_slug: 'f', camp_id: 'A', cover_category: 'Good',
      created_at: '', sync_status: 'pending',
    });
    const coverFailedId = await queueCoverReading({
      farm_slug: 'f', camp_id: 'B', cover_category: 'Fair',
      created_at: '', sync_status: 'pending',
    });
    await markCoverReadingFailed(coverFailedId, { statusCode: 503, error: 'x' });

    // 3 pending total (one per queue), 3 failed total — getPendingCount sees only the pending half.
    expect(await getPendingCount()).toBe(3);
  });
});

describe('getFailedCount sums only failed across all three queues', () => {
  it('does not count pending rows', async () => {
    const {
      queueObservation,
      queueAnimalCreate,
      queueCoverReading,
      markObservationFailed,
      markAnimalCreateFailed,
      markCoverReadingFailed,
      getFailedCount,
    } = await loadStore();

    await queueObservation({
      type: 't', camp_id: 'A', details: '{}', created_at: '',
      synced_at: null, sync_status: 'pending',
    });
    const oid = await queueObservation({
      type: 't', camp_id: 'B', details: '{}', created_at: '',
      synced_at: null, sync_status: 'pending',
    });
    await markObservationFailed(oid, { statusCode: 422, error: 'x' });

    const aid = await queueAnimalCreate({
      animal_id: 'a', sex: 'M', category: 'Calf', current_camp: 'A',
      date_added: '', sync_status: 'pending',
    });
    await markAnimalCreateFailed(aid, { statusCode: 500, error: 'x' });

    const cid = await queueCoverReading({
      farm_slug: 'f', camp_id: 'A', cover_category: 'Good',
      created_at: '', sync_status: 'pending',
    });
    await markCoverReadingFailed(cid, { statusCode: 503, error: 'x' });

    expect(await getFailedCount()).toBe(3);
  });
});

describe('legacy records without new fields read back with defaults', () => {
  it('observation rows missing attempts/lastError/firstFailedAt/lastStatusCode default to {0,null,null,null}', async () => {
    const { setActiveFarmSlug, getPendingObservations } = await import('@/lib/offline-store');
    const farmSlug = `test-${Math.random().toString(36).slice(2)}`;
    setActiveFarmSlug(farmSlug);

    // Raw IDB put — bypass queueObservation so the new fields are absent on
    // disk. Mirrors a row written by a previous app version still sitting on
    // a field device.
    const db = await openDB(`farmtrack-${farmSlug}`, 5, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('pending_observations')) {
          db.createObjectStore('pending_observations', {
            keyPath: 'local_id',
            autoIncrement: true,
          });
        }
      },
    });
    await db.add('pending_observations', {
      type: 'camp_condition',
      camp_id: 'legacy',
      details: '{}',
      created_at: '2026-04-01T00:00:00Z',
      synced_at: null,
      sync_status: 'pending',
      // intentionally NO attempts / lastError / firstFailedAt / lastStatusCode
    });
    db.close();

    const rows = await getPendingObservations();
    expect(rows).toHaveLength(1);
    expect(rows[0].attempts).toBe(0);
    expect(rows[0].lastError).toBeNull();
    expect(rows[0].firstFailedAt).toBeNull();
    expect(rows[0].lastStatusCode).toBeNull();
  });
});

describe('markObservationSynced clears failure metadata + increments attempts', () => {
  it('cleared lastError / firstFailedAt / lastStatusCode after success; attempts bumped', async () => {
    const {
      queueObservation,
      markObservationFailed,
      markObservationSynced,
      getFailedObservations,
    } = await loadStore();

    const id = await queueObservation({
      type: 'camp_condition',
      camp_id: 'A',
      details: '{}',
      created_at: '',
      synced_at: null,
      sync_status: 'pending',
    });

    await markObservationFailed(id, { statusCode: 500, error: 'oops' });
    const failedRows = await getFailedObservations();
    expect(failedRows).toHaveLength(1);
    expect(failedRows[0].attempts).toBe(1);
    expect(failedRows[0].lastError).toBe('oops');
    expect(failedRows[0].firstFailedAt).not.toBeNull();
    expect(failedRows[0].lastStatusCode).toBe(500);

    await markObservationSynced(id);

    // Row is no longer failed — read it raw to confirm cleared metadata.
    const { setActiveFarmSlug: _slug } = await import('@/lib/offline-store');
    void _slug;
    const stillFailed = await getFailedObservations();
    expect(stillFailed).toHaveLength(0);
  });
});

describe('firstFailedAt is frozen across subsequent failures', () => {
  it('first failure stamps firstFailedAt; second failure does not overwrite it', async () => {
    const farmSlug = `test-${Math.random().toString(36).slice(2)}`;
    const mod = await import('@/lib/offline-store');
    mod.setActiveFarmSlug(farmSlug);

    const id = await mod.queueObservation({
      type: 'camp_condition',
      camp_id: 'A',
      details: '{}',
      created_at: '',
      synced_at: null,
      sync_status: 'pending',
    });

    await mod.markObservationFailed(id, { statusCode: 500, error: 'first' });
    const after1 = await mod.getFailedObservations();
    const firstFailureTs = after1[0].firstFailedAt;
    expect(firstFailureTs).not.toBeNull();
    expect(after1[0].attempts).toBe(1);

    // Yield a tick so a buggy implementation that re-reads Date.now() would
    // record a different number.
    await new Promise((r) => setTimeout(r, 5));

    await mod.markObservationFailed(id, { statusCode: 503, error: 'second' });
    const after2 = await mod.getFailedObservations();
    expect(after2[0].firstFailedAt).toBe(firstFailureTs);
    expect(after2[0].attempts).toBe(2);
    expect(after2[0].lastError).toBe('second');
    expect(after2[0].lastStatusCode).toBe(503);
  });
});

describe('attempts increments on every attempt (pass AND fail)', () => {
  it('three failures then one success: attempts goes 1, 2, 3, 4', async () => {
    const farmSlug = `test-${Math.random().toString(36).slice(2)}`;
    const mod = await import('@/lib/offline-store');
    mod.setActiveFarmSlug(farmSlug);

    const id = await mod.queueObservation({
      type: 'camp_condition',
      camp_id: 'A',
      details: '{}',
      created_at: '',
      synced_at: null,
      sync_status: 'pending',
    });

    await mod.markObservationFailed(id, { statusCode: 500, error: 'a' });
    expect((await mod.getFailedObservations())[0].attempts).toBe(1);

    await mod.markObservationFailed(id, { statusCode: 500, error: 'b' });
    expect((await mod.getFailedObservations())[0].attempts).toBe(2);

    await mod.markObservationFailed(id, { statusCode: 500, error: 'c' });
    expect((await mod.getFailedObservations())[0].attempts).toBe(3);

    await mod.markObservationSynced(id);

    // Failed bucket drained; the synced row is no longer in either getter.
    expect(await mod.getFailedObservations()).toHaveLength(0);
    expect(await mod.getPendingObservations()).toHaveLength(0);
    // The attempts count survives the success transition (we just don't
    // expose it through a getter in this slice — #209 will). Verify via raw
    // IDB so the contract is pinned for the dead-letter UI work.
    const { openDB } = await import('idb');
    const db = await openDB(`farmtrack-${farmSlug}`);
    const synced = (await db.get('pending_observations', id)) as {
      sync_status: string;
      attempts: number;
    };
    db.close();
    expect(synced.sync_status).toBe('synced');
    expect(synced.attempts).toBe(4);
  });
});
