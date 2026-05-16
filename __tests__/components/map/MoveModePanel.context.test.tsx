// @vitest-environment jsdom
/**
 * Regression test for the P0.3 hotfix (production-triage 2026-05-03):
 *
 *   Bug: clicking the ⇄ Move Mob control on `/<farmSlug>/admin/map` blew the
 *   page up with `useOffline must be used within OfflineProvider`. The admin
 *   subtree never wrapped <OfflineProvider>; the consumer was buried in
 *   <MoveModePanel /> which is only rendered after the user clicks the move
 *   toggle, so the crash was invisible until that interaction.
 *
 * The fix is to hoist <OfflineProvider> from `app/[farmSlug]/logger/layout.tsx`
 * up to `app/[farmSlug]/layout.tsx` so it covers logger + admin trees both.
 *
 * Three guards pin the contract:
 *   1. WITHOUT a provider in the tree, MoveModePanel throws — proves the
 *      consumer requires the context (defends against a future "let's drop
 *      OfflineProvider from the per-farm layout" refactor).
 *   2. WITH the provider, MoveModePanel mounts cleanly with a non-idle phase.
 *   3. The per-farm layout source imports + mounts <OfflineProvider> — pins
 *      the actual hoist so removing the wrapper from
 *      `app/[farmSlug]/layout.tsx` would fail the suite. The logger layout
 *      no longer mounts its own (would double-wrap and reset IDB).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import MoveModePanel from '@/components/map/MoveModePanel';
import { OfflineProvider } from '@/components/logger/OfflineProvider';

vi.mock('next/navigation', () => ({
  usePathname: () => '/delta-livestock/admin/map',
}));

// Stub farm-mode so MoveModePanel's useFarmModeSafe call has a value.
vi.mock('@/lib/farm-mode', () => ({
  useFarmModeSafe: () => ({ mode: 'cattle', setMode: () => {} }),
}));

// Stub logger-actions so submitMobMove never actually runs.
vi.mock('@/lib/logger-actions', () => ({
  submitMobMove: vi.fn(async () => ({ success: true })),
}));

// Stub the offline-store so OfflineProvider's mount effect doesn't touch IDB.
let _stubEpoch = 0;
vi.mock('@/lib/offline-store', () => ({
  getCachedCamps: vi.fn(async () => []),
  getCachedFarmSettings: vi.fn(async () => null),
  setActiveFarmSlug: vi.fn(() => { _stubEpoch += 1; }),
  getFarmEpoch: vi.fn(() => _stubEpoch),
  getCachedCampsForEpoch: vi.fn(async () => []),
  getCachedFarmSettingsForEpoch: vi.fn(async () => null),
}));

// PRD #194 wave 2 — OfflineProvider reads sync state via the queue facade.
vi.mock('@/lib/sync/queue', () => ({
  getCurrentSyncTruth: vi.fn(async () => ({
    pendingCount: 0,
    failedCount: 0,
    lastAttemptAt: null,
    lastFullSuccessAt: null,
  })),
}));

vi.mock('@/lib/sync-manager', () => ({
  refreshCachedData: vi.fn(async () => {}),
  syncAndRefresh: vi.fn(async () => ({ synced: 0 })),
}));

beforeEach(() => {
  globalThis.fetch = vi.fn(async () =>
    new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
  ) as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const phase = { tag: 'source_selected' as const, campId: 'camp-A' };
const actions = {
  toggleActive: vi.fn(),
  selectSourceCamp: vi.fn(),
  selectMob: vi.fn(),
  selectDestCamp: vi.fn(),
  cancelMove: vi.fn(),
  resetToSourceSelect: vi.fn(),
};
const campNameMap = { 'camp-A': 'Alpha' };
const onMoveDone = vi.fn();

describe('MoveModePanel — OfflineProvider context contract', () => {
  it('throws "useOffline must be used within OfflineProvider" when no provider wraps it (admin/map regression)', () => {
    // React 18+ logs the caught error to console.error before propagating —
    // silence it so the test output stays readable.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(
        <MoveModePanel
          phase={phase}
          campNameMap={campNameMap}
          actions={actions}
          onMoveDone={onMoveDone}
        />,
      );
    }).toThrow(/useOffline must be used within OfflineProvider/);

    errSpy.mockRestore();
  });

  it('mounts cleanly when wrapped in <OfflineProvider> (post-hoist behaviour)', () => {
    const { container } = render(
      <OfflineProvider>
        <MoveModePanel
          phase={phase}
          campNameMap={campNameMap}
          actions={actions}
          onMoveDone={onMoveDone}
        />
      </OfflineProvider>,
    );
    // The header text "Move Mob" is rendered in any non-idle phase.
    expect(container.textContent).toContain('Move Mob');
  });
});

// Issue #289 — Move Mob idle-phase instruction.
// Activating Move Mob (phase.tag === 'idle') must immediately show a next-step
// hint instead of rendering nothing. The hint is superseded by the existing
// source-selected / mob-selected guidance as the flow advances.
describe('MoveModePanel — idle-phase instruction (#289)', () => {
  const idlePhase = { tag: 'idle' as const };

  it('renders a next-step source-pick hint on activation (idle no longer renders nothing)', () => {
    const { container } = render(
      <OfflineProvider>
        <MoveModePanel
          phase={idlePhase}
          campNameMap={campNameMap}
          actions={actions}
          onMoveDone={onMoveDone}
        />
      </OfflineProvider>,
    );
    // Panel is visible (header) and instructs the farmer to pick a source camp.
    expect(container.textContent).toContain('Move Mob');
    expect(container.textContent).toMatch(/tap a camp/i);
    expect(container.textContent).toMatch(/source/i);
  });

  it('idle hint is superseded by source-selected guidance as the flow advances', () => {
    const { container } = render(
      <OfflineProvider>
        <MoveModePanel
          phase={{ tag: 'source_selected', campId: 'camp-A' }}
          campNameMap={campNameMap}
          actions={actions}
          onMoveDone={onMoveDone}
        />
      </OfflineProvider>,
    );
    // Later phase shows its own copy and NOT the idle hint.
    expect(container.textContent).toMatch(/Select a mob to move:|Loading mobs|No mobs in this camp/);
    expect(container.textContent).not.toMatch(/tap a camp to pick the mob's source/i);
  });
});

const repoRoot = path.resolve(__dirname, '..', '..', '..');

describe('Per-farm layout hoists <OfflineProvider> above admin + logger trees', () => {
  it('app/[farmSlug]/layout.tsx imports and renders <OfflineProvider>', () => {
    const layoutPath = path.join(repoRoot, 'app', '[farmSlug]', 'layout.tsx');
    expect(existsSync(layoutPath)).toBe(true);
    const src = readFileSync(layoutPath, 'utf8');
    // Defends against a future "decouple offline from admin" refactor that
    // would silently reintroduce the Move-Mob crash.
    expect(src).toMatch(/from ["']@\/components\/logger\/OfflineProvider["']/);
    expect(src).toMatch(/<OfflineProvider>/);
  });

  it('app/[farmSlug]/logger/layout.tsx no longer mounts its own <OfflineProvider> (avoids double-wrap)', () => {
    const loggerLayoutPath = path.join(repoRoot, 'app', '[farmSlug]', 'logger', 'layout.tsx');
    expect(existsSync(loggerLayoutPath)).toBe(true);
    const src = readFileSync(loggerLayoutPath, 'utf8');
    // Two nested <OfflineProvider>s would each call setActiveFarmSlug +
    // increment the farm epoch, racing the IDB cache reads. The hoisted
    // provider in the parent layout is the single source of truth.
    expect(src).not.toMatch(/<OfflineProvider>/);
  });
});
