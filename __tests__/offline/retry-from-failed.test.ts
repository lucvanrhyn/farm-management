// @vitest-environment jsdom
/**
 * Issue #209 — re-queue helpers for the dead-letter UI.
 *
 * Contract pinned by this spec:
 *   - `markObservationPending(localId)` (and the animal / cover-reading
 *     equivalents) flip a previously-failed row back to `sync_status: 'pending'`
 *     so the next sync cycle picks it up.
 *   - The transition PRESERVES `clientLocalId` byte-for-byte. This is the
 *     load-bearing idempotency contract from #206 / #207 — a retry POST must
 *     arrive at the server with the same UUID so the upsert collapses
 *     duplicates from a "client thought POST failed but server got it" race
 *     to a single row.
 *   - Audit history (`attempts`, `firstFailedAt`, `lastError`,
 *     `lastStatusCode`) is also preserved. We only clear those on a
 *     subsequent SUCCESS (`applySuccessMeta`), never on the local re-queue.
 *     This keeps the dead-letter UI showing "Attempted 3 times" after the
 *     retry button is pressed while the next sync cycle is in flight.
 *   - After re-queue, `getPendingObservations()` includes the row so the
 *     sync-manager sweeps it on the next cycle.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

async function loadStore() {
  const mod = await import('@/lib/offline-store');
  mod.setActiveFarmSlug(`test-${Math.random().toString(36).slice(2)}`);
  return mod;
}

describe('markObservationPending — re-queue helper for #209 retry UI', () => {
  it('flips sync_status back to pending while preserving clientLocalId + audit metadata', async () => {
    const {
      queueObservation,
      markObservationFailed,
      markObservationPending,
      getFailedObservations,
      getPendingObservations,
    } = await loadStore();

    const clientLocalId = '11111111-2222-4333-8444-555555555555';
    const id = await queueObservation({
      type: 'camp_condition',
      camp_id: 'A',
      details: '{}',
      created_at: '2026-05-11T10:00:00Z',
      synced_at: null,
      sync_status: 'pending',
      clientLocalId,
    });

    await markObservationFailed(id, { statusCode: 422, error: 'bad payload' });
    // Fail it a second time so attempts === 2 and the audit-history claim is non-trivial.
    await markObservationFailed(id, { statusCode: 500, error: 'oh no' });

    const failedBefore = await getFailedObservations();
    expect(failedBefore).toHaveLength(1);
    const beforeRow = failedBefore[0];
    expect(beforeRow.attempts).toBe(2);
    expect(beforeRow.clientLocalId).toBe(clientLocalId);
    const frozenFirstFailedAt = beforeRow.firstFailedAt;
    expect(frozenFirstFailedAt).not.toBeNull();

    // Re-queue.
    await markObservationPending(id);

    // No longer in the failed bucket.
    expect(await getFailedObservations()).toHaveLength(0);

    // It IS back in the pending bucket so the next sync cycle drains it.
    const pendingAfter = await getPendingObservations();
    expect(pendingAfter).toHaveLength(1);

    const afterRow = pendingAfter[0];
    // The idempotency contract — UUID is byte-identical.
    expect(afterRow.clientLocalId).toBe(clientLocalId);
    // Audit history preserved: attempts, firstFailedAt, lastError, lastStatusCode all carry over.
    // We do NOT bump attempts here — the bump happens only on the actual sync attempt.
    expect(afterRow.attempts).toBe(2);
    expect(afterRow.firstFailedAt).toBe(frozenFirstFailedAt);
    expect(afterRow.lastError).toBe('oh no');
    expect(afterRow.lastStatusCode).toBe(500);
  });

  it('markAnimalCreatePending and markCoverReadingPending behave symmetrically', async () => {
    const {
      queueAnimalCreate,
      queueCoverReading,
      markAnimalCreateFailed,
      markCoverReadingFailed,
      markAnimalCreatePending,
      markCoverReadingPending,
      getFailedAnimals,
      getFailedCoverReadings,
      getPendingAnimalCreates,
      getPendingCoverReadings,
    } = await loadStore();

    const animalUuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const animalId = await queueAnimalCreate({
      animal_id: 'KALF-1',
      sex: 'Female',
      category: 'Calf',
      current_camp: 'A',
      date_added: '2026-05-11',
      sync_status: 'pending',
      clientLocalId: animalUuid,
    });
    await markAnimalCreateFailed(animalId, { statusCode: 422, error: 'no dam' });

    const coverUuid = '99999999-8888-4777-8666-555544443333';
    const coverId = await queueCoverReading({
      farm_slug: 'farm',
      camp_id: 'A',
      cover_category: 'Good',
      created_at: '2026-05-11T08:00:00Z',
      sync_status: 'pending',
      clientLocalId: coverUuid,
    });
    await markCoverReadingFailed(coverId, { statusCode: 500, error: 'gateway' });

    expect(await getFailedAnimals()).toHaveLength(1);
    expect(await getFailedCoverReadings()).toHaveLength(1);

    await markAnimalCreatePending(animalId);
    await markCoverReadingPending(coverId);

    expect(await getFailedAnimals()).toHaveLength(0);
    expect(await getFailedCoverReadings()).toHaveLength(0);

    const pendingAnimals = await getPendingAnimalCreates();
    expect(pendingAnimals).toHaveLength(1);
    expect(pendingAnimals[0].clientLocalId).toBe(animalUuid);
    expect(pendingAnimals[0].attempts).toBe(1);
    expect(pendingAnimals[0].lastError).toBe('no dam');
    expect(pendingAnimals[0].lastStatusCode).toBe(422);

    const pendingCovers = await getPendingCoverReadings();
    expect(pendingCovers).toHaveLength(1);
    expect(pendingCovers[0].clientLocalId).toBe(coverUuid);
    expect(pendingCovers[0].attempts).toBe(1);
    expect(pendingCovers[0].lastError).toBe('gateway');
    expect(pendingCovers[0].lastStatusCode).toBe(500);
  });
});
