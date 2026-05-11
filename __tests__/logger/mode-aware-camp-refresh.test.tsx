// @vitest-environment jsdom
/**
 * Wave D-U3 — Logger mode-aware camp list refresh.
 *
 * Codex audit P2 U3: "Trio Cattle/Sheep toggle did not visibly change
 * Logger camp list." This integration test pins the user-visible contract:
 * when the FarmModeProvider's `mode` flips, OfflineProvider must re-fetch
 * `/api/camps` with the new `?species=<mode>` filter so the camp grid's
 * `animal_count` chips reflect the active species.
 *
 * Wire-up under test:
 *   FarmModeProvider (mode = cattle initially)
 *     └─ OfflineProvider (calls refreshCachedData with species = mode)
 *          └─ probe that calls setMode("sheep")
 *
 * We mock `refreshCachedData` from `@/lib/sync-manager` and assert the species
 * arg flips when the mode flips. (The end-to-end fact that a species arg
 * lands on the URL is covered by `sync-manager-species-param.test.ts`.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/trio-b/logger',
}));

// Capture every refreshCachedData call so we can verify the species arg.
// `vi.mock` is hoisted, so the mocks must live inside `vi.hoisted()` to be
// available at hoist time. (See memory: feedback-vi-hoisted-shared-mocks.md.)
const { refreshCachedDataMock, syncAndRefreshMock } = vi.hoisted(() => ({
  refreshCachedDataMock: vi.fn(async (_opts?: { species?: string }) => {}),
  syncAndRefreshMock: vi.fn(async (_opts?: { species?: string }) => ({ synced: 0, failed: 0 })),
}));

vi.mock('@/lib/sync-manager', () => ({
  refreshCachedData: refreshCachedDataMock,
  syncAndRefresh: syncAndRefreshMock,
}));

// offline-store: provide the surface OfflineProvider's mount effect touches.
// Resolve cache reads immediately so campsLoaded flips true synchronously
// (we want the mode-change effect to be free to fire).
vi.mock('@/lib/offline-store', () => ({
  getCachedCamps: vi.fn(async () => []),
  getCachedFarmSettings: vi.fn(async () => null),
  setActiveFarmSlug: vi.fn(),
  getFarmEpoch: vi.fn(() => 1),
  // Epoch-aware variants: cache reads resolve empty so campsLoaded flips
  // immediately.
  getCachedCampsForEpoch: vi.fn(async () => []),
  getCachedFarmSettingsForEpoch: vi.fn(async () => null),
}));

// PRD #194 wave 2 — sync state is now read via the queue facade. Resolve a
// fresh `lastFullSuccessAt` so the mount-time refreshData skips its
// freshness gate (we want a clean baseline where the only refreshData firing
// is the mode-change one we cause).
vi.mock('@/lib/sync/queue', () => ({
  getCurrentSyncTruth: vi.fn(async () => ({
    pendingCount: 0,
    failedCount: 0,
    lastAttemptAt: new Date().toISOString(),
    lastFullSuccessAt: new Date().toISOString(),
  })),
}));

// Stub Image — not strictly needed here, but matches the sibling test setup
// pattern and protects against future layout imports.
vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  },
}));

import { FarmModeProvider, useFarmMode } from '@/lib/farm-mode';
import { OfflineProvider } from '@/components/logger/OfflineProvider';

function ModeToggle({ mode }: { mode: 'cattle' | 'sheep' }) {
  const { setMode } = useFarmMode();
  return (
    <button data-testid="set-mode" onClick={() => setMode(mode)}>
      set {mode}
    </button>
  );
}

beforeEach(() => {
  refreshCachedDataMock.mockClear();
  syncAndRefreshMock.mockClear();
  localStorage.clear();
  globalThis.fetch = vi.fn(async () =>
    new Response('null', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OfflineProvider — mode-aware camp refresh', () => {
  it('passes the active FarmMode as species to refreshCachedData on mode change', async () => {
    // Initial mode is cattle (first enabledSpecies entry).
    const { getByTestId } = render(
      <FarmModeProvider farmSlug="trio-b" enabledSpecies={['cattle', 'sheep']}>
        <OfflineProvider>
          <ModeToggle mode="sheep" />
        </OfflineProvider>
      </FarmModeProvider>,
    );

    // Give the mount effect (lastSynced gate skips refreshData here) a tick.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    refreshCachedDataMock.mockClear();
    syncAndRefreshMock.mockClear();

    // Flip mode to sheep — this is the user-visible action.
    await act(async () => {
      getByTestId('set-mode').click();
      await Promise.resolve();
    });

    await waitFor(() => {
      // Either refreshCachedData (no pending) or syncAndRefresh (pending) is
      // an acceptable refresh path, but BOTH must receive the new species.
      const allCalls = [
        ...refreshCachedDataMock.mock.calls,
        ...syncAndRefreshMock.mock.calls,
      ];
      expect(allCalls.length).toBeGreaterThan(0);
      const lastCall = allCalls[allCalls.length - 1];
      const opts = (lastCall[0] ?? {}) as { species?: string };
      expect(opts.species).toBe('sheep');
    });
  });

  it('passes the new mode again when flipped back to cattle', async () => {
    // Seed sheep so the initial mode is sheep.
    localStorage.setItem('farmtrack-mode-trio-b', 'sheep');

    const { getByTestId } = render(
      <FarmModeProvider farmSlug="trio-b" enabledSpecies={['cattle', 'sheep']}>
        <OfflineProvider>
          <ModeToggle mode="cattle" />
        </OfflineProvider>
      </FarmModeProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    refreshCachedDataMock.mockClear();
    syncAndRefreshMock.mockClear();

    await act(async () => {
      getByTestId('set-mode').click();
      await Promise.resolve();
    });

    await waitFor(() => {
      const allCalls = [
        ...refreshCachedDataMock.mock.calls,
        ...syncAndRefreshMock.mock.calls,
      ];
      expect(allCalls.length).toBeGreaterThan(0);
      const lastCall = allCalls[allCalls.length - 1];
      const opts = (lastCall[0] ?? {}) as { species?: string };
      expect(opts.species).toBe('cattle');
    });
  });

  it('does not refetch on initial mount when the cache is fresh (no duplicate fan-out)', async () => {
    render(
      <FarmModeProvider farmSlug="trio-b" enabledSpecies={['cattle', 'sheep']}>
        <OfflineProvider>
          <ModeToggle mode="sheep" />
        </OfflineProvider>
      </FarmModeProvider>,
    );

    // Allow mount effects to settle. The lastSynced timestamp is fresh
    // (just now) so refreshData should NOT fire from the freshness gate,
    // and the mode-change effect should NOT fire on initial mount (it's
    // the initial mode, not a change).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refreshCachedDataMock).not.toHaveBeenCalled();
    expect(syncAndRefreshMock).not.toHaveBeenCalled();
  });
});
