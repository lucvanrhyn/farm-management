// @vitest-environment jsdom
/**
 * Issue #457 — FailedSyncDialog must drain dead-letters on open, then re-read.
 *
 * Root cause this pins (the UI half of #457):
 *   The mount-time `runDeadLetterCleanup` (OfflineProvider) is fire-and-forget,
 *   so a user who opens the FailedSyncDialog quickly after mount could see the
 *   stuck rows render BEFORE the async cleanup finished draining them. With the
 *   global run-once flag also removed (the cleanup-module half of #457), the
 *   dialog now runs the cleanup itself on open and RE-READS the failed bucket,
 *   so a drainable row is gone by render time.
 *
 * Contract pinned here:
 *   - On open, the dialog awaits `runDeadLetterCleanup()` before loading rows.
 *   - It re-fetches the failed bucket AFTER the cleanup so the discarded rows
 *     never reach the rendered list.
 *   - A non-drainable (transient / retryable) row still renders so the user can
 *     act on it.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import React from 'react';

// ── Mocks ───────────────────────────────────────────────────────────────────

const cleanupMocks = vi.hoisted(() => ({
  runDeadLetterCleanup: vi.fn(async () => ({ removed: 0 })),
}));
vi.mock('@/lib/offline-bcs-dead-letter-cleanup', () => ({
  runDeadLetterCleanup: cleanupMocks.runDeadLetterCleanup,
}));

const storeMocks = vi.hoisted(() => ({
  getFailedObservations: vi.fn(async () => [] as unknown[]),
  getFailedAnimals: vi.fn(async () => [] as unknown[]),
  getFailedCoverReadings: vi.fn(async () => [] as unknown[]),
  markObservationPending: vi.fn(async () => {}),
  markAnimalCreatePending: vi.fn(async () => {}),
  markCoverReadingPending: vi.fn(async () => {}),
  discardFailedObservation: vi.fn(async () => {}),
  discardFailedAnimalCreate: vi.fn(async () => {}),
  discardFailedCoverReading: vi.fn(async () => {}),
}));
vi.mock('@/lib/offline-store', () => ({
  ...storeMocks,
  // Real classifier semantics: 400/404/422 terminal, everything else retryable.
  isTerminalFailure: (row: { lastStatusCode: number | null }) =>
    row.lastStatusCode === 400 || row.lastStatusCode === 404 || row.lastStatusCode === 422,
}));

vi.mock('@/components/logger/OfflineProvider', () => ({
  useOffline: () => ({
    syncNow: vi.fn(async () => {}),
    refreshPendingCount: vi.fn(async () => {}),
  }),
}));

import FailedSyncDialog from '@/components/logger/FailedSyncDialog';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OLD_CREATED_AT = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();

/** A terminal DUPLICATE_OBSERVATION row the cleanup would drain. */
function makeStuckDuplicateRow(localId = 1) {
  return {
    local_id: localId,
    clientLocalId: `uuid-${localId}`,
    type: 'camp_condition',
    camp_id: 'TrioB-Camp',
    animal_id: null,
    details: '{"grazing_quality":"Good"}',
    created_at: OLD_CREATED_AT,
    synced_at: null,
    sync_status: 'failed' as const,
    attempts: 2,
    firstFailedAt: Date.now() - 9 * 60 * 60 * 1000,
    lastError: '{"error":"DUPLICATE_OBSERVATION","details":{"existingId":"srv-99"}}',
    lastStatusCode: 422,
  };
}

/** A transient (retryable) row the cleanup leaves alone. */
function makeTransientRow(localId = 2) {
  return {
    local_id: localId,
    clientLocalId: `uuid-${localId}`,
    type: 'camp_condition',
    camp_id: 'TrioB-Camp',
    animal_id: null,
    details: '{"grazing_quality":"Fair"}',
    created_at: OLD_CREATED_AT,
    synced_at: null,
    sync_status: 'failed' as const,
    attempts: 4,
    firstFailedAt: Date.now() - 9 * 60 * 60 * 1000,
    lastError: 'Service Unavailable',
    lastStatusCode: 503,
  };
}

beforeEach(() => {
  cleanupMocks.runDeadLetterCleanup.mockClear();
  cleanupMocks.runDeadLetterCleanup.mockResolvedValue({ removed: 0 });
  for (const fn of Object.values(storeMocks)) fn.mockClear();
  storeMocks.getFailedAnimals.mockResolvedValue([]);
  storeMocks.getFailedCoverReadings.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FailedSyncDialog — drain dead-letters on open (#457)', () => {
  it('runs runDeadLetterCleanup when the dialog opens', async () => {
    storeMocks.getFailedObservations.mockResolvedValue([makeTransientRow(2)]);

    render(<FailedSyncDialog isOpen onClose={() => {}} />);

    await waitFor(() => {
      expect(cleanupMocks.runDeadLetterCleanup).toHaveBeenCalledTimes(1);
    });
  });

  it('re-reads after cleanup so a drained row never renders', async () => {
    // The cleanup drains the stuck duplicate row: first IDB read (pre-cleanup)
    // still has it, the read AFTER cleanup returns the empty bucket. The dialog
    // must render the post-cleanup state.
    cleanupMocks.runDeadLetterCleanup.mockImplementation(async () => {
      // Simulate the discard: subsequent reads see the empty bucket.
      storeMocks.getFailedObservations.mockResolvedValue([]);
      return { removed: 1 };
    });
    storeMocks.getFailedObservations.mockResolvedValue([makeStuckDuplicateRow(1)]);

    const onClose = vi.fn();
    render(<FailedSyncDialog isOpen onClose={onClose} />);

    // The drained row must NOT appear, and the dialog auto-closes on an empty
    // list (existing behaviour) once the post-cleanup read returns [].
    await waitFor(() => {
      expect(cleanupMocks.runDeadLetterCleanup).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('failed-row-observation-1')).toBeNull();
  });

  it('still renders a transient (retryable) row the cleanup leaves alone', async () => {
    cleanupMocks.runDeadLetterCleanup.mockResolvedValue({ removed: 0 });
    storeMocks.getFailedObservations.mockResolvedValue([makeTransientRow(2)]);

    render(<FailedSyncDialog isOpen onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('failed-row-observation-2')).toBeTruthy();
      // Transient row gets the retry control, not discard.
      expect(screen.getByTestId('retry-row-observation-2')).toBeTruthy();
    });
  });
});
