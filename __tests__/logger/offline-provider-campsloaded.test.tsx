// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';
import { OfflineProvider, useOffline } from '@/components/logger/OfflineProvider';

// P2 — Logger fan-out de-dupe: the logger layout needs a signal from
// OfflineProvider that the initial IndexedDB cache read has settled so the
// camp-warmup prefetch can start from `useOffline().camps` rather than firing
// its own /api/camps request. `campsLoaded` is that one-shot signal — it
// starts false, flips true once the cache read resolves (even if the cache is
// empty), and stays true.

vi.mock('next/navigation', () => ({
  usePathname: () => '/delta-livestock/logger',
}));

// Track cache read resolution so the test can observe the pre-settle state.
let resolveCampsRead: ((camps: unknown[]) => void) | null = null;
let resolveSettingsRead: ((s: unknown) => void) | null = null;
let resolveLastSyncedRead: ((s: string | null) => void) | null = null;

vi.mock('@/lib/offline-store', () => ({
  getPendingCount: vi.fn(async () => 0),
  getLastSyncedAt: vi.fn(
    () =>
      new Promise<string | null>((resolve) => {
        resolveLastSyncedRead = resolve;
      }),
  ),
  getCachedCamps: vi.fn(
    () =>
      new Promise<unknown[]>((resolve) => {
        resolveCampsRead = resolve;
      }),
  ),
  getCachedFarmSettings: vi.fn(
    () =>
      new Promise<unknown>((resolve) => {
        resolveSettingsRead = resolve;
      }),
  ),
  setActiveFarmSlug: vi.fn(),
}));

// refreshCachedData may be invoked after campsLoaded flips — stub to a resolved
// promise so the test doesn't accidentally exercise sync logic.
vi.mock('@/lib/sync-manager', () => ({
  refreshCachedData: vi.fn(async () => {}),
  syncAndRefresh: vi.fn(async () => ({ synced: 0 })),
}));

beforeEach(() => {
  resolveCampsRead = null;
  resolveSettingsRead = null;
  resolveLastSyncedRead = null;
  // Provide a fetch stub — OfflineProvider may call refreshData after settle.
  globalThis.fetch = vi.fn(async () =>
    new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
  ) as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function CampsLoadedProbe() {
  const { campsLoaded, camps } = useOffline();
  return (
    <div>
      <span data-testid="loaded">{String(campsLoaded)}</span>
      <span data-testid="camp-count">{camps.length}</span>
    </div>
  );
}

describe('OfflineProvider — campsLoaded lifecycle', () => {
  it('starts false and flips true after the initial IndexedDB cache read resolves', async () => {
    render(
      <OfflineProvider>
        <CampsLoadedProbe />
      </OfflineProvider>,
    );

    // Before the cache read settles, consumers see campsLoaded === false.
    expect(screen.getByTestId('loaded').textContent).toBe('false');

    // Resolve the three cache reads the provider awaits in parallel.
    await act(async () => {
      resolveCampsRead?.([]);
      resolveSettingsRead?.(null);
      resolveLastSyncedRead?.(new Date().toISOString());
      await Promise.resolve();
    });

    expect(screen.getByTestId('loaded').textContent).toBe('true');
  });

  it('flips true even when cached camps are empty (no camps in IDB yet)', async () => {
    render(
      <OfflineProvider>
        <CampsLoadedProbe />
      </OfflineProvider>,
    );

    await act(async () => {
      resolveCampsRead?.([]); // empty cache — a fresh tab on first visit
      resolveSettingsRead?.(null);
      resolveLastSyncedRead?.(null);
      await Promise.resolve();
    });

    expect(screen.getByTestId('loaded').textContent).toBe('true');
    expect(screen.getByTestId('camp-count').textContent).toBe('0');
  });

  it('exposes cached camps after settle', async () => {
    render(
      <OfflineProvider>
        <CampsLoadedProbe />
      </OfflineProvider>,
    );

    await act(async () => {
      resolveCampsRead?.([
        { camp_id: 'A', camp_name: 'Alpha' },
        { camp_id: 'B', camp_name: 'Beta' },
      ]);
      resolveSettingsRead?.(null);
      resolveLastSyncedRead?.(new Date().toISOString());
      await Promise.resolve();
    });

    expect(screen.getByTestId('loaded').textContent).toBe('true');
    expect(screen.getByTestId('camp-count').textContent).toBe('2');
  });
});
