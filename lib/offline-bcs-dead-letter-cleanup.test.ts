// @vitest-environment jsdom
/**
 * Issue #435 + Issue #457 — generalized dead-letter cleanup pass.
 *
 * This test file extends the existing predicate tests (in
 * `__tests__/offline/bcs-dead-letter-cleanup.test.ts`) with the new
 * `runDeadLetterCleanup` integration contract:
 *
 *   - A pre-fix BCS `INVALID_TYPE` row AND a `DUPLICATE_OBSERVATION` row (>6h
 *     old) both clear on a single `runDeadLetterCleanup()` call.
 *   - A fresh DUPLICATE row (queued within the last 6h) is left alone.
 *   - The BCS legacy predicate (`isPreFixBcsDeadLetter`) still works for the
 *     historical BCS rows that the old `cleanupPreFixBcsDeadLetters` targeted.
 *   - The new `isTerminalDuplicateDeadLetter` predicate identifies
 *     DUPLICATE_OBSERVATION rows older than 6h.
 *
 * Issue #457 — the boot-time driver previously short-circuited on a GLOBAL
 * (un-tenant-scoped) localStorage flag `offline-dead-letter-cleanup-v2`. In a
 * shared browser profile, once Farm A's mount ran the sweep and set the flag,
 * Farm B's eligible dead-letter rows were never drained — they sat behind a
 * permanent "Failed: N" pill. The fix removes the run-once short-circuit
 * entirely: `runDeadLetterCleanup` now runs the predicate-driven sweep on
 * EVERY invocation. This is safe and idempotent because `discardFailedObservation`
 * structurally deletes only terminal-4xx rows.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted mock state — shared between factory and test bodies.
const mocks = vi.hoisted(() => ({
  getFailedObservations: vi.fn(),
  discardFailedObservation: vi.fn(async () => {}),
}));

vi.mock('@/lib/offline-store', () => ({
  getFailedObservations: mocks.getFailedObservations,
  discardFailedObservation: mocks.discardFailedObservation,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A timestamp 8 hours ago (well past the 6h threshold). */
const OLD_CREATED_AT = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();

/** A timestamp 1 hour ago (within the 6h window — leave it alone). */
const FRESH_CREATED_AT = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

/**
 * Pre-fix BCS dead-letter row — the legacy class targeted by PR #332 /
 * Wave #426 cleanup. Created before 2026-05-18T11:47:00Z.
 */
function makeLegacyBcsRow(localId = 1) {
  return {
    local_id: localId,
    type: 'body_condition_score',
    camp_id: 'A',
    details: '{}',
    created_at: '2026-05-17T10:00:00Z', // before the BCS fix cutoff
    synced_at: null,
    sync_status: 'failed' as const,
    attempts: 3,
    firstFailedAt: 1715000000000,
    lastError: 'INVALID_TYPE: body_condition_score',
    lastStatusCode: 422,
  };
}

/**
 * DUPLICATE_OBSERVATION dead-letter row — the new class from #435.
 * `created_at` defaults to OLD_CREATED_AT (>6h ago), making it a cleanup
 * candidate. Pass `FRESH_CREATED_AT` to test the grace-window path.
 */
function makeDuplicateRow(localId = 2, createdAt = OLD_CREATED_AT) {
  return {
    local_id: localId,
    type: 'camp_condition',
    camp_id: 'B',
    details: '{"grazing_quality":"Good"}',
    created_at: createdAt,
    synced_at: null,
    sync_status: 'failed' as const,
    attempts: 2,
    firstFailedAt: Date.now() - 9 * 60 * 60 * 1000,
    lastError: '{"error":"DUPLICATE_OBSERVATION","details":{"existingId":"srv-99"}}',
    lastStatusCode: 422,
  };
}

/**
 * Issue #457 — a TRANSIENT (non-terminal) failed row that must NOT be drained:
 * a 5xx / network error is retryable. Even though it's old, neither predicate
 * matches it (status is not 422 and there's no DUPLICATE_OBSERVATION /
 * INVALID_TYPE wire error), so the sweep must leave it intact for retry.
 */
