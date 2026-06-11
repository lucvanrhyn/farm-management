// @vitest-environment jsdom
/**
 * S9 / sync-M1 (stress-test remediation 2026-06-01) — automatic queue drain.
 *
 * Root cause pinned here: the queue drained ONLY on the `online` event or a
 * manual sync press. A tab that stayed online-but-idle (or transient
 * failures re-armed by the S9 backoff pass) could sit queued for hours with
 * no automatic path to the server.
 *
 * Contract pinned by this suite:
 *   1. On a periodic tick the provider runs `prepareAutoDrain` (the backoff
 *      re-arm pass) and triggers a full sync cycle IFF it reports queued
 *      work — an idle tab with an empty queue costs one IDB read per tick,
 *      not a network fan-out.
 *   2. Returning to a visible tab triggers the same tick without waiting
 *      for the next interval.
 *   3. A hidden tab is never drained in the background.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import React from 'react';
import { OfflineProvider } from '@/components/logger/OfflineProvider';

vi.mock('next/navigation', () => ({
  usePathname: () => '/delta-livestock/logger',
}));

let _stubEpoch = 0;

vi.mock('@/lib/sync/queue', () => ({
  getCurrentSyncTruth: vi.fn(async () => ({
    pendingCount: 0,
    failedCount: 0,
    lastAttemptAt: null,
    // Fresh full success so the mount path does NOT fire its own
    // refreshData — keeps the sync-call assertions scoped to auto-drain.
    lastFullSuccessAt: new Date().toISOString(),
  })),
}));

vi.mock('@/lib/offline-store', () => ({
  getCachedCamps: vi.fn(async () => []),
  getCachedFarmSettings: vi.fn(async () => null),
  setActiveFarmSlug: vi.fn(() => {
    _stubEpoch += 1;
  }),
  getFarmEpoch: vi.fn(() => _stubEpoch),
  getCachedCampsForEpoch: vi.fn(async () => []),
  getCachedFarmSettingsForEpoch: vi.fn(async () => null),
}));

vi.mock('@/lib/offline-bcs-dead-letter-cleanup', () => ({
  runDeadLetterCleanup: vi.fn(async () => ({ removed: 0 })),
}));

const syncMocks = vi.hoisted(() => ({
  preparation: { rearmed: 0, pendingCount: 0 },
}));

vi.mock('@/lib/sync-manager', () => ({
  refreshCachedData: vi.fn(async () => {}),
  syncAndRefresh: vi.fn(async () => ({ synced: 0, failed: 0, syncedItems: [] })),
  prepareAutoDrain: vi.fn(async () => ({ ...syncMocks.preparation })),
}));

import { syncAndRefresh, prepareAutoDrain } from '@/lib/sync-manager';

const AUTO_DRAIN_INTERVAL_MS = 60_000;

async function renderProviderAndSettle() {
  render(
    <OfflineProvider>
      <div />
    </OfflineProvider>,
  );
  // Let the mount-effect's async truth/cache reads settle without moving
  // the (fake) clock.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  vi.mocked(syncAndRefresh).mockClear();
  vi.mocked(prepareAutoDrain).mockClear();
}

beforeEach(() => {
  vi.useFakeTimers();
  syncMocks.preparation = { rearmed: 0, pendingCount: 0 };
  globalThis.fetch = vi.fn(async () =>
    new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
  ) as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('OfflineProvider — periodic auto-drain (sync-M1)', () => {
  it('drains queued work on the periodic tick without any manual press', async () => {
    syncMocks.preparation = { rearmed: 1, pendingCount: 2 };
    await renderProviderAndSettle();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_DRAIN_INTERVAL_MS);
    });

    expect(prepareAutoDrain).toHaveBeenCalled();
    expect(syncAndRefresh).toHaveBeenCalledTimes(1);
  });

  it('skips the sync cycle when the re-arm pass reports an empty queue', async () => {
    syncMocks.preparation = { rearmed: 0, pendingCount: 0 };
    await renderProviderAndSettle();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_DRAIN_INTERVAL_MS);
    });

    expect(prepareAutoDrain).toHaveBeenCalled();
    expect(syncAndRefresh).not.toHaveBeenCalled();
  });

  it('drains on return-to-visible without waiting for the interval', async () => {
    syncMocks.preparation = { rearmed: 0, pendingCount: 1 };
    await renderProviderAndSettle();

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(prepareAutoDrain).toHaveBeenCalled();
    expect(syncAndRefresh).toHaveBeenCalledTimes(1);
  });

  it('never drains a hidden tab', async () => {
    syncMocks.preparation = { rearmed: 0, pendingCount: 5 };
    await renderProviderAndSettle();

    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    try {
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(AUTO_DRAIN_INTERVAL_MS);
      });

      expect(prepareAutoDrain).not.toHaveBeenCalled();
      expect(syncAndRefresh).not.toHaveBeenCalled();
    } finally {
      hiddenSpy.mockRestore();
    }
  });
});
