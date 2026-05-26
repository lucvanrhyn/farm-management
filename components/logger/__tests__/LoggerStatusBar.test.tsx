// @vitest-environment jsdom
/**
 * Issue #395 — LoggerStatusBar descriptor → copy mapping.
 *
 * Locks the per-kind rendering rules:
 *   - kind === 'fresh'   → "Synced: …" with relative-time formatting
 *   - kind === 'syncing' → "N pending"
 *   - kind === 'failed'  → "N failed"
 *   - kind === 'partial' → "N pending · M failed"
 *   - kind === 'stale'   → "Stale: …" with relative-time formatting
 *   - kind === 'offline' → "Offline"
 *
 * Pinning these in a separate file (not the badge test) keeps each surface
 * narrowly scoped: this test owns the right-hand status copy; the existing
 * `logger-status-bar-failed-badge.test.tsx` continues to own the failed-row
 * pill and dialog opening.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import React from 'react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Stub the failed-row dialog — the badge spec already covers it.
vi.mock('@/components/logger/FailedSyncDialog', () => ({
  __esModule: true,
  default: () => null,
}));

// Drive `useOffline()` from a single mutable record so each test sets only
// the fields it cares about. The descriptor's `kind` is derived from these
// inputs by `deriveSyncStatusFromCounts` inside the component — that's what
// this test pins. Importing the real (non-mocked) `OfflineProvider` would
// drag in IDB seeding noise irrelevant to descriptor → copy.
type OfflineState = {
  isOnline: boolean;
  pendingCount: number;
  failedCount: number;
  lastSyncedAt: string | null;
};
const offlineState: OfflineState = {
  isOnline: true,
  pendingCount: 0,
  failedCount: 0,
  lastSyncedAt: null,
};

vi.mock('@/components/logger/OfflineProvider', () => ({
  useOffline: () => ({
    ...offlineState,
    syncStatus: 'idle' as const,
    syncResult: null,
    recentlySyncedItems: [],
    syncNow: vi.fn(async () => {}),
    refreshData: vi.fn(async () => {}),
    refreshPendingCount: vi.fn(async () => {}),
    refreshCampsState: vi.fn(async () => {}),
    camps: [],
    campsLoaded: true,
    tasks: [],
    heroImageUrl: null,
  }),
  useSyncQueueStatus: () => ({
    isOnline: offlineState.isOnline,
    pendingCount: offlineState.pendingCount,
    failedCount: offlineState.failedCount,
    recentlySyncedItems: [],
  }),
}));

function setOffline(patch: Partial<OfflineState>): void {
  Object.assign(offlineState, patch);
}

async function renderBar() {
  const { LoggerStatusBar } = await import('@/components/logger/LoggerStatusBar');
  return render(<LoggerStatusBar />);
}

function statusCopy(): { text: string; kind: string | null } {
  const el = screen.getByTestId('logger-status-copy');
  return {
    text: el.textContent ?? '',
    kind: el.getAttribute('data-status-kind'),
  };
}

describe('LoggerStatusBar — descriptor → copy mapping (#395)', () => {
  it('kind=fresh: renders "Synced: …" with relative-time', async () => {
    // Pin `Date.now()` so the relative-time stays deterministic.
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const fiveMinutesAgoIso = new Date(now - 5 * 60_000).toISOString();
    setOffline({
      isOnline: true,
      pendingCount: 0,
      failedCount: 0,
      lastSyncedAt: fiveMinutesAgoIso,
    });
    await renderBar();
    // Issue #422 — the relative-time string is now hydration-safe: the
    // first render shows the `useNow` seed-driven placeholder ("…"), and
    // the post-mount microtask flips `nowMs` to the live `Date.now()`
    // value on the next paint. Wait for that transition before asserting.
    await waitFor(() => {
      expect(statusCopy().text).toContain('5m ago');
    });
    const { text, kind } = statusCopy();
    expect(kind).toBe('fresh');
    expect(text).toMatch(/^Synced: /);
    expect(text).toContain('5m ago');
  });

  it('kind=syncing: renders "N pending" with NO "Synced" label', async () => {
    setOffline({
      isOnline: true,
      pendingCount: 12,
      failedCount: 0,
      lastSyncedAt: new Date().toISOString(),
    });
    await renderBar();
    const { text, kind } = statusCopy();
    expect(kind).toBe('syncing');
    expect(text).toBe('12 pending');
    // Crucial: the bug this issue closes — "Synced" copy must not appear.
    expect(text).not.toMatch(/Synced/);
  });

  it('kind=failed: renders "N failed" with NO "Synced" label', async () => {
    setOffline({
      isOnline: true,
      pendingCount: 0,
      failedCount: 3,
      lastSyncedAt: new Date().toISOString(),
    });
    await renderBar();
    const { text, kind } = statusCopy();
    expect(kind).toBe('failed');
    expect(text).toBe('3 failed');
    expect(text).not.toMatch(/Synced/);
  });

  it('kind=partial: renders "N pending · M failed" with NO "Synced" label', async () => {
    setOffline({
      isOnline: true,
      pendingCount: 12,
      failedCount: 2,
      lastSyncedAt: new Date().toISOString(),
    });
    await renderBar();
    const { text, kind } = statusCopy();
    expect(kind).toBe('partial');
    // Issue body verbatim — both counts surface as distinct integers.
    expect(text).toBe('12 pending · 2 failed');
    expect(text).not.toMatch(/Synced/);
  });

  it('kind=stale: renders "Stale: …" with NO "Synced" label', async () => {
    // 25 hours ago — past the 24h STALE_THRESHOLD_MS lock in the deriver.
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const twentyFiveHoursAgoIso = new Date(now - 25 * 60 * 60_000).toISOString();
    setOffline({
      isOnline: true,
      pendingCount: 0,
      failedCount: 0,
      lastSyncedAt: twentyFiveHoursAgoIso,
    });
    await renderBar();
    const { text, kind } = statusCopy();
    expect(kind).toBe('stale');
    expect(text).toMatch(/^Stale: /);
    expect(text).not.toMatch(/^Synced/);
  });

  it('kind=offline: renders "Offline" even with a recent sync (online beats history)', async () => {
    // Even with a recent successful sync, offline must override the copy —
    // the farmer in a dead zone needs the "Offline" signal, not "Synced 1m ago".
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    setOffline({
      isOnline: false,
      pendingCount: 0,
      failedCount: 0,
      lastSyncedAt: new Date(now - 60_000).toISOString(),
    });
    await renderBar();
    const { text, kind } = statusCopy();
    expect(kind).toBe('offline');
    expect(text).toBe('Offline');
    expect(text).not.toMatch(/Synced/);
  });

  it('"Synced" copy NEVER appears outside kind=fresh', async () => {
    // Sweep all non-fresh kinds and assert "Synced" is absent in each.
    const cases: Array<{ label: string; patch: Partial<OfflineState> }> = [
      { label: 'syncing', patch: { pendingCount: 1, failedCount: 0, isOnline: true, lastSyncedAt: new Date().toISOString() } },
      { label: 'failed', patch: { pendingCount: 0, failedCount: 1, isOnline: true, lastSyncedAt: new Date().toISOString() } },
      { label: 'partial', patch: { pendingCount: 1, failedCount: 1, isOnline: true, lastSyncedAt: new Date().toISOString() } },
      { label: 'offline', patch: { pendingCount: 0, failedCount: 0, isOnline: false, lastSyncedAt: new Date().toISOString() } },
      { label: 'stale-null', patch: { pendingCount: 0, failedCount: 0, isOnline: true, lastSyncedAt: null } },
    ];
    for (const c of cases) {
      cleanup();
      setOffline(c.patch);
      await renderBar();
      const { text } = statusCopy();
      expect(text, `kind=${c.label} should not contain "Synced"`).not.toMatch(/Synced/);
    }
  });
});

/**
 * Issue #422 — React #418 hydration parity for the "X ago" relative-time
 * string the status bar renders.
 *
 * Root cause being closed: `formatRelativeTime(epochMs)` (consumed by the
 * descriptor → copy path) called `Date.now()` synchronously in the render
 * body. `LoggerStatusBar` is mounted from an RSC, so SSR ran `Date.now()`
 * at one instant and the client's first (pre-effect) render ran it at a
 * different instant. The moment the ms-skew crossed a "minute" boundary,
 * the server emitted "4m ago" and the client first render emitted "5m
 * ago" — text divergence → React #418.
 *
 * Fix shape (mirror PR #388 / `f4a3de9` AdminNav pattern): consume the
 * new `useNow(intervalMs, seed)` hook with a deterministic seed (`0`) so
 * the first render of the relative-time text is identical on server and
 * client. The real wall clock is only consulted AFTER mount inside the
 * hook's effect.
 *
 * Locked invariant: two `renderToString` passes — one with `Date.now()`
 * forced to value A, one forced to value B — produce byte-for-byte
 * identical HTML for the status copy. Under the old buggy code the
 * "X ago" substring would differ between the two passes.
 */