function makeTransientRow(localId = 3, statusCode: number | null = 503) {
  return {
    local_id: localId,
    type: 'camp_condition',
    camp_id: 'B',
    details: '{"grazing_quality":"Fair"}',
    created_at: OLD_CREATED_AT,
    synced_at: null,
    sync_status: 'failed' as const,
    attempts: 4,
    firstFailedAt: Date.now() - 9 * 60 * 60 * 1000,
    lastError: statusCode === null ? null : 'Service Unavailable',
    lastStatusCode: statusCode,
  };
}

beforeEach(() => {
  mocks.getFailedObservations.mockReset();
  mocks.discardFailedObservation.mockReset();
  mocks.discardFailedObservation.mockResolvedValue(undefined);
  window.localStorage.clear();
});

// ── isPreFixBcsDeadLetter predicate (class A) ─────────────────────────────────

/**
 * Class-A row factory mirroring the legacy v1 test fixture. Default values
 * produce a row that satisfies all four predicate clauses; per-test overrides
 * exercise each rejection branch.
 */
function makeBcsRow(overrides: {
  type?: string;
  lastStatusCode?: number | null;
  lastError?: string | null;
  created_at?: string;
  local_id?: number;
} = {}) {
  return {
    local_id: 'local_id' in overrides ? overrides.local_id! : 1,
    type: 'type' in overrides ? overrides.type! : 'body_condition_score',
    camp_id: 'A',
    details: '{}',
    created_at:
      'created_at' in overrides ? overrides.created_at! : '2026-05-17T10:00:00Z',
    synced_at: null,
    sync_status: 'failed' as const,
    attempts: 3,
    firstFailedAt: 1715000000000,
    lastError:
      'lastError' in overrides
        ? overrides.lastError!
        : 'INVALID_TYPE: body_condition_score',
    lastStatusCode:
      'lastStatusCode' in overrides ? overrides.lastStatusCode! : 422,
  };
}

describe('isPreFixBcsDeadLetter — pure predicate', () => {
  it('returns true when all four conditions hold', async () => {
    const { isPreFixBcsDeadLetter } = await import(
      '@/lib/offline-bcs-dead-letter-cleanup'
    );
    expect(isPreFixBcsDeadLetter(makeBcsRow())).toBe(true);
  });

  it('returns false when type is not body_condition_score', async () => {
    const { isPreFixBcsDeadLetter } = await import(
      '@/lib/offline-bcs-dead-letter-cleanup'
    );
    expect(isPreFixBcsDeadLetter(makeBcsRow({ type: 'camp_condition' }))).toBe(false);
  });

  it('returns false when status code is not 422', async () => {
    const { isPreFixBcsDeadLetter } = await import(
      '@/lib/offline-bcs-dead-letter-cleanup'
    );
    expect(isPreFixBcsDeadLetter(makeBcsRow({ lastStatusCode: 400 }))).toBe(false);
    expect(isPreFixBcsDeadLetter(makeBcsRow({ lastStatusCode: 500 }))).toBe(false);
    expect(isPreFixBcsDeadLetter(makeBcsRow({ lastStatusCode: null }))).toBe(false);
  });

  it('returns false when lastError does not include INVALID_TYPE', async () => {
    const { isPreFixBcsDeadLetter } = await import(
      '@/lib/offline-bcs-dead-letter-cleanup'
    );
    expect(isPreFixBcsDeadLetter(makeBcsRow({ lastError: 'VALIDATION_FAILED' }))).toBe(false);
    expect(isPreFixBcsDeadLetter(makeBcsRow({ lastError: null }))).toBe(false);
    // Case-sensitive — wire format is uppercase.
    expect(isPreFixBcsDeadLetter(makeBcsRow({ lastError: 'invalid_type' }))).toBe(false);
  });

  it('returns false when created_at is on or after the 2026-05-18T11:47:00Z cut-off', async () => {
    const { isPreFixBcsDeadLetter } = await import(
      '@/lib/offline-bcs-dead-letter-cleanup'
    );
    expect(isPreFixBcsDeadLetter(makeBcsRow({ created_at: '2026-05-18T11:47:00Z' }))).toBe(false);
    expect(isPreFixBcsDeadLetter(makeBcsRow({ created_at: '2026-05-18T11:47:01Z' }))).toBe(false);
    expect(isPreFixBcsDeadLetter(makeBcsRow({ created_at: '2026-05-19T00:00:00Z' }))).toBe(false);
    // Boundary just before — still pre-fix, still a target.
    expect(isPreFixBcsDeadLetter(makeBcsRow({ created_at: '2026-05-18T11:46:59Z' }))).toBe(true);
  });
});

