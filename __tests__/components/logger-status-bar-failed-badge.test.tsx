// @vitest-environment jsdom
/**
 * Issue #209 — the failed-row badge surface on LoggerStatusBar.
 *
 * Acceptance pinned by this spec:
 *   - When `failedCount === 0`, the "Failed: N" badge is NOT rendered at all
 *     (empty-state criterion in the issue body).
 *   - When `failedCount > 0`, a button with text "Failed: N" is rendered with
 *     warning treatment (we assert the text + role; the visual treatment
 *     lives in the snapshot of the LoggerStatusBar style).
 *   - Clicking the badge opens the FailedSyncDialog. We assert via the
 *     dialog's aria-label.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

afterEach(() => {
  cleanup();
});

// Stub the dialog so we can verify it mounts on click without dragging in the
// full data-loading machinery. The dialog has its own spec
// (`failed-sync-dialog.test.tsx`).
vi.mock('@/components/logger/FailedSyncDialog', () => ({
  __esModule: true,
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div role="dialog" aria-label="Failed sync rows" data-testid="failed-sync-dialog">
        <button type="button" onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

// We drive OfflineProvider state via a mock so each spec controls exactly the
// fields it cares about (pendingCount / failedCount / etc.). The real
// provider does heavy IDB seeding on mount which is irrelevant to the badge.
//
// Issue #252 — `useSyncQueueStatus` is a narrow read-only view exported by
// OfflineProvider that powers the new <SyncBadge /> + <OfflineBanner />
// components. The mock supplies it alongside `useOffline` so this badge
// suite keeps owning the shape contract for both hooks.
let mockFailedCount = 0;
vi.mock('@/components/logger/OfflineProvider', () => ({
  useOffline: () => ({
    isOnline: true,
    syncStatus: 'idle' as const,
    pendingCount: 0,
    failedCount: mockFailedCount,
    lastSyncedAt: null,
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
    isOnline: true,
    pendingCount: 0,
    failedCount: mockFailedCount,
    recentlySyncedItems: [],
  }),
}));

describe('LoggerStatusBar — failed badge (#209)', () => {
  it('does NOT render the badge when failedCount === 0', async () => {
    mockFailedCount = 0;
    const { LoggerStatusBar } = await import('@/components/logger/LoggerStatusBar');
    render(<LoggerStatusBar />);

    // "Failed:" prefix is the badge's only literal marker; absence proves
    // the empty-state acceptance criterion.
    expect(screen.queryByText(/Failed:/)).toBeNull();
    // And the dialog must remain unmounted.
    expect(screen.queryByTestId('failed-sync-dialog')).toBeNull();
  });

  it('renders "Failed: N" badge when failedCount > 0', async () => {
    mockFailedCount = 3;
    const { LoggerStatusBar } = await import('@/components/logger/LoggerStatusBar');
    render(<LoggerStatusBar />);

    expect(screen.getByText('Failed: 3')).toBeTruthy();
  });

  it('opens the FailedSyncDialog when the badge is clicked', async () => {
    mockFailedCount = 2;
    const { LoggerStatusBar } = await import('@/components/logger/LoggerStatusBar');
    render(<LoggerStatusBar />);

    // Pre-click: dialog absent.
    expect(screen.queryByTestId('failed-sync-dialog')).toBeNull();

    const badge = screen.getByText('Failed: 2');
    await act(async () => {
      fireEvent.click(badge);
    });

    expect(screen.getByTestId('failed-sync-dialog')).toBeTruthy();
  });
});
