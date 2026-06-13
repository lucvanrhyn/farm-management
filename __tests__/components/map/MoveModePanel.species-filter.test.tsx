// @vitest-environment jsdom
/**
 * S7 / sp-M3 (stress-test remediation 2026-06-01) — the client-side species
 * filter in MoveModePanel's mob picker is dead code that BREAKS sheep/game.
 *
 * Root cause pinned here: `useMobsForCamp` filtered `/api/mobs` results with
 * `(m.species ?? "cattle") === mode`, but the route's wire shape is
 * `[{ id, name, current_camp, animal_count }]` — it NEVER returns a
 * `species` field, and it already scopes the list server-side via the
 * `farmtrack-mode-<slug>` cookie (`getFarmMode` → `listMobs(prisma, mode)`).
 * So `m.species` was always undefined → defaulted "cattle" → in sheep or
 * game mode the filter discarded EVERY mob and the move panel showed
 * "No mobs in this camp." on farms with healthy mobs.
 *
 * Contract pinned by this suite:
 *   1. In sheep mode, mobs returned by /api/mobs (no species field) render.
 *   2. Camp-membership filtering (the live part of the old chain) still works.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import MoveModePanel from '@/components/map/MoveModePanel';

// Active mode is SHEEP — the regression mode for the dead filter.
vi.mock('@/lib/farm-mode', () => ({
  useFarmModeSafe: () => ({ mode: 'sheep', setMode: () => {} }),
}));

vi.mock('@/lib/logger-actions', () => ({
  submitMobMove: vi.fn(async () => ({ success: true })),
}));

// Narrow useOffline stub — the panel only reads these three members.
vi.mock('@/components/logger/OfflineProvider', () => ({
  useOffline: () => ({
    isOnline: true,
    refreshPendingCount: vi.fn(async () => {}),
    syncNow: vi.fn(async () => {}),
  }),
}));

/** Production wire shape: /api/mobs never returns `species`. */
const MOBS_WIRE = [
  { id: 'mob-1', name: 'Ewe flock A', animal_count: 42, current_camp: 'camp-A' },
  { id: 'mob-2', name: 'Ram group', animal_count: 7, current_camp: 'camp-B' },
];

beforeEach(() => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(MOBS_WIRE), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const actions = {
  toggleActive: vi.fn(),
  selectSourceCamp: vi.fn(),
  selectMob: vi.fn(),
  selectDestCamp: vi.fn(),
  cancelMove: vi.fn(),
  resetToSourceSelect: vi.fn(),
};

describe('MoveModePanel — sheep-mode mob list (sp-M3 dead species filter)', () => {
  it('renders mobs from the server-scoped /api/mobs payload in sheep mode', async () => {
    render(
      <MoveModePanel
        phase={{ tag: 'source_selected', campId: 'camp-A' }}
        campNameMap={{ 'camp-A': 'Alpha' }}
        actions={actions}
        onMoveDone={vi.fn()}
      />,
    );

    // Pre-fix: `(m.species ?? "cattle") === "sheep"` discarded every mob and
    // this asserted copy rendered instead of the mob button.
    await waitFor(() => {
      expect(screen.getByText('Ewe flock A')).toBeTruthy();
    });
    expect(screen.queryByText('No mobs in this camp.')).toBeNull();
  });

  it('still filters by camp membership (the live half of the old filter chain)', async () => {
    render(
      <MoveModePanel
        phase={{ tag: 'source_selected', campId: 'camp-A' }}
        campNameMap={{ 'camp-A': 'Alpha' }}
        actions={actions}
        onMoveDone={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Ewe flock A')).toBeTruthy();
    });
    // mob-2 lives in camp-B and must not appear for camp-A.
    expect(screen.queryByText('Ram group')).toBeNull();
  });
});
