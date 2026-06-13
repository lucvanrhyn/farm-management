// @vitest-environment node
/**
 * S9 / sync-M2 (stress-test remediation 2026-06-01) — client-side drain
 * throttle.
 *
 * Root cause pinned here: the drain loops POST queued rows back-to-back with
 * no client pacing, while `/api/observations` enforces a per-user limit of
 * 100 requests/minute (`checkRateLimit` in app/api/observations/route.ts).
 * A big reconnect drain therefore tripped the server limiter and turned the
 * tail of the queue into 429 failures, burning OBS-1 retry budget on rows
 * that were perfectly healthy.
 *
 * Contract pinned by this suite:
 *   1. `computeSyncThrottleDelayMs` is a pure sliding-window function: no
 *      delay below the client budget, and at the budget the delay is exactly
 *      "until the oldest in-window request ages out".
 *   2. The drain honors the budget end-to-end: a queue larger than
 *      `SYNC_REQUESTS_PER_WINDOW` pauses at the boundary and resumes after
 *      the window frees, instead of firing every request immediately.
 *   3. The client budget sits strictly below the server's 100/min limit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const pendingState = vi.hoisted(() => ({
  observations: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/offline-store', () => ({
  seedCamps: vi.fn(async () => {}),
  seedCampsForMode: vi.fn(async () => {}),
  seedAnimals: vi.fn(async () => {}),
  seedFarmSettings: vi.fn(async () => {}),
  getCachedFarmSettings: vi.fn(async () => null),
  getPendingObservations: vi.fn(async () => pendingState.observations),
  getPendingAnimalCreates: vi.fn(async () => []),
  getPendingCoverReadings: vi.fn(async () => []),
  getPendingPhotos: vi.fn(async () => []),
  getFailedObservations: vi.fn(async () => []),
  getFailedAnimals: vi.fn(async () => []),
  getFailedCoverReadings: vi.fn(async () => []),
  markObservationSynced: vi.fn(async () => {}),
  markObservationFailed: vi.fn(async () => {}),
  markObservationPending: vi.fn(async () => {}),
  markAnimalCreatePending: vi.fn(async () => {}),
  markCoverReadingPending: vi.fn(async () => {}),
  isTerminalFailure: vi.fn(() => false),
  markPhotoUploaded: vi.fn(async () => {}),
  markCoverReadingPosted: vi.fn(async () => {}),
  clearPendingAnimalUpdate: vi.fn(async () => {}),
}));

vi.mock('@/lib/sync/queue', () => ({
  markSucceeded: vi.fn(async () => {}),
  markFailed: vi.fn(async () => {}),
  recordSyncAttempt: vi.fn(async () => {}),
}));

function pendingObservation(localId: number): Record<string, unknown> {
  return {
    local_id: localId,
    type: 'weighing',
    camp_id: 'camp-1',
    details: '{}',
    created_at: '2026-06-01T00:00:00.000Z',
    synced_at: null,
    sync_status: 'pending',
    attempts: 0,
    lastError: null,
    firstFailedAt: null,
    lastStatusCode: null,
    clientLocalId: `clid-${localId}`,
  };
}

beforeEach(async () => {
  pendingState.observations.length = 0;
  const { resetSyncThrottleForTests } = await import('@/lib/sync-manager');
  resetSyncThrottleForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('computeSyncThrottleDelayMs — pure sliding window', () => {
  it('returns 0 below the client budget', async () => {
    const { computeSyncThrottleDelayMs, SYNC_REQUESTS_PER_WINDOW } =
      await import('@/lib/sync-manager');
    const now = 1_000_000;
    expect(computeSyncThrottleDelayMs([], now)).toBe(0);
    const nearlyFull = Array.from(
      { length: SYNC_REQUESTS_PER_WINDOW - 1 },
      (_, i) => now - i,
    );
    expect(computeSyncThrottleDelayMs(nearlyFull, now)).toBe(0);
  });

  it('at the budget, waits exactly until the oldest in-window request ages out', async () => {
    const {
      computeSyncThrottleDelayMs,
      SYNC_REQUESTS_PER_WINDOW,
      SYNC_RATE_WINDOW_MS,
    } = await import('@/lib/sync-manager');
    const now = 1_000_000;
    const oldestAge = 10_000;
    const starts = Array.from({ length: SYNC_REQUESTS_PER_WINDOW }, (_, i) =>
      i === 0 ? now - oldestAge : now - 1,
    );
    expect(computeSyncThrottleDelayMs(starts, now)).toBe(
      SYNC_RATE_WINDOW_MS - oldestAge,
    );
  });

  it('ignores request starts that already aged out of the window', async () => {
    const {
      computeSyncThrottleDelayMs,
      SYNC_REQUESTS_PER_WINDOW,
      SYNC_RATE_WINDOW_MS,
    } = await import('@/lib/sync-manager');
    const now = 10_000_000;
    const stale = Array.from(
      { length: SYNC_REQUESTS_PER_WINDOW * 2 },
      () => now - SYNC_RATE_WINDOW_MS - 1,
    );
    expect(computeSyncThrottleDelayMs(stale, now)).toBe(0);
  });

  it('keeps the client budget strictly below the server 100/min limit', async () => {
    const { SYNC_REQUESTS_PER_WINDOW, SYNC_RATE_WINDOW_MS } =
      await import('@/lib/sync-manager');
    const SERVER_OBSERVATIONS_LIMIT_PER_MIN = 100; // app/api/observations/route.ts
    expect(SYNC_RATE_WINDOW_MS).toBe(60_000);
    expect(SYNC_REQUESTS_PER_WINDOW).toBeLessThan(SERVER_OBSERVATIONS_LIMIT_PER_MIN);
  });
});

describe('drain pacing — a large reconnect drain stays under the budget', () => {
  it('pauses at the window boundary and resumes once the window frees', async () => {
    vi.useFakeTimers();
    const { syncPendingObservations, SYNC_REQUESTS_PER_WINDOW, SYNC_RATE_WINDOW_MS } =
      await import('@/lib/sync-manager');

    const total = SYNC_REQUESTS_PER_WINDOW + 2;
    for (let i = 1; i <= total; i++) {
      pendingState.observations.push(pendingObservation(i));
    }

    let posts = 0;
    globalThis.fetch = vi.fn(async () => {
      posts++;
      return new Response(JSON.stringify({ id: `srv-${posts}` }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const drain = syncPendingObservations();

    // Flush microtasks without advancing the clock: the drain must stop at
    // the client budget, NOT fire all rows back-to-back (the pre-fix bug).
    await vi.advanceTimersByTimeAsync(0);
    expect(posts).toBe(SYNC_REQUESTS_PER_WINDOW);

    // Once the window frees, the remaining rows go out.
    await vi.advanceTimersByTimeAsync(SYNC_RATE_WINDOW_MS);
    const result = await drain;
    expect(posts).toBe(total);
    expect(result.synced).toBe(total);
    expect(result.failed).toBe(0);
  });
});
