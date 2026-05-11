// @vitest-environment node
/**
 * Wave 195 / PRD #194 — coordinator-level truth invariant.
 *
 * What this test pins:
 *   After `syncAndRefresh` runs one cycle, the SyncTruth returned by
 *   `getCurrentSyncTruth()` must reflect the cycle's outcome correctly:
 *
 *     - All four kinds succeeded   → lastFullSuccessAt ticks to cycle time.
 *     - Any kind had a failure     → lastAttemptAt ticks, lastFullSuccessAt does NOT.
 *     - No queued rows / all GETs  → cache pull alone counts as full-success cycle.
 *
 *   This is the structural fix for Codex C1/C3: the coordinator no longer
 *   relies on a remembered `tickLastSyncedAt` boolean. The single
 *   `recordSyncAttempt` call inside `syncAndRefresh` is the only place a
 *   timestamp can tick, and it derives full-success from per-kind results.
 *
 *   We mock /api/observations to return a 422 to simulate the original
 *   "every queued observation failed" scenario from C1, and assert that the
 *   resulting SyncTruth reports lastFullSuccessAt === null.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stub the IDB-backed offline-store completely so this stays a node-env test.
const pendingObservationsMock = vi.fn(async () => [] as unknown[]);
const pendingAnimalsMock = vi.fn(async () => [] as unknown[]);
const pendingCoversMock = vi.fn(async () => [] as unknown[]);
const pendingPhotosMock = vi.fn(async () => [] as unknown[]);

// In-memory metadata so the queue facade has somewhere to persist truth.
const memMetadata = new Map<string, string>();

vi.mock('@/lib/offline-store', () => ({
  // Pending readers — drive each cycle's behaviour from the mock.
  getPendingObservations: pendingObservationsMock,
  getPendingAnimalCreates: pendingAnimalsMock,
  getPendingCoverReadings: pendingCoversMock,
  getPendingPhotos: pendingPhotosMock,
  // Failure-count readers — needed by getCurrentSyncTruth.
  getFailedObservationsCount: vi.fn(async () => 0),
  getFailedAnimalCreatesCount: vi.fn(async () => 0),
  getFailedCoverReadingsCount: vi.fn(async () => 0),
  getFailedPhotosCount: vi.fn(async () => 0),
  // Truth metadata read/write (new helpers from this wave).
  getSyncMetadataValue: vi.fn(async (key: string) => memMetadata.get(key) ?? null),
  setSyncMetadataValue: vi.fn(async (key: string, value: string) => {
    memMetadata.set(key, value);
  }),
  // Row-status mutators.
  markObservationSynced: vi.fn(async () => {}),
  markObservationFailed: vi.fn(async () => {}),
  markAnimalCreateSynced: vi.fn(async () => {}),
  markAnimalCreateFailed: vi.fn(async () => {}),
  markPhotoSynced: vi.fn(async () => {}),
  markPhotoUploaded: vi.fn(async () => {}),
  markPhotoFailed: vi.fn(async () => {}),
  markCoverReadingSynced: vi.fn(async () => {}),
  markCoverReadingFailed: vi.fn(async () => {}),
  markCoverReadingPosted: vi.fn(async () => {}),
  clearPendingAnimalUpdate: vi.fn(async () => {}),
  // Legacy compat: existing setLastSyncedAt still used by the UI in this wave.
  setLastSyncedAt: vi.fn(async () => {}),
  // Cache-pull seeders.
  seedCamps: vi.fn(async () => {}),
  seedAnimals: vi.fn(async () => {}),
  seedFarmSettings: vi.fn(async () => {}),
  getCachedFarmSettings: vi.fn(async () => null),
}));

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(responder: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    return responder(url, init);
  }) as typeof fetch;
}

function pendingObservation(localId: number) {
  return {
    local_id: localId,
    type: 'weighing',
    camp_id: 'camp-1',
    animal_id: null,
    details: '{}',
    created_at: '2026-05-11T10:00:00.000Z',
    sync_status: 'pending' as const,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  memMetadata.clear();
  pendingObservationsMock.mockReset();
  pendingAnimalsMock.mockReset();
  pendingCoversMock.mockReset();
  pendingPhotosMock.mockReset();
  pendingObservationsMock.mockResolvedValue([]);
  pendingAnimalsMock.mockResolvedValue([]);
  pendingCoversMock.mockResolvedValue([]);
  pendingPhotosMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('syncAndRefresh → SyncTruth invariant', () => {
  it('all queued observations fail → lastFullSuccessAt stays null, lastAttemptAt ticks', async () => {
    pendingObservationsMock.mockResolvedValue([
      pendingObservation(1),
      pendingObservation(2),
    ]);

    mockFetch((url) => {
      if (url === '/api/observations') {
        return new Response(JSON.stringify({ error: 'INVALID_TYPE' }), {
          status: 422,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/camps') return jsonOk([]);
      if (url === '/api/camps/status') return jsonOk({});
      if (url === '/api/farm') return jsonOk({ farmName: 'Test', breed: 'Boran' });
      if (url.startsWith('/api/animals')) {
        return jsonOk({ items: [], nextCursor: null, hasMore: false });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const { syncAndRefresh } = await import('@/lib/sync-manager');
    const { getCurrentSyncTruth } = await import('@/lib/sync/queue');

    const result = await syncAndRefresh();
    expect(result.failed).toBe(2);
    expect(result.synced).toBe(0);

    const truth = await getCurrentSyncTruth();
    expect(truth.lastAttemptAt).not.toBeNull();
    expect(truth.lastFullSuccessAt).toBeNull();
  });

  it('partial success → lastAttemptAt ticks, lastFullSuccessAt stays null (one kind had a failure)', async () => {
    pendingObservationsMock.mockResolvedValue([
      pendingObservation(1),
      pendingObservation(2),
    ]);

    let post = 0;
    mockFetch((url) => {
      if (url === '/api/observations') {
        post++;
        if (post === 1) return jsonOk({ id: 'srv-1' });
        return new Response(JSON.stringify({ error: 'INVALID_TYPE' }), {
          status: 422,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/camps') return jsonOk([]);
      if (url === '/api/camps/status') return jsonOk({});
      if (url === '/api/farm') return jsonOk({ farmName: 'Test', breed: 'Boran' });
      if (url.startsWith('/api/animals')) {
        return jsonOk({ items: [], nextCursor: null, hasMore: false });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const { syncAndRefresh } = await import('@/lib/sync-manager');
    const { getCurrentSyncTruth } = await import('@/lib/sync/queue');

    const result = await syncAndRefresh();
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);

    const truth = await getCurrentSyncTruth();
    expect(truth.lastAttemptAt).not.toBeNull();
    // Crucial invariant: partial success is NOT full success.
    // (legacy setLastSyncedAt still ticks for backward-compat; the new
    // SyncTruth surface tells the truth.)
    expect(truth.lastFullSuccessAt).toBeNull();
  });

  it('no queued rows + all GETs succeed → counts as full-success cycle', async () => {
    // Queue empty for every kind.
    mockFetch((url) => {
      if (url === '/api/camps') return jsonOk([]);
      if (url === '/api/camps/status') return jsonOk({});
      if (url === '/api/farm') return jsonOk({ farmName: 'Test', breed: 'Boran' });
      if (url.startsWith('/api/animals')) {
        return jsonOk({ items: [], nextCursor: null, hasMore: false });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const { syncAndRefresh } = await import('@/lib/sync-manager');
    const { getCurrentSyncTruth } = await import('@/lib/sync/queue');

    const result = await syncAndRefresh();
    expect(result.failed).toBe(0);
    expect(result.synced).toBe(0);

    const truth = await getCurrentSyncTruth();
    expect(truth.lastAttemptAt).not.toBeNull();
    expect(truth.lastFullSuccessAt).not.toBeNull();
  });
});
