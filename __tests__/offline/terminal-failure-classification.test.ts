// @vitest-environment jsdom
/**
 * Issue #324 (PRD #318 wave R2) — terminal vs transient sync-failure
 * classification.
 *
 * Root cause this pins:
 *   The offline sync queue modelled EVERY failure as a transport retry.
 *   `markObservationPending` (the "Retry" / "Retry all" path in
 *   FailedSyncDialog) blindly flips ANY failed row back to `pending`,
 *   including rows the server rejected with a terminal 4xx (400/404/422).
 *   Such a row is a poison message — replaying the identical payload can
 *   never succeed, so "Retry all" loops forever
 *   ("Attempted N times · HTTP 422 · Stuck").
 *
 * Contract pinned here:
 *   - A row whose most-recent failure was a terminal 4xx (400/404/422) is
 *     classified terminal (`isTerminalFailure(row) === true`) and a
 *     subsequent re-queue (`markObservationPending` etc.) is a NO-OP — the
 *     row stays in the failed bucket and is NOT flipped back to pending, so
 *     the sync-manager cannot re-POST it.
 *   - A row whose most-recent failure was transient (network error →
 *     `statusCode: null`, OR HTTP 5xx) keeps the existing retry behaviour:
 *     re-queue flips it back to pending and `clientLocalId` + audit metadata
 *     are preserved (the #209 contract).
 *
 * No IDB schema bump: terminality is DERIVED from the already-persisted
 * `lastStatusCode` (mirrors the `withDefaultedFailureMeta` no-migration
 * philosophy in offline-store.ts).
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

describe('isTerminalStatus — pure HTTP-status classifier', () => {
  it('400 / 404 / 422 are terminal; 5xx and null (network error) are transient', async () => {
    const { isTerminalStatus } = await loadStore();
    expect(isTerminalStatus(400)).toBe(true);
    expect(isTerminalStatus(404)).toBe(true);
    expect(isTerminalStatus(422)).toBe(true);
    // Transient — retry can plausibly succeed later.
    expect(isTerminalStatus(null)).toBe(false); // fetch threw — network error
    expect(isTerminalStatus(500)).toBe(false);
    expect(isTerminalStatus(502)).toBe(false);
    expect(isTerminalStatus(503)).toBe(false);
    // 401/403/408/429 are NOT poison: re-auth / rate-limit windows clear.
    expect(isTerminalStatus(401)).toBe(false);
    expect(isTerminalStatus(403)).toBe(false);
    expect(isTerminalStatus(408)).toBe(false);
    expect(isTerminalStatus(429)).toBe(false);
  });
});

describe('terminal 4xx row is poison — blind retry must NOT re-queue it', () => {
  it('markObservationPending is a no-op for a 422-failed row (stays failed, not pending)', async () => {
    const {
      queueObservation,
      markObservationFailed,
      markObservationPending,
      getFailedObservations,
      getPendingObservations,
      isTerminalFailure,
    } = await loadStore();

    const id = await queueObservation({
      type: 'camp_condition',
      camp_id: 'A',
      details: '{}',
      created_at: '2026-05-17T10:00:00Z',
      synced_at: null,
      sync_status: 'pending',
      clientLocalId: '11111111-2222-4333-8444-555555555555',
    });
    // Server rejected the payload with a terminal validation error.
    await markObservationFailed(id, { statusCode: 422, error: 'invalid observation type' });

    const failedBefore = await getFailedObservations();
    expect(failedBefore).toHaveLength(1);
    expect(isTerminalFailure(failedBefore[0])).toBe(true);

    // "Retry all" loops over every failed row calling the re-queue helper.
    await markObservationPending(id);

    // The poison row is STILL failed — blind retry could not re-arm it.
    const failedAfter = await getFailedObservations();
    expect(failedAfter).toHaveLength(1);
    expect(failedAfter[0].local_id).toBe(id);
    // And it did NOT leak back into the pending bucket (which is what made
    // the sync-manager re-POST it and loop forever).
    expect(await getPendingObservations()).toHaveLength(0);
  });

  it('markAnimalCreatePending / markCoverReadingPending are also no-ops for terminal 4xx', async () => {
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

    const animalId = await queueAnimalCreate({
      animal_id: 'KALF-1',
      sex: 'Female',
      category: 'Calf',
      current_camp: 'A',
      date_added: '2026-05-17',
      sync_status: 'pending',
    });
    await markAnimalCreateFailed(animalId, { statusCode: 400, error: 'malformed body' });

    const coverId = await queueCoverReading({
      farm_slug: 'farm',
      camp_id: 'A',
      cover_category: 'Good',
      created_at: '2026-05-17T08:00:00Z',
      sync_status: 'pending',
    });
    await markCoverReadingFailed(coverId, { statusCode: 404, error: 'camp not found' });

    await markAnimalCreatePending(animalId);
    await markCoverReadingPending(coverId);

    // Both stay in the failed bucket — neither re-armed for blind retry.
    expect(await getFailedAnimals()).toHaveLength(1);
    expect(await getFailedCoverReadings()).toHaveLength(1);
    expect(await getPendingAnimalCreates()).toHaveLength(0);
    expect(await getPendingCoverReadings()).toHaveLength(0);
  });
});

describe('transient failure stays retryable — existing #209 behaviour preserved', () => {
  it('a 500-failed row is re-queued by markObservationPending with clientLocalId + audit metadata intact', async () => {
    const {
      queueObservation,
      markObservationFailed,
      markObservationPending,
      getFailedObservations,
      getPendingObservations,
      isTerminalFailure,
    } = await loadStore();

    const clientLocalId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const id = await queueObservation({
      type: 'camp_condition',
      camp_id: 'A',
      details: '{}',
      created_at: '2026-05-17T10:00:00Z',
      synced_at: null,
      sync_status: 'pending',
      clientLocalId,
    });
    await markObservationFailed(id, { statusCode: 500, error: 'gateway' });

    const failedBefore = await getFailedObservations();
    expect(failedBefore).toHaveLength(1);
    expect(isTerminalFailure(failedBefore[0])).toBe(false);
    const frozenFirstFailedAt = failedBefore[0].firstFailedAt;

    await markObservationPending(id);

    // Transient row IS re-armed for retry — unchanged from #209.
    expect(await getFailedObservations()).toHaveLength(0);
    const pendingAfter = await getPendingObservations();
    expect(pendingAfter).toHaveLength(1);
    expect(pendingAfter[0].clientLocalId).toBe(clientLocalId);
    expect(pendingAfter[0].attempts).toBe(1);
    expect(pendingAfter[0].firstFailedAt).toBe(frozenFirstFailedAt);
    expect(pendingAfter[0].lastError).toBe('gateway');
    expect(pendingAfter[0].lastStatusCode).toBe(500);
  });

  it('a network-error row (statusCode null) is transient and stays retryable', async () => {
    const {
      queueObservation,
      markObservationFailed,
      markObservationPending,
      getPendingObservations,
      isTerminalFailure,
      getFailedObservations,
    } = await loadStore();

    const id = await queueObservation({
      type: 'camp_condition',
      camp_id: 'A',
      details: '{}',
      created_at: '2026-05-17T10:00:00Z',
      synced_at: null,
      sync_status: 'pending',
    });
    await markObservationFailed(id, { statusCode: null, error: 'Failed to fetch' });

    const failed = await getFailedObservations();
    expect(isTerminalFailure(failed[0])).toBe(false);

    await markObservationPending(id);
    expect(await getPendingObservations()).toHaveLength(1);
  });
});
