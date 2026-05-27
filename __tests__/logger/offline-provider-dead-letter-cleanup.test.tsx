// @vitest-environment jsdom
/**
 * Issue #449 — OfflineProvider must invoke the v2 generalized
 * `runDeadLetterCleanup` on mount, not the legacy v1
 * `cleanupPreFixBcsDeadLetters`.
 *
 * Root cause this pins:
 *   PR #444 introduced `runDeadLetterCleanup` (class A: pre-fix BCS
 *   `INVALID_TYPE` + class B: terminal `DUPLICATE_OBSERVATION` rows >6h old)
 *   in `lib/offline-bcs-dead-letter-cleanup.ts` but never updated
 *   `OfflineProvider.tsx` to call it. The provider stayed on the legacy v1
 *   driver which only handles class A. The 2026-05-27 stress test left a
 *   stuck DUPLICATE_OBSERVATION row in Trio Logger that v2 would auto-clear
 *   on next mount.
 *
 * Contract pinned here:
 *   - On mount, the provider calls `runDeadLetterCleanup` exactly once.
 *   - The provider does NOT call the deprecated `cleanupPreFixBcsDeadLetters`.
 *
 * Why this lives in a dedicated test file: the other OfflineProvider tests
 * mock `@/lib/offline-bcs-dead-letter-cleanup` implicitly (via Vitest's
 * default module-resolution) but do not assert on the wire-up. This file
 * adds the assertion without touching the existing fixtures.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import React from 'react';

const navState: { farmSlug: string } = { farmSlug: 'delta-livestock' };
vi.mock('next/navigation', () => ({
  usePathname: () => `/${navState.farmSlug}/logger`,
}));

const cleanupMocks = vi.hoisted(() => ({
  runDeadLetterCleanup: vi.fn(async () => ({ removed: 0 })),
  cleanupPreFixBcsDeadLetters: vi.fn(async () => ({ removed: 0 })),
}));

vi.mock('@/lib/offline-bcs-dead-letter-cleanup', () => ({
  runDeadLetterCleanup: cleanupMocks.runDeadLetterCleanup,
  // Stub kept so any straggling import in the provider would resolve, but the
  // wire-up assertion below proves the production code path does NOT call it.
  cleanupPreFixBcsDeadLetters: cleanupMocks.cleanupPreFixBcsDeadLetters,
  isPreFixBcsDeadLetter: vi.fn(),
  isTerminalDuplicateDeadLetter: vi.fn(),
}));

let stubEpoch = 0;
vi.mock('@/lib/offline-store', () => ({
  getCachedCamps: vi.fn(async () => []),
  getCachedFarmSettings: vi.fn(async () => null),
  setActiveFarmSlug: vi.fn(() => {
    stubEpoch += 1;
  }),
  getFarmEpoch: vi.fn(() => stubEpoch),
  getCachedCampsForEpoch: vi.fn(async () => []),
  getCachedFarmSettingsForEpoch: vi.fn(async () => null),
}));

vi.mock('@/lib/sync/queue', () => ({
  getCurrentSyncTruth: vi.fn(async () => ({
    pendingCount: 0,
    failedCount: 0,
    lastAttemptAt: new Date().toISOString(),
    lastFullSuccessAt: new Date().toISOString(),
  })),
}));

vi.mock('@/lib/sync-manager', () => ({
  refreshCachedData: vi.fn(async () => {}),
  syncAndRefresh: vi.fn(async () => ({ synced: 0, failed: 0 })),
}));

import { OfflineProvider } from '@/components/logger/OfflineProvider';

beforeEach(() => {
  navState.farmSlug = 'delta-livestock';
  stubEpoch = 0;
  cleanupMocks.runDeadLetterCleanup.mockClear();
  cleanupMocks.runDeadLetterCleanup.mockResolvedValue({ removed: 0 });
  cleanupMocks.cleanupPreFixBcsDeadLetters.mockClear();
  globalThis.fetch = vi.fn(async () =>
    new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }),
  ) as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OfflineProvider — boot-time dead-letter cleanup wire-up (#449)', () => {
  it('invokes runDeadLetterCleanup (v2) on mount', async () => {
    await act(async () => {
      render(
        <OfflineProvider>
          <div data-testid="probe" />
        </OfflineProvider>,
      );
      // Let the mount effect's fire-and-forget cleanup .then chain run.
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(cleanupMocks.runDeadLetterCleanup).toHaveBeenCalledTimes(1);
    });
  });

  it('does NOT invoke the legacy cleanupPreFixBcsDeadLetters (v1)', async () => {
    await act(async () => {
      render(
        <OfflineProvider>
          <div data-testid="probe" />
        </OfflineProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Class-B (DUPLICATE_OBSERVATION) rows would never clear if the provider
    // stayed on v1 — the regression this issue pins.
    expect(cleanupMocks.cleanupPreFixBcsDeadLetters).not.toHaveBeenCalled();
  });
});
