// @vitest-environment node
/**
 * S9 / sync-M2 (stress-test remediation 2026-06-01) — the classified-but-
 * never-implemented `retry-with-cooldown` path.
 *
 * Root cause pinned here: `classifySyncFailure` returns
 * `retry-with-cooldown` for transient failures (5xx / network / 429), but no
 * cooldown machinery existed anywhere — a failed row sat in the #208 failed
 * bucket until the user manually pressed "Retry all". `prepareAutoDrain`
 * implements the automatic half: failed rows whose per-attempt exponential
 * cooldown has elapsed are re-armed (flipped back to `pending`) so the next
 * drain retries them, while the OBS-1 budget seam (`isTerminalFailure` /
 * `MAX_SYNC_ATTEMPTS`, shipped 64d27dd) still dead-letters poison rows.
 *
 * Contract pinned by this suite:
 *   1. `computeRetryCooldownMs` doubles per attempt from the base, capped.
 *   2. A cooled transient failure is re-armed; the in-memory failure clock
 *      (anchored when the drain marks the row failed) gates rows that
 *      failed recently, falling back to the persisted `firstFailedAt`.
 *   3. Terminal rows (terminal status OR attempts >= MAX_SYNC_ATTEMPTS) are
 *      NEVER re-armed — no OBS-1 regression.
 *   4. `pendingCount` reports post-re-arm queued work so the auto-drain
 *      caller can decide whether a sync cycle is worth running.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FailedRowFixture {
  local_id: number;
  attempts: number;
  lastError: string | null;
  firstFailedAt: number | null;
  lastStatusCode: number | null;
  sync_status: 'pending' | 'failed';
  [key: string]: unknown;
}

const state = vi.hoisted(() => ({
  observations: [] as FailedRowFixture[],
  animals: [] as FailedRowFixture[],
  covers: [] as FailedRowFixture[],
}));

const flips = vi.hoisted(() => ({
  observation: [] as number[],
  animal: [] as number[],
  cover: [] as number[],
}));

vi.mock('@/lib/offline-store', async (importOriginal) => {
  // Keep the OBS-1 budget seam REAL: `isTerminalFailure` is the pure
  // single-enforcement function the re-arm pass must consult; stubbing it
  // would let the test pass while the production gate regressed.
  const actual = await importOriginal<typeof import('@/lib/offline-store')>();
  const byStatus = (rows: FailedRowFixture[], status: 'pending' | 'failed') =>
    rows.filter((r) => r.sync_status === status);
  return {
    isTerminalFailure: actual.isTerminalFailure,
    MAX_SYNC_ATTEMPTS: actual.MAX_SYNC_ATTEMPTS,
    seedCamps: vi.fn(async () => {}),
    seedCampsForMode: vi.fn(async () => {}),
    seedAnimals: vi.fn(async () => {}),
    seedFarmSettings: vi.fn(async () => {}),
    getCachedFarmSettings: vi.fn(async () => null),
    getPendingObservations: vi.fn(async () => byStatus(state.observations, 'pending')),
    getPendingAnimalCreates: vi.fn(async () => byStatus(state.animals, 'pending')),
    getPendingCoverReadings: vi.fn(async () => byStatus(state.covers, 'pending')),
    getPendingPhotos: vi.fn(async () => []),
    getFailedObservations: vi.fn(async () => byStatus(state.observations, 'failed')),
    getFailedAnimals: vi.fn(async () => byStatus(state.animals, 'failed')),
    getFailedCoverReadings: vi.fn(async () => byStatus(state.covers, 'failed')),
    markObservationSynced: vi.fn(async () => {}),
    // Mirrors `applyFailureMeta`: failure flips status and bumps attempts.
    markObservationFailed: vi.fn(
      async (localId: number, meta: { statusCode: number | null; error: string }) => {
        const row = state.observations.find((r) => r.local_id === localId);
        if (!row) return;
        row.sync_status = 'failed';
        row.attempts += 1;
        row.lastStatusCode = meta.statusCode;
        row.lastError = meta.error;
        row.firstFailedAt = row.firstFailedAt ?? 0;
      },
    ),
    markObservationPending: vi.fn(async (localId: number) => {
      flips.observation.push(localId);
      const row = state.observations.find((r) => r.local_id === localId);
      if (row) row.sync_status = 'pending';
    }),
    markAnimalCreatePending: vi.fn(async (localId: number) => {
      flips.animal.push(localId);
      const row = state.animals.find((r) => r.local_id === localId);
      if (row) row.sync_status = 'pending';
    }),
    markCoverReadingPending: vi.fn(async (localId: number) => {
      flips.cover.push(localId);
      const row = state.covers.find((r) => r.local_id === localId);
      if (row) row.sync_status = 'pending';
    }),
    markPhotoUploaded: vi.fn(async () => {}),
    markCoverReadingPosted: vi.fn(async () => {}),
    clearPendingAnimalUpdate: vi.fn(async () => {}),
  };
});

vi.mock('@/lib/sync/queue', () => ({
  markSucceeded: vi.fn(async () => {}),
  // The facade routes to the per-kind offline-store writer; mirror the
  // `applyFailureMeta` transition into the fixture state so the drain's
  // failure path is observable (this suite only drains observations).
  markFailed: vi.fn(
    async (
      kind: string,
      localId: number,
      _reason: string,
      meta?: { statusCode: number | null; error: string },
    ) => {
      if (kind !== 'observation') return;
      const row = state.observations.find((r) => r.local_id === localId);
      if (!row) return;
      row.sync_status = 'failed';
      row.attempts += 1;
      row.lastStatusCode = meta?.statusCode ?? null;
      row.lastError = meta?.error ?? null;
      row.firstFailedAt = row.firstFailedAt ?? 0;
    },
  ),
  recordSyncAttempt: vi.fn(async () => {}),
}));

function failedRow(overrides: Partial<FailedRowFixture>): FailedRowFixture {
  return {
    local_id: 1,
    attempts: 1,
    lastError: 'HTTP 500',
    firstFailedAt: 0,
    lastStatusCode: 500,
    sync_status: 'failed',
    type: 'weighing',
    camp_id: 'camp-1',
    details: '{}',
    created_at: '2026-06-01T00:00:00.000Z',
    synced_at: null,
    ...overrides,
  };
}

beforeEach(async () => {
  state.observations.length = 0;
  state.animals.length = 0;
  state.covers.length = 0;
  flips.observation.length = 0;
  flips.animal.length = 0;
  flips.cover.length = 0;
  const { resetRetryClockForTests } = await import('@/lib/sync-manager');
  resetRetryClockForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('computeRetryCooldownMs — exponential backoff schedule', () => {
  it('doubles per attempt from the base and caps', async () => {
    const { computeRetryCooldownMs, RETRY_BACKOFF_BASE_MS, RETRY_BACKOFF_CAP_MS } =
      await import('@/lib/sync-manager');
    expect(computeRetryCooldownMs(1)).toBe(RETRY_BACKOFF_BASE_MS);
    expect(computeRetryCooldownMs(2)).toBe(RETRY_BACKOFF_BASE_MS * 2);
    expect(computeRetryCooldownMs(3)).toBe(RETRY_BACKOFF_BASE_MS * 4);
    expect(computeRetryCooldownMs(4)).toBe(RETRY_BACKOFF_BASE_MS * 8);
    expect(computeRetryCooldownMs(99)).toBe(RETRY_BACKOFF_CAP_MS);
  });
});

describe('prepareAutoDrain — cooled transient failures re-arm', () => {
  it('re-arms a cooled 5xx observation row and reports the queued work', async () => {
    const { prepareAutoDrain, RETRY_BACKOFF_BASE_MS } = await import('@/lib/sync-manager');
    state.observations.push(
      failedRow({
        local_id: 11,
        attempts: 1,
        lastStatusCode: 500,
        firstFailedAt: Date.now() - (RETRY_BACKOFF_BASE_MS + 1_000),
      }),
    );

    const result = await prepareAutoDrain();

    expect(flips.observation).toEqual([11]);
    expect(result.rearmed).toBe(1);
    expect(result.pendingCount).toBe(1);
  });

  it('re-arms cooled animal-create and cover-reading rows through their own writers', async () => {
    const { prepareAutoDrain, RETRY_BACKOFF_BASE_MS } = await import('@/lib/sync-manager');
    const cooledSince = Date.now() - (RETRY_BACKOFF_BASE_MS + 1_000);
    state.animals.push(failedRow({ local_id: 21, firstFailedAt: cooledSince }));
    state.covers.push(failedRow({ local_id: 31, firstFailedAt: cooledSince }));

    const result = await prepareAutoDrain();

    expect(flips.animal).toEqual([21]);
    expect(flips.cover).toEqual([31]);
    expect(result.rearmed).toBe(2);
    expect(result.pendingCount).toBe(2);
  });

  it('holds a row that failed THIS session until its cooldown elapses (in-memory clock beats stale firstFailedAt)', async () => {
    const { syncPendingObservations, prepareAutoDrain, RETRY_BACKOFF_BASE_MS } =
      await import('@/lib/sync-manager');

    // A pending row whose upload 500s — the drain marks it failed and the
    // failure clock anchors "now". The mock deliberately persists an ANCIENT
    // firstFailedAt (0) so an implementation that only consulted the
    // persisted field would re-arm immediately and fail this test.
    state.observations.push(
      failedRow({ local_id: 41, attempts: 0, sync_status: 'pending', firstFailedAt: null }),
    );
    globalThis.fetch = vi.fn(async () =>
      new Response('upstream exploded', { status: 500 }),
    ) as typeof fetch;

    await syncPendingObservations();
    expect(state.observations[0].sync_status).toBe('failed');
    expect(state.observations[0].attempts).toBe(1);

    // Immediately after the failure: still cooling — no re-arm.
    const tooSoon = await prepareAutoDrain(Date.now());
    expect(flips.observation).toEqual([]);
    expect(tooSoon.rearmed).toBe(0);
    expect(tooSoon.pendingCount).toBe(0);

    // After the first-attempt cooldown: re-armed.
    const cooled = await prepareAutoDrain(Date.now() + RETRY_BACKOFF_BASE_MS + 1_000);
    expect(flips.observation).toEqual([41]);
    expect(cooled.rearmed).toBe(1);
    expect(cooled.pendingCount).toBe(1);
  });

  it('never re-arms terminal rows — budget-exhausted or terminal-status (OBS-1 seam intact)', async () => {
    const { prepareAutoDrain } = await import('@/lib/sync-manager');
    state.observations.push(
      // Attempts budget exhausted (MAX_SYNC_ATTEMPTS) on a transient status.
      failedRow({ local_id: 51, attempts: 5, lastStatusCode: 500, firstFailedAt: 0 }),
      // Terminal-by-status 404 with plenty of budget left.
      failedRow({ local_id: 52, attempts: 1, lastStatusCode: 404, firstFailedAt: 0 }),
    );

    const result = await prepareAutoDrain();

    expect(flips.observation).toEqual([]);
    expect(result.rearmed).toBe(0);
    expect(result.pendingCount).toBe(0);
  });
});
