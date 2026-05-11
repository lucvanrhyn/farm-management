/**
 * Regression test for the cover-reading photo silent-drop bug.
 *
 * Bug location: lib/sync-manager.ts:346-369 (`syncPendingCoverReadings`).
 *
 * The original control flow had `if (uploadRes.ok) { ... }` with no `else`
 * branch. When the photo-upload POST returned a non-2xx response, the
 * `if` block was skipped entirely and execution fell through to
 * `markCoverReadingSynced(...)` at line 369, deleting the photo from the
 * pending queue with no retry, no failure surface, and no log.
 *
 * Correct behaviour: on `uploadRes.ok === false`, the cover-reading row
 * must be marked failed so the photo retries on the next sync cycle, and
 * the failure must surface (counted in `failed`, not `synced`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── offline-store mock surface ──────────────────────────────────────────────

const markCoverReadingSyncedMock = vi.fn(async () => {});
const markCoverReadingFailedMock = vi.fn(async () => {});
const markCoverReadingPostedMock = vi.fn(async () => {});
const getPendingCoverReadingsMock = vi.fn(async () => [] as unknown[]);

vi.mock('@/lib/offline-store', () => ({
  // Surface used by syncPendingCoverReadings:
  getPendingCoverReadings: getPendingCoverReadingsMock,
  markCoverReadingSynced: markCoverReadingSyncedMock,
  markCoverReadingFailed: markCoverReadingFailedMock,
  markCoverReadingPosted: markCoverReadingPostedMock,
  // Other surfaces touched indirectly by importing the module:
  getPendingObservations: vi.fn(async () => []),
  markObservationSynced: vi.fn(),
  markObservationFailed: vi.fn(),
  getPendingAnimalCreates: vi.fn(async () => []),
  markAnimalCreateSynced: vi.fn(),
  markAnimalCreateFailed: vi.fn(),
  getPendingPhotos: vi.fn(async () => []),
  markPhotoSynced: vi.fn(),
  markPhotoFailed: vi.fn(),
  markPhotoUploaded: vi.fn(),
  seedCamps: vi.fn(),
  seedAnimals: vi.fn(),
  seedFarmSettings: vi.fn(),
  getCachedFarmSettings: vi.fn(async () => null),
  clearPendingAnimalUpdate: vi.fn(),
}));

// ── fetch mock ──────────────────────────────────────────────────────────────

type FetchCall = { url: string; init?: RequestInit };
const fetchCalls: FetchCall[] = [];

function mockFetch(responder: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetchCalls.push({ url, init });
    return responder(url);
  }) as typeof fetch;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchCalls.length = 0;
  markCoverReadingSyncedMock.mockClear();
  markCoverReadingFailedMock.mockClear();
  markCoverReadingPostedMock.mockClear();
  getPendingCoverReadingsMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── shared helpers ──────────────────────────────────────────────────────────

function pendingReadingWithPhoto() {
  // FormData in the SUT requires a Blob for `formData.append('file', blob, ...)`.
  const photoBlob = new Blob(['fake-jpeg'], { type: 'image/jpeg' });
  return {
    local_id: 1,
    farm_slug: 'test-farm',
    camp_id: 'camp-1',
    cover_category: 'Good' as const,
    created_at: '2026-05-04T00:00:00.000Z',
    photo_blob: photoBlob,
    sync_status: 'pending' as const,
  };
}

// ── tests ───────────────────────────────────────────────────────────────────

describe('syncPendingCoverReadings — photo upload failure', () => {
  it('keeps photo queued + counts failure when photo upload returns non-2xx', async () => {
    getPendingCoverReadingsMock.mockResolvedValue([pendingReadingWithPhoto()]);

    // POST /cover succeeds (so the reading gets a server id), but the photo
    // upload returns 500. This is the exact silent-drop scenario.
    mockFetch((url) => {
      if (url.endsWith('/cover')) {
        return new Response(JSON.stringify({ reading: { id: 'srv-1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/photos/upload') {
        return new Response('Internal Server Error', { status: 500 });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const { syncPendingCoverReadings } = await import('@/lib/sync-manager');
    const result = await syncPendingCoverReadings();

    // Failure must surface as a counted failure, not a silent success.
    expect(result.failed).toBe(1);
    expect(result.synced).toBe(0);

    // Reading row must NOT be marked synced — that's the silent-drop bug.
    expect(markCoverReadingSyncedMock).not.toHaveBeenCalled();

    // It must be marked failed so the next cycle retries the photo.
    expect(markCoverReadingFailedMock).toHaveBeenCalledWith(1);
  });
});
