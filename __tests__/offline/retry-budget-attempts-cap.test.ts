// @vitest-environment jsdom
/**
 * OBS-1 — offline sync poison-loop: retry budget / max-attempts cap.
 *
 * Root cause this pins:
 *   The terminal-vs-transient classifiers (`isTerminalStatus` /
 *   `isTerminalFailure`) decided retryability PURELY by HTTP status. A
 *   persistent server-side error that surfaces as HTTP 500 (schema-mismatch
 *   `no such column`, an `AnimalNotFoundError` mapped to an opaque 500, any
 *   deterministic server bug) is terminal IN REALITY — replaying the identical
 *   payload can never succeed — yet transient BY STATUS (5xx → retryable). With
 *   no upper bound on retries such a row replays forever: a poison message that
 *   pins the sync queue ("Attempted N times · HTTP 500 · Stuck").
 *
 * Contract pinned here:
 *   1. `MAX_SYNC_ATTEMPTS === 5` is exported next to `isTerminalStatus`.
 *   2. `isTerminalFailure(row)` is TRUE once `row.attempts >= MAX_SYNC_ATTEMPTS`
 *      REGARDLESS of status code — an attempts-exhausted transient row is now
 *      terminal / dead-lettered.
 *   3. A transient 500 row whose `attempts` is BELOW the cap is still retryable.
 *   4. The genuinely-terminal 4xx classification (400/404/422) is UNCHANGED.
 *   5. The re-queue helpers (`markObservationPending`,
 *      `markAnimalCreatePending`, `markCoverReadingPending`) refuse to re-arm an
 *      attempts-exhausted row — it stays in the failed bucket as a dead-letter.
 *
 * No IDB schema bump: `attempts` is already persisted (#208) and bumped by
 * `applyFailureMeta` on every drain attempt.
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

describe('MAX_SYNC_ATTEMPTS — exported retry budget', () => {
  it('is the documented cap of 5', async () => {
    const { MAX_SYNC_ATTEMPTS } = await loadStore();
    expect(MAX_SYNC_ATTEMPTS).toBe(5);
  });
});

describe('isTerminalFailure — attempts-exhaustion overrides transient status', () => {
  it('a transient 500 row at the cap is terminal regardless of status', async () => {
    const { isTerminalFailure, MAX_SYNC_ATTEMPTS } = await loadStore();
    // 5xx is normally transient, but the budget is spent.
    expect(
      isTerminalFailure({ lastStatusCode: 500, attempts: MAX_SYNC_ATTEMPTS }),
    ).toBe(true);
    // A network-error (null status) row that exhausted the budget is terminal too.
    expect(
      isTerminalFailure({ lastStatusCode: null, attempts: MAX_SYNC_ATTEMPTS }),
    ).toBe(true);
    // Above the cap (defensive — a row that somehow over-ran) is also terminal.
    expect(
      isTerminalFailure({ lastStatusCode: 503, attempts: MAX_SYNC_ATTEMPTS + 3 }),
    ).toBe(true);
  });

  it('a transient 500 row BELOW the cap is still retryable (unchanged)', async () => {
    const { isTerminalFailure, MAX_SYNC_ATTEMPTS } = await loadStore();
    expect(
      isTerminalFailure({ lastStatusCode: 500, attempts: MAX_SYNC_ATTEMPTS - 1 }),
    ).toBe(false);
    expect(isTerminalFailure({ lastStatusCode: 500, attempts: 1 })).toBe(false);
    expect(isTerminalFailure({ lastStatusCode: null, attempts: 2 })).toBe(false);
  });

  it('genuinely-terminal 4xx stays terminal even with attempts below the cap', async () => {
    const { isTerminalFailure } = await loadStore();
    expect(isTerminalFailure({ lastStatusCode: 400, attempts: 1 })).toBe(true);
    expect(isTerminalFailure({ lastStatusCode: 404, attempts: 1 })).toBe(true);
    expect(isTerminalFailure({ lastStatusCode: 422, attempts: 1 })).toBe(true);
  });
});

describe('re-queue helpers honour the attempts cap', () => {
  it('markObservationPending refuses to re-arm a 500 row that exhausted the budget', async () => {
    const {
      queueObservation,
      markObservationFailed,
      markObservationPending,
      getFailedObservations,
      getPendingObservations,
      isTerminalFailure,
      MAX_SYNC_ATTEMPTS,
    } = await loadStore();

    const id = await queueObservation({
      type: 'camp_condition',
      camp_id: 'A',
      details: '{}',
      created_at: '2026-05-31T10:00:00Z',
      synced_at: null,
      sync_status: 'pending',
      clientLocalId: '11111111-2222-4333-8444-555555555555',
    });

    // Drain the budget: MAX_SYNC_ATTEMPTS transient 500 failures.
    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i++) {
      await markObservationFailed(id, { statusCode: 500, error: 'no such column' });
    }

    const failedBefore = await getFailedObservations();
    expect(failedBefore).toHaveLength(1);
    expect(failedBefore[0].attempts).toBe(MAX_SYNC_ATTEMPTS);
    // Status is 5xx (transient by status) but the budget is spent → terminal.
    expect(isTerminalFailure(failedBefore[0])).toBe(true);

    // "Retry all" iterates every failed row through the re-queue helper.
    await markObservationPending(id);

    // The exhausted row is STILL failed — the cap dead-lettered it.
    const failedAfter = await getFailedObservations();
    expect(failedAfter).toHaveLength(1);
    expect(failedAfter[0].local_id).toBe(id);
    expect(await getPendingObservations()).toHaveLength(0);
  });

  it('markAnimalCreatePending / markCoverReadingPending also refuse an exhausted row', async () => {
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
      MAX_SYNC_ATTEMPTS,
    } = await loadStore();

    const animalId = await queueAnimalCreate({
      animal_id: 'KALF-1',
      sex: 'Female',
      category: 'Calf',
      current_camp: 'A',
      date_added: '2026-05-31',
      sync_status: 'pending',
    });
    const coverId = await queueCoverReading({
      farm_slug: 'farm',
      camp_id: 'A',
      cover_category: 'Good',
      created_at: '2026-05-31T08:00:00Z',
      sync_status: 'pending',
    });

    // Exhaust both budgets with transient 503s.
    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i++) {
      await markAnimalCreateFailed(animalId, { statusCode: 503, error: 'gateway' });
      await markCoverReadingFailed(coverId, { statusCode: 503, error: 'gateway' });
    }

    await markAnimalCreatePending(animalId);
    await markCoverReadingPending(coverId);

    // Both stay in the failed bucket — the cap dead-lettered them.
    expect(await getFailedAnimals()).toHaveLength(1);
    expect(await getFailedCoverReadings()).toHaveLength(1);
    expect(await getPendingAnimalCreates()).toHaveLength(0);
    expect(await getPendingCoverReadings()).toHaveLength(0);
  });

  it('a transient 500 row ONE attempt below the cap is still re-armed', async () => {
    const {
      queueObservation,
      markObservationFailed,
      markObservationPending,
      getPendingObservations,
      getFailedObservations,
      MAX_SYNC_ATTEMPTS,
    } = await loadStore();

    const id = await queueObservation({
      type: 'camp_condition',
      camp_id: 'A',
      details: '{}',
      created_at: '2026-05-31T10:00:00Z',
      synced_at: null,
      sync_status: 'pending',
    });

    // One short of the cap.
    for (let i = 0; i < MAX_SYNC_ATTEMPTS - 1; i++) {
      await markObservationFailed(id, { statusCode: 500, error: 'gateway' });
    }
    const failed = await getFailedObservations();
    expect(failed[0].attempts).toBe(MAX_SYNC_ATTEMPTS - 1);

    await markObservationPending(id);

    // Still retryable — budget not yet spent.
    expect(await getFailedObservations()).toHaveLength(0);
    expect(await getPendingObservations()).toHaveLength(1);
  });
});