// ── isTerminalDuplicateDeadLetter predicate ───────────────────────────────────

describe('isTerminalDuplicateDeadLetter — pure predicate', () => {
  it('returns true for a DUPLICATE_OBSERVATION row older than 6h', async () => {
    const { isTerminalDuplicateDeadLetter } = await import(
      '@/lib/offline-bcs-dead-letter-cleanup'
    );
    expect(isTerminalDuplicateDeadLetter(makeDuplicateRow(1, OLD_CREATED_AT))).toBe(true);
  });

  it('returns false for a DUPLICATE_OBSERVATION row created within 6h (grace window)', async () => {
    const { isTerminalDuplicateDeadLetter } = await import(
      '@/lib/offline-bcs-dead-letter-cleanup'
    );
    expect(isTerminalDuplicateDeadLetter(makeDuplicateRow(1, FRESH_CREATED_AT))).toBe(false);
  });

  it('returns false when status code is not 422', async () => {
    const { isTerminalDuplicateDeadLetter } = await import(
      '@/lib/offline-bcs-dead-letter-cleanup'
    );
    const row = { ...makeDuplicateRow(), lastStatusCode: 500 };
    expect(isTerminalDuplicateDeadLetter(row)).toBe(false);
  });

  it('returns false when lastError does not include DUPLICATE_OBSERVATION', async () => {
    const { isTerminalDuplicateDeadLetter } = await import(
      '@/lib/offline-bcs-dead-letter-cleanup'
    );
    const row = { ...makeDuplicateRow(), lastError: 'INVALID_TYPE: camp_condition' };
    expect(isTerminalDuplicateDeadLetter(row)).toBe(false);
  });

  it('returns false for a null lastError', async () => {
    const { isTerminalDuplicateDeadLetter } = await import(
      '@/lib/offline-bcs-dead-letter-cleanup'
    );
    const row = { ...makeDuplicateRow(), lastError: null };
    expect(isTerminalDuplicateDeadLetter(row)).toBe(false);
  });
});

// ── runDeadLetterCleanup — integration ────────────────────────────────────────