describe('LoggerStatusBar — hydration parity (#422, mirrors #387 / PR #388)', () => {
  it('first render is identical across two different wall-clock instants (no #418)', async () => {
    // A recent successful sync so the descriptor lands on `fresh` —
    // which is the kind whose copy interpolates the relative-time string
    // that used to call `Date.now()` at render.
    const baseline = 1_700_000_000_000;
    setOffline({
      isOnline: true,
      pendingCount: 0,
      failedCount: 0,
      lastSyncedAt: new Date(baseline - 5 * 60_000).toISOString(),
    });

    // ── Render 1: clock at T+0s ───────────────────────────────────────
    vi.spyOn(Date, 'now').mockReturnValue(baseline);
    const { LoggerStatusBar } = await import('@/components/logger/LoggerStatusBar');
    const serverHtml = renderToString(React.createElement(LoggerStatusBar));

    // ── Render 2: clock advanced 90s — would push relative-time from
    // "5m ago" to "6m ago" under the old in-render `Date.now()` code ──
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(baseline + 90_000);
    const clientFirstRender = renderToString(React.createElement(LoggerStatusBar));

    // Byte-for-byte identical → the first render did not consult the
    // wall clock. React would have thrown #418 if these differed.
    expect(clientFirstRender).toBe(serverHtml);
    // And the copy is the deterministic seed-driven placeholder, not the
    // wall-clock-derived "Nm ago" string.
    expect(serverHtml).not.toMatch(/\d+m ago/);
  });
});
