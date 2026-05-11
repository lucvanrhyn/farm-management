// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';
import { OfflineProvider, useOffline } from '@/components/logger/OfflineProvider';

// PRD #194 wave 2 / issue #196 — divergence-prevention invariant.
//
// Goal of this suite: pin the contract that OfflineProvider derives its
// user-facing state (pendingCount, failedCount, lastSyncedAt) from a single
// `getCurrentSyncTruth()` read — never from the legacy `getPendingCount` /
// `getLastSyncedAt` getters in isolation. That isolated-getter pattern was the
// exact cause of Codex audit findings C1 and C3 (UI claimed "Synced: Just now"
// while every queued row had actually failed).
//
// The contract has three legs:
//   1. `pendingCount` on context mirrors `SyncTruth.pendingCount`.
//   2. `failedCount` is exposed on context and mirrors `SyncTruth.failedCount`.
//   3. `lastSyncedAt` on context mirrors `SyncTruth.lastFullSuccessAt` — NOT
//      `lastAttemptAt`. A partial-failure sync must NOT advance the displayed
//      timestamp.
//
// The fourth test asserts that LoggerStatusBar renders a "N failed" pill when
// failedCount > 0 and hides it when zero.

vi.mock('next/navigation', () => ({
  usePathname: () => '/delta-livestock/logger',
}));

// Module-level mutable SyncTruth — the test mutates this between renders /
// refreshes to simulate sync-attempt outcomes.
const truthState = {
  pendingCount: 0,
  failedCount: 0,
  lastAttemptAt: null as string | null,
  lastFullSuccessAt: null as string | null,
};

let _stubEpoch = 0;

vi.mock('@/lib/sync/queue', () => ({
  // The Provider's single source of truth. Tests mutate `truthState` then
  // ask the Provider to re-derive (via refreshPendingCount, syncNow, or
  // refreshData).
  getCurrentSyncTruth: vi.fn(async () => ({ ...truthState })),
}));

vi.mock('@/lib/offline-store', () => ({
  // These remain mocked because OfflineProvider still uses them for the
  // mount-time epoch-aware cache read (camp data, settings) — that surface
  // is not part of this wave. They MUST not be the source of pendingCount /
  // lastSyncedAt going forward.
  getPendingCount: vi.fn(async () => {
    throw new Error(
      'OfflineProvider must not read getPendingCount directly — read getCurrentSyncTruth',
    );
  }),
  getLastSyncedAt: vi.fn(async () => {
    throw new Error(
      'OfflineProvider must not read getLastSyncedAt directly — read getCurrentSyncTruth',
    );
  }),
  getCachedCamps: vi.fn(async () => []),
  getCachedFarmSettings: vi.fn(async () => null),
  setActiveFarmSlug: vi.fn(() => {
    _stubEpoch += 1;
  }),
  getFarmEpoch: vi.fn(() => _stubEpoch),
  getCachedCampsForEpoch: vi.fn(async () => []),
  getCachedFarmSettingsForEpoch: vi.fn(async () => null),
  getLastSyncedAtForEpoch: vi.fn(async () => null),
}));

vi.mock('@/lib/sync-manager', () => ({
  refreshCachedData: vi.fn(async () => {}),
  syncAndRefresh: vi.fn(async () => ({ synced: 0, failed: 0 })),
}));

beforeEach(() => {
  truthState.pendingCount = 0;
  truthState.failedCount = 0;
  truthState.lastAttemptAt = null;
  truthState.lastFullSuccessAt = null;
  globalThis.fetch = vi.fn(async () =>
    new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
  ) as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function TruthProbe() {
  const { pendingCount, failedCount, lastSyncedAt, refreshPendingCount } = useOffline();
  return (
    <div>
      <span data-testid="pending">{pendingCount}</span>
      <span data-testid="failed">{failedCount}</span>
      <span data-testid="last-synced">{lastSyncedAt ?? 'null'}</span>
      <button data-testid="refresh" onClick={() => refreshPendingCount()}>
        refresh
      </button>
    </div>
  );
}

describe('OfflineProvider — SyncTruth-derived context', () => {
  it('reflects pendingCount from getCurrentSyncTruth', async () => {
    truthState.pendingCount = 3;

    render(
      <OfflineProvider>
        <TruthProbe />
      </OfflineProvider>,
    );

    // Let the mount-effect's initial truth read settle.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('pending').textContent).toBe('3');
  });

  it('reflects failedCount from getCurrentSyncTruth', async () => {
    truthState.pendingCount = 1;
    truthState.failedCount = 2;

    render(
      <OfflineProvider>
        <TruthProbe />
      </OfflineProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('failed').textContent).toBe('2');
    expect(screen.getByTestId('pending').textContent).toBe('1');
  });

  it('lastSyncedAt only advances on full-success cycles (mirrors lastFullSuccessAt, not lastAttemptAt)', async () => {
    // Initial state: a clean full-success sync at T0.
    const t0 = '2026-05-11T10:00:00.000Z';
    truthState.lastAttemptAt = t0;
    truthState.lastFullSuccessAt = t0;

    render(
      <OfflineProvider>
        <TruthProbe />
      </OfflineProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('last-synced').textContent).toBe(t0);

    // Simulate a partial-failure sync at T1: lastAttemptAt advances, but
    // lastFullSuccessAt stays pinned to T0 (this is the wave-1 invariant).
    const t1 = '2026-05-11T10:05:00.000Z';
    truthState.lastAttemptAt = t1;
    truthState.failedCount = 1;
    // lastFullSuccessAt deliberately NOT updated.

    await act(async () => {
      screen.getByTestId('refresh').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The displayed timestamp must still be t0 — the invariant the C1/C3
    // bug violated.
    expect(screen.getByTestId('last-synced').textContent).toBe(t0);
    expect(screen.getByTestId('failed').textContent).toBe('1');

    // Now simulate a clean full-success cycle at T2 (queue drained).
    const t2 = '2026-05-11T10:10:00.000Z';
    truthState.lastAttemptAt = t2;
    truthState.lastFullSuccessAt = t2;
    truthState.pendingCount = 0;
    truthState.failedCount = 0;

    await act(async () => {
      screen.getByTestId('refresh').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('last-synced').textContent).toBe(t2);
  });
});

describe('LoggerStatusBar — N failed pill', () => {
  it('renders the failed-count pill when failedCount > 0', async () => {
    const { LoggerStatusBar } = await import('@/components/logger/LoggerStatusBar');

    truthState.failedCount = 2;
    render(
      <OfflineProvider>
        <LoggerStatusBar />
      </OfflineProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(/2 failed/i)).toBeTruthy();
  });

  it('hides the failed-count pill when failedCount is zero', async () => {
    const { LoggerStatusBar } = await import('@/components/logger/LoggerStatusBar');

    truthState.failedCount = 0;
    render(
      <OfflineProvider>
        <LoggerStatusBar />
      </OfflineProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText(/failed/i)).toBeNull();
  });
});