describe('runDeadLetterCleanup — generalized cleanup pass', () => {
  it('clears a legacy BCS row AND an old DUPLICATE row in one pass', async () => {
    mocks.getFailedObservations.mockResolvedValueOnce([
      makeLegacyBcsRow(101),
      makeDuplicateRow(102, OLD_CREATED_AT),
    ]);

    const { runDeadLetterCleanup } = await import('@/lib/offline-bcs-dead-letter-cleanup');
    const result = await runDeadLetterCleanup();

    expect(result.removed).toBe(2);
    expect(mocks.discardFailedObservation).toHaveBeenCalledTimes(2);
    expect(mocks.discardFailedObservation).toHaveBeenCalledWith(101);
    expect(mocks.discardFailedObservation).toHaveBeenCalledWith(102);
  });

  it('leaves a fresh DUPLICATE row (within 6h grace) untouched', async () => {
    mocks.getFailedObservations.mockResolvedValueOnce([
      makeDuplicateRow(200, FRESH_CREATED_AT),
    ]);

    const { runDeadLetterCleanup } = await import('@/lib/offline-bcs-dead-letter-cleanup');
    const result = await runDeadLetterCleanup();

    expect(result.removed).toBe(0);
    expect(mocks.discardFailedObservation).not.toHaveBeenCalled();
  });

  // ── Issue #457 — per-mount drain, no global run-once short-circuit ──────────

  it('drains eligible rows on EVERY call — no run-once suppression', async () => {
    // Simulate the same browser profile mounting the logger twice. The first
    // pass drains; the second pass — even though a global flag would have been
    // "set" by the old code — must still drain freshly-eligible rows.
    mocks.getFailedObservations
      .mockResolvedValueOnce([makeDuplicateRow(301, OLD_CREATED_AT)])
      .mockResolvedValueOnce([makeDuplicateRow(302, OLD_CREATED_AT)]);

    const { runDeadLetterCleanup } = await import('@/lib/offline-bcs-dead-letter-cleanup');

    const first = await runDeadLetterCleanup();
    expect(first.removed).toBe(1);
    expect(mocks.discardFailedObservation).toHaveBeenCalledWith(301);

    const second = await runDeadLetterCleanup();
    // The second invocation must re-walk IDB and drain again — the bug was a
    // global flag that made this a no-op.
    expect(second.removed).toBe(1);
    expect(mocks.getFailedObservations).toHaveBeenCalledTimes(2);
    expect(mocks.discardFailedObservation).toHaveBeenCalledWith(302);
  });

  it('a second farm in the same browser session still drains its own eligible rows', async () => {
    // Farm A's mount drains its dead-letter, "setting" what used to be a
    // global flag. Then the user switches to Farm B (Trio B) in the SAME
    // browser profile: Farm B's eligible rows must still drain — the #457 bug
    // was that the global flag suppressed Farm B's sweep entirely.
    const farmARow = makeDuplicateRow(401, OLD_CREATED_AT); // Farm A camp
    const farmBRow = { ...makeDuplicateRow(402, OLD_CREATED_AT), camp_id: 'TrioB-Camp' };

    mocks.getFailedObservations
      .mockResolvedValueOnce([farmARow])
      .mockResolvedValueOnce([farmBRow]);

    const { runDeadLetterCleanup } = await import('@/lib/offline-bcs-dead-letter-cleanup');

    // Farm A mount
    const farmA = await runDeadLetterCleanup();
    expect(farmA.removed).toBe(1);

    // Farm B mount in the same browser — must NOT be suppressed
    const farmB = await runDeadLetterCleanup();
    expect(farmB.removed).toBe(1);
    expect(mocks.discardFailedObservation).toHaveBeenCalledWith(402);
  });

  it('leaves transient (5xx / network / null-status) rows intact and retryable', async () => {
    mocks.getFailedObservations.mockResolvedValueOnce([
      makeTransientRow(500, 503), // 5xx — retryable
      makeTransientRow(501, null), // network error — retryable
      makeTransientRow(502, 429), // rate-limit — retryable
    ]);

    const { runDeadLetterCleanup } = await import('@/lib/offline-bcs-dead-letter-cleanup');
    const result = await runDeadLetterCleanup();

    expect(result.removed).toBe(0);
    expect(mocks.discardFailedObservation).not.toHaveBeenCalled();
  });

  it('is SSR-safe — returns { removed: 0 } when window is undefined', async () => {
    const originalWindow = (globalThis as { window?: Window }).window;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window;
    try {
      const { runDeadLetterCleanup } = await import('@/lib/offline-bcs-dead-letter-cleanup');
      const result = await runDeadLetterCleanup();
      expect(result).toEqual({ removed: 0 });
      expect(mocks.getFailedObservations).not.toHaveBeenCalled();
    } finally {
      (globalThis as { window?: Window }).window = originalWindow;
    }
  });

  it('swallows IDB errors and does NOT throw into the caller', async () => {
    mocks.getFailedObservations.mockRejectedValueOnce(new Error('IDB closed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { runDeadLetterCleanup } = await import('@/lib/offline-bcs-dead-letter-cleanup');
    const result = await runDeadLetterCleanup();

    expect(result).toEqual({ removed: 0 });
    expect(mocks.discardFailedObservation).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('dead-letter cleanup failed'),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
