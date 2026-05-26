// @vitest-environment jsdom
/**
 * Issue #426 — one-time pre-fix BCS dead-letter cleanup.
 *
 * Root cause this drains: three `body_condition_score` observations queued
 * before PR #332 (commit `742cf32`, 2026-05-18) carry a payload the unified
 * observation-type registry now permanently rejects with HTTP 422
 * `INVALID_TYPE`. The sync queue's terminal-4xx policy keeps them stuck in
 * the failed bucket forever, producing visible "Failed: N" badges on the
 * affected devices (Basson Boerdery × 2, Trio B Boerdery × 1).
 *
 * Contract pinned here:
 *   - `isPreFixBcsDeadLetter` — pure predicate, ANDs four narrowing clauses
 *     (type / status / error / pre-fix cut-off) so a future regression that
 *     re-introduces 422-on-BCS can't be silently dropped by this cleanup.
 *   - `cleanupPreFixBcsDeadLetters` — boot-time driver. SSR-safe, idempotent
 *     via a localStorage flag, failure-isolated (never throws into the
 *     OfflineProvider mount path).
 *
 * Defense-in-depth: even if the predicate ever mis-fires, the underlying
 * `discardFailedObservation` is gated to terminal-4xx rows only, so the
 * blast radius is capped at the existing poison-row class.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted mock state so the factory and test bodies share the same handles.
const mocks = vi.hoisted(() => ({
  getFailedObservations: vi.fn(),
  discardFailedObservation: vi.fn(async () => {}),
}));

vi.mock('@/lib/offline-store', () => ({
  getFailedObservations: mocks.getFailedObservations,
  discardFailedObservation: mocks.discardFailedObservation,
}));

const FLAG_KEY = 'offline-cleanup-bcs-pre-fix-422-v1';

function makeRow(overrides: {
  type?: string;
  lastStatusCode?: number | null;
  lastError?: string | null;
  created_at?: string;
  local_id?: number;
}) {
  // `??` would clobber an explicit `null` — use `in` so the test can
  // exercise null status/error without the helper defaulting them away.
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

beforeEach(() => {
  mocks.getFailedObservations.mockReset();
  mocks.discardFailedObservation.mockReset();
  mocks.discardFailedObservation.mockResolvedValue(undefined);
  window.localStorage.clear();
});

describe('isPreFixBcsDeadLetter — pure predicate', () => {
  it('returns true when all four conditions hold', async () => {
    const { isPreFixBcsDeadLetter } = await import('@/lib/offline-bcs-dead-letter-cleanup');
    const row = makeRow({});
    expect(isPreFixBcsDeadLetter(row)).toBe(true);
  });

  it('returns false when type is not body_condition_score', async () => {
    const { isPreFixBcsDeadLetter } = await import('@/lib/offline-bcs-dead-letter-cleanup');
    const row = makeRow({ type: 'camp_condition' });
    expect(isPreFixBcsDeadLetter(row)).toBe(false);
  });

  it('returns false when status code is not 422', async () => {
    const { isPreFixBcsDeadLetter } = await import('@/lib/offline-bcs-dead-letter-cleanup');
    expect(isPreFixBcsDeadLetter(makeRow({ lastStatusCode: 400 }))).toBe(false);
    expect(isPreFixBcsDeadLetter(makeRow({ lastStatusCode: 500 }))).toBe(false);
    expect(isPreFixBcsDeadLetter(makeRow({ lastStatusCode: null }))).toBe(false);
  });

  it('returns false when lastError does not include INVALID_TYPE', async () => {
    const { isPreFixBcsDeadLetter } = await import('@/lib/offline-bcs-dead-letter-cleanup');
    expect(isPreFixBcsDeadLetter(makeRow({ lastError: 'VALIDATION_FAILED' }))).toBe(false);
    expect(isPreFixBcsDeadLetter(makeRow({ lastError: null }))).toBe(false);
    // Case-sensitive — wire format is uppercase.
    expect(isPreFixBcsDeadLetter(makeRow({ lastError: 'invalid_type' }))).toBe(false);
  });

  it('returns false when created_at is on or after the 2026-05-18T11:47:00Z cut-off', async () => {
    const { isPreFixBcsDeadLetter } = await import('@/lib/offline-bcs-dead-letter-cleanup');
    expect(isPreFixBcsDeadLetter(makeRow({ created_at: '2026-05-18T11:47:00Z' }))).toBe(false);
    expect(isPreFixBcsDeadLetter(makeRow({ created_at: '2026-05-18T11:47:01Z' }))).toBe(false);
    expect(isPreFixBcsDeadLetter(makeRow({ created_at: '2026-05-19T00:00:00Z' }))).toBe(false);
    // Boundary just before — still pre-fix, still a target.
    expect(isPreFixBcsDeadLetter(makeRow({ created_at: '2026-05-18T11:46:59Z' }))).toBe(true);
  });
});

describe('cleanupPreFixBcsDeadLetters — boot-time driver', () => {
  it('is a no-op when window is undefined (SSR guard)', async () => {
    // Simulate SSR by stubbing globalThis.window to undefined for one call.
    const originalWindow = (globalThis as { window?: Window }).window;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window;
    try {
      const { cleanupPreFixBcsDeadLetters } = await import('@/lib/offline-bcs-dead-letter-cleanup');
      const result = await cleanupPreFixBcsDeadLetters();
      expect(result).toEqual({ removed: 0 });
      expect(mocks.getFailedObservations).not.toHaveBeenCalled();
      expect(mocks.discardFailedObservation).not.toHaveBeenCalled();
    } finally {
      (globalThis as { window?: Window }).window = originalWindow;
    }
  });

  it('is a no-op when the localStorage flag is already set (idempotency)', async () => {
    window.localStorage.setItem(FLAG_KEY, 'done');
    const { cleanupPreFixBcsDeadLetters } = await import('@/lib/offline-bcs-dead-letter-cleanup');
    const result = await cleanupPreFixBcsDeadLetters();
    expect(result).toEqual({ removed: 0 });
    expect(mocks.getFailedObservations).not.toHaveBeenCalled();
    expect(mocks.discardFailedObservation).not.toHaveBeenCalled();
  });

  it('discards only the matching rows and sets the localStorage flag', async () => {
    mocks.getFailedObservations.mockResolvedValueOnce([
      // 2 pre-fix BCS dead-letters — should be discarded.
      makeRow({ local_id: 101, created_at: '2026-05-17T08:00:00Z' }),
      makeRow({ local_id: 102, created_at: '2026-05-18T09:00:00Z' }),
      // Post-fix BCS — same type/status/error but after the cut-off; spare it.
      makeRow({ local_id: 103, created_at: '2026-05-19T08:00:00Z' }),
      // Non-BCS terminal row (different cause) — leave alone.
      makeRow({
        local_id: 104,
        type: 'camp_condition',
        lastError: 'CAMP_CONDITION_FIELD_REQUIRED',
      }),
    ]);

    const { cleanupPreFixBcsDeadLetters } = await import('@/lib/offline-bcs-dead-letter-cleanup');
    const result = await cleanupPreFixBcsDeadLetters();

    expect(result).toEqual({ removed: 2 });
    expect(mocks.discardFailedObservation).toHaveBeenCalledTimes(2);
    expect(mocks.discardFailedObservation).toHaveBeenCalledWith(101);
    expect(mocks.discardFailedObservation).toHaveBeenCalledWith(102);
    expect(window.localStorage.getItem(FLAG_KEY)).toBe('done');
  });

  it('swallows errors from getFailedObservations and does NOT throw into the caller', async () => {
    mocks.getFailedObservations.mockRejectedValueOnce(new Error('IDB closed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { cleanupPreFixBcsDeadLetters } = await import('@/lib/offline-bcs-dead-letter-cleanup');
    const result = await cleanupPreFixBcsDeadLetters();

    expect(result).toEqual({ removed: 0 });
    expect(mocks.discardFailedObservation).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('BCS pre-fix dead-letter cleanup failed'),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
