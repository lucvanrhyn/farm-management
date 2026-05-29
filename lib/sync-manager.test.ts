/**
 * @vitest-environment node
 *
 * Issue #435 — sync-manager integration: 422 DUPLICATE_OBSERVATION
 * auto-resolve path.
 *
 * Contract pinned here:
 *   When `uploadObservation` returns HTTP 422 with body
 *   `{ error: "DUPLICATE_OBSERVATION", details: { existingId: "abc" } }`,
 *   the row transitions to `synced` state with `remoteId === "abc"` instead
 *   of landing in `failed`.
 *
 * The `uploadObservation` function is not directly exported; instead we test
 * `syncPendingObservations` — the queue-draining loop — with a mocked
 * `/api/observations` that returns the 422 duplicate body. The assertion is
 * that the row ends in `synced` (i.e. `markSucceeded` was called with the
 * existing id) rather than `failed`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock state ───────────────────────────────────────────────────────
// Shared between the vi.mock factory (which runs first, hoisted) and test
// bodies. Per feedback-vi-hoisted-shared-mocks.md: wrap in vi.hoisted().

const mocks = vi.hoisted(() => ({
  getPendingObservations: vi.fn(),
  // Issue #492 — explicit variadic signature so `markSucceeded.mock.calls[0]`
  // types as a populated tuple (the real `markSucceeded(kind, id, payload)`
  // takes three args). The zero-arg `async () => {}` form inferred an empty
  // tuple, breaking the `[kind, id, payload]` destructure under strict tsc.
  markSucceeded: vi.fn(async (..._args: unknown[]) => {}),
  markFailed: vi.fn(async () => {}),
  clearPendingAnimalUpdate: vi.fn(async () => {}),
  // Other offline-store exports used by syncPendingObservations indirectly.
  getPendingAnimalCreates: vi.fn(async () => []),
  getPendingPhotos: vi.fn(async () => []),
  getPendingCoverReadings: vi.fn(async () => []),
  markObservationSynced: vi.fn(async () => {}),
  getCachedFarmSettings: vi.fn(async () => null),
}));

vi.mock('./offline-store', () => ({
  getPendingObservations: mocks.getPendingObservations,
  clearPendingAnimalUpdate: mocks.clearPendingAnimalUpdate,
  markObservationSynced: mocks.markObservationSynced,
  getPendingAnimalCreates: mocks.getPendingAnimalCreates,
  getPendingPhotos: mocks.getPendingPhotos,
  getPendingCoverReadings: mocks.getPendingCoverReadings,
  getCachedFarmSettings: mocks.getCachedFarmSettings,
  getFailedObservations: vi.fn(async () => []),
  getFailedAnimals: vi.fn(async () => []),
  getFailedCoverReadings: vi.fn(async () => []),
  getFailedObservationsCount: vi.fn(async () => 0),
  getFailedAnimalCreatesCount: vi.fn(async () => 0),
  getFailedCoverReadingsCount: vi.fn(async () => 0),
  getFailedPhotosCount: vi.fn(async () => 0),
  markAnimalCreateSynced: vi.fn(async () => {}),
  markAnimalCreateFailed: vi.fn(async () => {}),
  markCoverReadingSynced: vi.fn(async () => {}),
  markCoverReadingFailed: vi.fn(async () => {}),
  markPhotoFailed: vi.fn(async () => {}),
  markPhotoSynced: vi.fn(async () => {}),
  getSyncMetadataValue: vi.fn(async () => null),
  setSyncMetadataValue: vi.fn(async () => {}),
  queueObservation: vi.fn(async () => 1),
  queueAnimalCreate: vi.fn(async () => 1),
  queueCoverReading: vi.fn(async () => 1),
  queuePhoto: vi.fn(async () => 1),
}));

vi.mock('./sync/queue', async (importOriginal) => {
  const original = await importOriginal<typeof import('./sync/queue')>();
  return {
    ...original,
    markSucceeded: mocks.markSucceeded,
    markFailed: mocks.markFailed,
    recordSyncAttempt: vi.fn(async () => {}),
  };
});

// Mock global fetch — tests provide per-test implementations.
const globalFetch = vi.fn();
vi.stubGlobal('fetch', globalFetch);

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePendingObs(overrides: Partial<{
  local_id: number;
  type: string;
  camp_id: string;
  clientLocalId: string;
}> = {}) {
  return {
    local_id: overrides.local_id ?? 42,
    type: overrides.type ?? 'camp_condition',
    camp_id: overrides.camp_id ?? 'camp-1',
    animal_id: undefined,
    details: '{"grazing_quality":"Good"}',
    created_at: '2026-05-27T08:00:00Z',
    synced_at: null,
    sync_status: 'pending' as const,
    attempts: 1,
    firstFailedAt: null,
    lastError: null,
    lastStatusCode: null,
    clientLocalId: overrides.clientLocalId ?? 'local-uuid-001',
  };
}

/** Build a Response-like object for fetch to return. */
function makeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: vi.fn(async () => body),
    text: vi.fn(async () => JSON.stringify(body)),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPendingAnimalCreates.mockResolvedValue([]);
  mocks.getPendingPhotos.mockResolvedValue([]);
  mocks.getPendingCoverReadings.mockResolvedValue([]);
});

