// @vitest-environment jsdom
/**
 * Issue #324 (PRD #318 wave R2) follow-up — dead-letter discard escape hatch.
 *
 * Root cause this pins:
 *   R2 made the re-queue writers (`markObservationPending` etc.) a NO-OP for
 *   a terminal-4xx poison row so blind "Retry all" can't loop forever. But
 *   that left the farmer with NO way to clear a poison row: it stays in the
 *   failed bucket permanently, the FailedSyncDialog never drains, and the
 *   "Retry" button silently does nothing. There was no discard primitive.
 *
 * Contract pinned here:
 *   - `discardFailedObservation(localId)` permanently deletes a *terminal*
 *     (poison, non-retryable) failed row from IndexedDB so the dead-letter
 *     list can drain and the dialog can auto-close.
 *   - It is a NO-OP for a *transient* (retryable) failed row. Discard is the
 *     poison-only escape hatch — a transient row must be retried, never
 *     silently dropped (that would be accidental data loss of a record the
 *     farmer can still get through).
 *   - Symmetric `discardFailedAnimalCreate` / `discardFailedCoverReading`.
 *
 * No IDB schema bump: terminality is DERIVED from the already-persisted
 * `lastStatusCode` via the existing `isTerminalFailure` classifier.
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

describe('discardFailedObservation — poison-only escape hatch', () => {
  it('permanently deletes a terminal 4xx (422) observation row', async () => {
    const {
      queueObservation,
      markObservationFailed,
      discardFailedObservation,
      getFailedObservations,
      getPendingObservations,
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
    await markObservationFailed(id, {
      statusCode: 422,
      error: 'CAMP_CONDITION_FIELD_REQUIRED',
    });
    expect(await getFailedObservations()).toHaveLength(1);

    await discardFailedObservation(id);

    // Gone for good — not in failed, not leaked back to pending.
    expect(await getFailedObservations()).toHaveLength(0);
    expect(await getPendingObservations()).toHaveLength(0);
  });

  it('is a NO-OP for a transient (500) observation row — never silently drops a retryable record', async () => {
    const {
      queueObservation,
      markObservationFailed,
      discardFailedObservation,
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
    await markObservationFailed(id, { statusCode: 500, error: 'gateway' });

    await discardFailedObservation(id);

    // Still here — a transient row must be retried, not discarded.
    const failed = await getFailedObservations();
    expect(failed).toHaveLength(1);
    expect(failed[0].local_id).toBe(id);
  });
});

describe('discardFailedAnimalCreate / discardFailedCoverReading — symmetric', () => {
  it('delete a terminal 4xx animal-create and cover-reading row; no-op when transient', async () => {
    const {
      queueAnimalCreate,
      queueCoverReading,
      markAnimalCreateFailed,
      markCoverReadingFailed,
      discardFailedAnimalCreate,
      discardFailedCoverReading,
      getFailedAnimals,
      getFailedCoverReadings,
    } = await loadStore();

    // Terminal poison rows.
    const poisonAnimal = await queueAnimalCreate({
      animal_id: 'KALF-1',
      sex: 'Female',
      category: 'Calf',
      current_camp: 'A',
      date_added: '2026-05-17',
      sync_status: 'pending',
    });
    await markAnimalCreateFailed(poisonAnimal, { statusCode: 400, error: 'malformed body' });

    const poisonCover = await queueCoverReading({
      farm_slug: 'farm',
      camp_id: 'A',
      cover_category: 'Good',
      created_at: '2026-05-17T08:00:00Z',
      sync_status: 'pending',
    });
    await markCoverReadingFailed(poisonCover, { statusCode: 404, error: 'camp not found' });

    // Transient rows that must survive a discard call.
    const transientAnimal = await queueAnimalCreate({
      animal_id: 'KALF-2',
      sex: 'Male',
      category: 'Calf',
      current_camp: 'A',
      date_added: '2026-05-17',
      sync_status: 'pending',
    });
    await markAnimalCreateFailed(transientAnimal, { statusCode: 503, error: 'unavailable' });

    const transientCover = await queueCoverReading({
      farm_slug: 'farm',
      camp_id: 'B',
      cover_category: 'Fair',
      created_at: '2026-05-17T09:00:00Z',
      sync_status: 'pending',
    });
    await markCoverReadingFailed(transientCover, { statusCode: null, error: 'Failed to fetch' });

    await discardFailedAnimalCreate(poisonAnimal);
    await discardFailedCoverReading(poisonCover);
    await discardFailedAnimalCreate(transientAnimal);
    await discardFailedCoverReading(transientCover);

    const animals = await getFailedAnimals();
    const covers = await getFailedCoverReadings();
    expect(animals).toHaveLength(1);
    expect(animals[0].local_id).toBe(transientAnimal);
    expect(covers).toHaveLength(1);
    expect(covers[0].local_id).toBe(transientCover);
  });
});
