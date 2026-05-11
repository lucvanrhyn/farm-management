// @vitest-environment jsdom
/**
 * Issue #202 — OfflineProvider does not reset camps state on tenant slug change.
 *
 * Repro: OfflineProvider derives `farmSlug` from `usePathname()`. Its mount
 * effect (lines ~232–286) re-runs when `farmSlug` changes, reads the new
 * tenant's cache via `getCachedCampsForEpoch`, and conditionally seeds:
 *
 *   if (cachedCamps.length > 0) setCamps(cachedCamps);
 *
 * If the new tenant's IndexedDB is empty (fresh tab, just-onboarded farm),
 * `setCamps` is never invoked, so the previous tenant's `camps` array (held
 * in React state) persists in the UI. A logger switching from delta-livestock
 * to a freshly-provisioned tenant still sees Delta camps.
 *
 * Same class-of-bug as #24 (AnimatedHero hero leak across [farmSlug]).
 *
 * Fix: on slug change, reset `camps` / `tasks` / `heroImageUrl` / `campsLoaded`
 * synchronously to a neutral baseline before the new cache reads land. Uses
 * the useState-pair pattern (memory/feedback-react-state-from-props.md) — no
 * extra render, no flicker.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import React from 'react';

// usePathname is read every render; the mutable ref lets each test flip the
// farmSlug between renders to simulate the dynamic-segment navigation that
// does NOT unmount the provider subtree.
const navState: { farmSlug: string } = { farmSlug: 'delta-livestock' };
vi.mock('next/navigation', () => ({
  usePathname: () => `/${navState.farmSlug}/logger`,
}));

// Per-tenant cache fixtures. The epoch helpers route reads to whichever
// `navState.farmSlug` is active at call time, mirroring the real
// `setActiveFarmSlug` → `getCachedCampsForEpoch` flow.
const tenantCamps: Record<string, Array<{ camp_id: string; camp_name: string }>> = {
  'delta-livestock': [
    { camp_id: 'A', camp_name: 'Alpha' },
    { camp_id: 'B', camp_name: 'Beta' },
  ],
  'fresh-tenant': [], // freshly-provisioned: empty IDB
};

// Epoch monotonically increments on every setActiveFarmSlug, matching the
// real offline-store contract used by the provider's mount effect.
let stubEpoch = 0;

vi.mock('@/lib/offline-store', () => ({
  // Non-epoch variants — refreshCampsState / refreshHeroImage use these.
  getCachedCamps: vi.fn(async () => tenantCamps[navState.farmSlug] ?? []),
  getCachedFarmSettings: vi.fn(async () => null),
  setActiveFarmSlug: vi.fn(() => {
    stubEpoch += 1;
  }),
  getFarmEpoch: vi.fn(() => stubEpoch),
  // Epoch-aware variants — read by the mount effect's Promise.all.
  getCachedCampsForEpoch: vi.fn(
    async () => tenantCamps[navState.farmSlug] ?? [],
  ),
  getCachedFarmSettingsForEpoch: vi.fn(async () => null),
}));

// PRD #194 — sync state via the queue facade. Resolve a fresh
// `lastFullSuccessAt` so the mount-time freshness gate skips the network
// fan-out (we want the test isolated from refreshData side-effects).
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

// Disable FarmModeProvider — OfflineProvider falls back to a "cattle" default
// when no provider is mounted (useFarmModeSafe), which is what we want here.

import { OfflineProvider, useOffline } from '@/components/logger/OfflineProvider';

function CampsProbe() {
  const { camps } = useOffline();
  return (
    <div>
      <span data-testid="camp-count">{camps.length}</span>
      <span data-testid="camp-ids">{camps.map((c) => c.camp_id).join(',')}</span>
    </div>
  );
}

beforeEach(() => {
  navState.farmSlug = 'delta-livestock';
  stubEpoch = 0;
  globalThis.fetch = vi.fn(async () =>
    new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }),
  ) as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OfflineProvider — tenant slug change resets stale camps (#202)', () => {
  it('clears camps state when switching to a tenant with an empty IDB cache', async () => {
    let result!: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <OfflineProvider>
          <CampsProbe />
        </OfflineProvider>,
      );
      // Let the mount effect's Promise.all resolve and setCamps run.
      await Promise.resolve();
      await Promise.resolve();
    });

    // Sanity: delta-livestock's two camps are seeded into React state.
    await waitFor(() => {
      expect(result.getByTestId('camp-count').textContent).toBe('2');
    });
    expect(result.getByTestId('camp-ids').textContent).toBe('A,B');

    // Simulate dynamic-segment navigation — the provider re-renders with the
    // new pathname. The new tenant's IDB cache is empty.
    navState.farmSlug = 'fresh-tenant';
    await act(async () => {
      result.rerender(
        <OfflineProvider>
          <CampsProbe />
        </OfflineProvider>,
      );
      // Let the slug-change effect's Promise.all resolve.
      await Promise.resolve();
      await Promise.resolve();
    });

    // THE LEAK: with the bug, delta-livestock's camps stay in state because
    // the empty `cachedCamps` short-circuits the `setCamps` call inside the
    // mount effect. The logger renders Delta camps on a fresh tenant's page.
    expect(result.getByTestId('camp-count').textContent).toBe('0');
    expect(result.getByTestId('camp-ids').textContent).toBe('');
  });
});