describe('syncPendingObservations — 422 DUPLICATE_OBSERVATION auto-resolve', () => {
  it('row whose POST returns 422 DUPLICATE with existingId ends in synced state with remoteId === existingId', async () => {
    const obs = makePendingObs({ local_id: 7 });
    mocks.getPendingObservations.mockResolvedValueOnce([obs]);

    // Server returns: already logged today, here's the existing id
    globalFetch.mockResolvedValueOnce(
      makeResponse(422, {
        error: 'DUPLICATE_OBSERVATION',
        details: { existingId: 'srv-obs-abc' },
      }),
    );

    const { syncPendingObservations } = await import('./sync-manager');
    const result = await syncPendingObservations();

    // Should count as synced, not failed
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);

    // markSucceeded must have been called with the server's existingId
    expect(mocks.markSucceeded).toHaveBeenCalledOnce();
    const [kind, id, payload] = mocks.markSucceeded.mock.calls[0]!;
    expect(kind).toBe('observation');
    expect(id).toBe(7);
    // The payload must carry the remoteId (the existingId from the 422 body)
    expect((payload as { id: string }).id).toBe('srv-obs-abc');

    // markFailed must NOT have been called
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it('row whose POST returns 422 DUPLICATE WITHOUT existingId still lands in failed (malformed response)', async () => {
    const obs = makePendingObs({ local_id: 8 });
    mocks.getPendingObservations.mockResolvedValueOnce([obs]);

    globalFetch.mockResolvedValueOnce(
      makeResponse(422, {
        error: 'DUPLICATE_OBSERVATION',
        details: {}, // no existingId
      }),
    );

    const { syncPendingObservations } = await import('./sync-manager');
    const result = await syncPendingObservations();

    expect(result.synced).toBe(0);
    expect(result.failed).toBe(1);
    expect(mocks.markFailed).toHaveBeenCalledOnce();
    expect(mocks.markSucceeded).not.toHaveBeenCalled();
  });

  it('row whose POST returns 422 INVALID_TYPE still lands in failed (terminal)', async () => {
    const obs = makePendingObs({ local_id: 9, type: 'body_condition_score' });
    mocks.getPendingObservations.mockResolvedValueOnce([obs]);

    globalFetch.mockResolvedValueOnce(
      makeResponse(422, { error: 'INVALID_TYPE' }),
    );

    const { syncPendingObservations } = await import('./sync-manager');
    const result = await syncPendingObservations();

    expect(result.synced).toBe(0);
    expect(result.failed).toBe(1);
    expect(mocks.markFailed).toHaveBeenCalledOnce();
    expect(mocks.markSucceeded).not.toHaveBeenCalled();
  });

  it('row whose POST returns 500 lands in failed (retry path)', async () => {
    const obs = makePendingObs({ local_id: 10 });
    mocks.getPendingObservations.mockResolvedValueOnce([obs]);

    globalFetch.mockResolvedValueOnce(makeResponse(500, 'Internal Server Error'));

    const { syncPendingObservations } = await import('./sync-manager');
    const result = await syncPendingObservations();

    expect(result.synced).toBe(0);
    expect(result.failed).toBe(1);
    expect(mocks.markFailed).toHaveBeenCalledOnce();
  });
});
