// @vitest-environment node
/**
 * Issue #208 — sync-manager captures failure metadata.
 *
 * Before this wave, `sync-manager.ts` discarded the HTTP status + response body
 * on a non-2xx and the error message on a fetch throw. The user had no way to
 * know WHY a row was stuck — and the dead-letter UI (#209) needs that data.
 *
 * This file pins:
 *   - Non-2xx: markXFailed receives statusCode + truncated body.
 *   - Truncation: response bodies > 500 chars are sliced.
 *   - fetch throw: markXFailed receives statusCode: null + err.message.
 *   - firstFailedAt is set on the first failure and never overwritten.
 *   - attempts increments on every attempt (pass AND fail).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Capture every markObservationFailed / markObservationSynced call. Typed so
// `.mock.calls[i]` returns the right tuple shape for the assertion helpers.
type FailureCallArgs = [number, { statusCode: number | null; error: string }];
const markObservationFailedMock = vi.fn<(localId: number, meta: { statusCode: number | null; error: string }) => Promise<void>>(async () => {});
const markObservationSyncedMock = vi.fn<(localId: number) => Promise<void>>(async () => {});
const markAnimalCreateFailedMock = vi.fn<(localId: number, meta: { statusCode: number | null; error: string }) => Promise<void>>(async () => {});
const markAnimalCreateSyncedMock = vi.fn<(localId: number) => Promise<void>>(async () => {});

const getPendingObservationsMock = vi.fn(async () => [] as unknown[]);
const getPendingAnimalCreatesMock = vi.fn(async () => [] as unknown[]);

vi.mock('@/lib/offline-store', () => ({
  getPendingObservations: getPendingObservationsMock,
  getPendingAnimalCreates: getPendingAnimalCreatesMock,
  getPendingCoverReadings: vi.fn(async () => []),
  getPendingPhotos: vi.fn(async () => []),
  getFailedObservationsCount: vi.fn(async () => 0),
  getFailedAnimalCreatesCount: vi.fn(async () => 0),
  getFailedCoverReadingsCount: vi.fn(async () => 0),
  getFailedPhotosCount: vi.fn(async () => 0),
  markObservationSynced: markObservationSyncedMock,
  markObservationFailed: markObservationFailedMock,
  markAnimalCreateSynced: markAnimalCreateSyncedMock,
  markAnimalCreateFailed: markAnimalCreateFailedMock,
  markCoverReadingSynced: vi.fn(async () => {}),
  markCoverReadingFailed: vi.fn(async () => {}),
  markCoverReadingPosted: vi.fn(async () => {}),
  markPhotoSynced: vi.fn(async () => {}),
  markPhotoUploaded: vi.fn(async () => {}),
  markPhotoFailed: vi.fn(async () => {}),
  clearPendingAnimalUpdate: vi.fn(async () => {}),
  getSyncMetadataValue: vi.fn(async () => null),
  setSyncMetadataValue: vi.fn(async () => {}),
  seedCamps: vi.fn(async () => {}),
  seedAnimals: vi.fn(async () => {}),
  seedFarmSettings: vi.fn(async () => {}),
  getCachedFarmSettings: vi.fn(async () => ({ breed: 'Mixed' })),
}));

beforeEach(() => {
  vi.resetModules();
  markObservationFailedMock.mockClear();
  markObservationSyncedMock.mockClear();
  markAnimalCreateFailedMock.mockClear();
  markAnimalCreateSyncedMock.mockClear();
  getPendingObservationsMock.mockReset();
  getPendingAnimalCreatesMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('observation upload — non-2xx records statusCode + truncated body', () => {
  it('passes statusCode + body via markObservationFailed', async () => {
    getPendingObservationsMock.mockResolvedValue([
      {
        local_id: 1,
        type: 'camp_condition',
        camp_id: 'A',
        details: '{}',
        created_at: '',
        synced_at: null,
        sync_status: 'pending',
        attempts: 0,
      },
    ]);

    globalThis.fetch = vi.fn(async () =>
      new Response('boom — validation failed somewhere', {
        status: 422,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const { syncPendingObservations } = await import('@/lib/sync-manager');
    await syncPendingObservations();

    expect(markObservationFailedMock).toHaveBeenCalledTimes(1);
    const [localId, meta] = markObservationFailedMock.mock.calls[0] as unknown as FailureCallArgs;
    expect(localId).toBe(1);
    expect(meta.statusCode).toBe(422);
    expect(meta.error).toContain('validation failed');
  });
});

describe('response body > 500 chars is truncated', () => {
  it('passes a body sliced to 500 chars', async () => {
    const bigBody = 'x'.repeat(2000);
    getPendingObservationsMock.mockResolvedValue([
      {
        local_id: 1,
        type: 'camp_condition',
        camp_id: 'A',
        details: '{}',
        created_at: '',
        synced_at: null,
        sync_status: 'pending',
        attempts: 0,
      },
    ]);

    globalThis.fetch = vi.fn(async () =>
      new Response(bigBody, { status: 500, headers: { 'content-type': 'text/plain' } }),
    );

    const { syncPendingObservations } = await import('@/lib/sync-manager');
    await syncPendingObservations();

    expect(markObservationFailedMock).toHaveBeenCalledTimes(1);
    const meta = (markObservationFailedMock.mock.calls[0] as unknown as FailureCallArgs)[1];
    // Truncated to <= 500 chars to keep IDB rows sane.
    expect(meta.error.length).toBeLessThanOrEqual(500);
  });
});

describe('fetch throws — statusCode null + err.message recorded', () => {
  it('records the thrown error message and a null statusCode', async () => {
    getPendingObservationsMock.mockResolvedValue([
      {
        local_id: 1,
        type: 'camp_condition',
        camp_id: 'A',
        details: '{}',
        created_at: '',
        synced_at: null,
        sync_status: 'pending',
        attempts: 0,
      },
    ]);

    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('NetworkError: connection reset');
    });

    const { syncPendingObservations } = await import('@/lib/sync-manager');
    await syncPendingObservations();

    expect(markObservationFailedMock).toHaveBeenCalledTimes(1);
    const meta = (markObservationFailedMock.mock.calls[0] as unknown as FailureCallArgs)[1];
    expect(meta.statusCode).toBeNull();
    expect(meta.error).toContain('NetworkError');
  });
});

describe('animal upload — non-2xx records statusCode + truncated body', () => {
  // Symmetric to observations — we pin it here so a future refactor that
  // drops one path's failure metadata regresses loudly.
  it('passes statusCode + body via markAnimalCreateFailed', async () => {
    getPendingAnimalCreatesMock.mockResolvedValue([
      {
        local_id: 7,
        animal_id: 'KALF-1',
        sex: 'Female',
        category: 'Calf',
        current_camp: 'A',
        date_added: '2026-05-01',
        sync_status: 'pending',
        attempts: 0,
      },
    ]);

    globalThis.fetch = vi.fn(async () =>
      new Response('duplicate animal_id', {
        status: 409,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const { syncPendingAnimals } = await import('@/lib/sync-manager');
    await syncPendingAnimals();

    expect(markAnimalCreateFailedMock).toHaveBeenCalledTimes(1);
    const [localId, meta] = markAnimalCreateFailedMock.mock.calls[0] as unknown as FailureCallArgs;
    expect(localId).toBe(7);
    expect(meta.statusCode).toBe(409);
    expect(meta.error).toContain('duplicate');
  });
});

// The firstFailedAt + attempts behaviour is asserted at the offline-store
// integration level in `offline-store-pending-failed-split.test.ts` (which
// uses fake-indexeddb directly). This file pins only the sync-manager →
// offline-store boundary, where the markX mocks above let us assert that
// the structured `{ statusCode, error }` envelope is forwarded correctly.
