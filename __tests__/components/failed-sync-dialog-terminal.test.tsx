// @vitest-environment jsdom
/**
 * Issue #324 (PRD #318 wave R2) follow-up — FailedSyncDialog must surface
 * terminal (poison) rows distinctly and offer Discard instead of Retry.
 *
 * The bug this pins:
 *   R2 made the re-queue writers a NO-OP for terminal-4xx poison rows. But
 *   FailedSyncDialog still rendered EVERY failed row identically with a
 *   "Retry" button. A farmer with a poison 422 row clicks "Retry" → the
 *   writer silently does nothing → the row never drains → the dialog never
 *   auto-closes. A confusing dead-end with no escape.
 *
 * Contract pinned here:
 *   - A terminal row (lastStatusCode ∈ {400,404,422}) renders a "Discard"
 *     control and a "won't retry" affordance, NOT a "Retry" button.
 *   - Discard calls the matching `discardFailed*` helper with the row's
 *     local_id, then reloads (poison row drains; dialog can auto-close).
 *   - A transient row (5xx / network) is unchanged: "Retry" button, calls
 *     `markObservationPending` — the #209 contract still holds.
 *   - "Retry all" only re-queues transient rows; it never calls a re-queue
 *     helper for a terminal poison row (honest UI — matches the writer).
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';

const TERMINAL_OBS_UUID = '11111111-2222-4333-8444-555555555555';
const TRANSIENT_OBS_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const failedRowsState = vi.hoisted(() => ({
  observations: [] as Array<Record<string, unknown>>,
  animals: [] as Array<Record<string, unknown>>,
  covers: [] as Array<Record<string, unknown>>,
}));

const helperSpies = vi.hoisted(() => ({
  markObservationPending: vi.fn(async () => {}),
  markAnimalCreatePending: vi.fn(async () => {}),
  markCoverReadingPending: vi.fn(async () => {}),
  discardFailedObservation: vi.fn(async () => {}),
  discardFailedAnimalCreate: vi.fn(async () => {}),
  discardFailedCoverReading: vi.fn(async () => {}),
}));

const providerSpies = vi.hoisted(() => ({
  syncNow: vi.fn(async () => {}),
  refreshPendingCount: vi.fn(async () => {}),
}));

vi.mock('@/lib/offline-store', () => ({
  getFailedObservations: vi.fn(async () => failedRowsState.observations),
  getFailedAnimals: vi.fn(async () => failedRowsState.animals),
  getFailedCoverReadings: vi.fn(async () => failedRowsState.covers),
  markObservationPending: helperSpies.markObservationPending,
  markAnimalCreatePending: helperSpies.markAnimalCreatePending,
  markCoverReadingPending: helperSpies.markCoverReadingPending,
  discardFailedObservation: helperSpies.discardFailedObservation,
  discardFailedAnimalCreate: helperSpies.discardFailedAnimalCreate,
  discardFailedCoverReading: helperSpies.discardFailedCoverReading,
  isTerminalFailure: (row: { lastStatusCode: number | null }) =>
    row.lastStatusCode === 400 ||
    row.lastStatusCode === 404 ||
    row.lastStatusCode === 422,
}));

vi.mock('@/components/logger/OfflineProvider', () => ({
  useOffline: () => providerSpies,
}));

beforeEach(() => {
  failedRowsState.observations = [];
  failedRowsState.animals = [];
  failedRowsState.covers = [];
  for (const spy of Object.values(helperSpies)) spy.mockClear();
  providerSpies.syncNow.mockClear();
  providerSpies.refreshPendingCount.mockClear();
});

afterEach(() => {
  cleanup();
});

function seedTerminalAndTransient() {
  failedRowsState.observations = [
    {
      local_id: 11,
      type: 'camp_condition',
      camp_id: 'A',
      details: '{}',
      created_at: '2026-05-17T10:00:00Z',
      synced_at: null,
      sync_status: 'failed',
      clientLocalId: TERMINAL_OBS_UUID,
      attempts: 5,
      lastError: 'CAMP_CONDITION_FIELD_REQUIRED',
      firstFailedAt: Date.now() - 60 * 60_000,
      lastStatusCode: 422,
    },
    {
      local_id: 12,
      type: 'weighing',
      camp_id: 'A',
      details: '{}',
      created_at: '2026-05-17T10:05:00Z',
      synced_at: null,
      sync_status: 'failed',
      clientLocalId: TRANSIENT_OBS_UUID,
      attempts: 2,
      lastError: 'gateway timeout',
      firstFailedAt: Date.now() - 5 * 60_000,
      lastStatusCode: 504,
    },
  ];
}

describe('FailedSyncDialog — #324 terminal/poison row surfacing', () => {
  it('a terminal 422 row shows Discard (not Retry) and a "won\'t retry" affordance', async () => {
    seedTerminalAndTransient();
    const { default: FailedSyncDialog } = await import(
      '@/components/logger/FailedSyncDialog'
    );

    await act(async () => {
      render(<FailedSyncDialog isOpen={true} onClose={() => {}} />);
    });
    const terminalRow = await screen.findByTestId('failed-row-observation-11');

    // Poison row: a Discard control, and NO Retry control.
    const discardBtn = terminalRow.querySelector(
      '[data-testid="discard-row-observation-11"]',
    );
    expect(discardBtn).toBeTruthy();
    expect(
      terminalRow.querySelector('[data-testid="retry-row-observation-11"]'),
    ).toBeNull();
    expect(terminalRow.textContent).toMatch(/won.?t retry|rejected/i);

    // Transient row keeps its Retry control.
    const transientRow = screen.getByTestId('failed-row-observation-12');
    expect(
      transientRow.querySelector('[data-testid="retry-row-observation-12"]'),
    ).toBeTruthy();
    expect(
      transientRow.querySelector('[data-testid="discard-row-observation-12"]'),
    ).toBeNull();
  });

  it('clicking Discard on the poison row calls discardFailedObservation(localId)', async () => {
    seedTerminalAndTransient();
    helperSpies.discardFailedObservation.mockImplementation(async () => {
      failedRowsState.observations = failedRowsState.observations.filter(
        (o) => o.local_id !== 11,
      );
    });
    const { default: FailedSyncDialog } = await import(
      '@/components/logger/FailedSyncDialog'
    );

    await act(async () => {
      render(<FailedSyncDialog isOpen={true} onClose={() => {}} />);
    });
    await screen.findByTestId('failed-row-observation-11');

    await act(async () => {
      fireEvent.click(screen.getByTestId('discard-row-observation-11'));
    });

    expect(helperSpies.discardFailedObservation).toHaveBeenCalledTimes(1);
    expect(helperSpies.discardFailedObservation).toHaveBeenCalledWith(11);
    // The poison row never goes through the re-queue path.
    expect(helperSpies.markObservationPending).not.toHaveBeenCalled();
    // It drained out of the list.
    expect(screen.queryByTestId('failed-row-observation-11')).toBeNull();
  });

  it('Retry all only re-queues transient rows — never the poison row', async () => {
    seedTerminalAndTransient();
    const { default: FailedSyncDialog } = await import(
      '@/components/logger/FailedSyncDialog'
    );

    await act(async () => {
      render(<FailedSyncDialog isOpen={true} onClose={() => {}} />);
    });
    await screen.findByTestId('failed-row-observation-11');

    await act(async () => {
      fireEvent.click(screen.getByText('Retry all'));
    });

    // Only the transient row (local_id 12) was re-queued.
    expect(helperSpies.markObservationPending).toHaveBeenCalledTimes(1);
    expect(helperSpies.markObservationPending).toHaveBeenCalledWith(12);
    expect(helperSpies.markObservationPending).not.toHaveBeenCalledWith(11);
    expect(providerSpies.syncNow).toHaveBeenCalledTimes(1);
  });
});
