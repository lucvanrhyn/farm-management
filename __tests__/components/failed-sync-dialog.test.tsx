// @vitest-environment jsdom
/**
 * Issue #209 — FailedSyncDialog component-level spec.
 *
 * Locks the wiring between the dialog and the offline-store re-queue helpers
 * shipped by #208. The lib-level idempotency contract (clientLocalId
 * preservation across pending → failed → pending) is covered by
 * `__tests__/offline/retry-from-failed.test.ts`; this spec proves the dialog
 * *invokes* those helpers correctly and never mints a fresh UUID anywhere
 * on the retry path.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';

const OBS_UUID = '11111111-2222-4333-8444-555555555555';
const ANIMAL_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const COVER_UUID = '99999999-8888-4777-8666-555544443333';

const failedRowsState = vi.hoisted(() => ({
  observations: [] as Array<Record<string, unknown>>,
  animals: [] as Array<Record<string, unknown>>,
  covers: [] as Array<Record<string, unknown>>,
}));

const helperSpies = vi.hoisted(() => ({
  markObservationPending: vi.fn(async () => {}),
  markAnimalCreatePending: vi.fn(async () => {}),
  markCoverReadingPending: vi.fn(async () => {}),
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
}));

vi.mock('@/components/logger/OfflineProvider', () => ({
  useOffline: () => providerSpies,
}));

beforeEach(() => {
  failedRowsState.observations = [];
  failedRowsState.animals = [];
  failedRowsState.covers = [];
  helperSpies.markObservationPending.mockClear();
  helperSpies.markAnimalCreatePending.mockClear();
  helperSpies.markCoverReadingPending.mockClear();
  providerSpies.syncNow.mockClear();
  providerSpies.refreshPendingCount.mockClear();
});

afterEach(() => {
  cleanup();
});

function seedOneOfEach() {
  failedRowsState.observations = [
    {
      local_id: 11,
      type: 'camp_condition',
      camp_id: 'A',
      details: '{}',
      created_at: '2026-05-11T10:00:00Z',
      synced_at: null,
      sync_status: 'failed',
      clientLocalId: OBS_UUID,
      attempts: 2,
      lastError: 'gateway timeout',
      firstFailedAt: Date.now() - 5 * 60_000,
      lastStatusCode: 504,
    },
  ];
  failedRowsState.animals = [
    {
      local_id: 22,
      animal_id: 'KALF-1',
      sex: 'Female',
      category: 'Calf',
      current_camp: 'A',
      date_added: '2026-05-11',
      sync_status: 'failed',
      clientLocalId: ANIMAL_UUID,
      name: 'Sunny',
      attempts: 1,
      lastError: 'missing dam',
      firstFailedAt: Date.now() - 90_000,
      lastStatusCode: 422,
    },
  ];
  failedRowsState.covers = [
    {
      local_id: 33,
      farm_slug: 'farm',
      camp_id: 'B',
      cover_category: 'Fair',
      created_at: '2026-05-11T08:00:00Z',
      sync_status: 'failed',
      clientLocalId: COVER_UUID,
      attempts: 4,
      lastError: 'internal server error',
      firstFailedAt: Date.now() - 60 * 60_000,
      lastStatusCode: 500,
    },
  ];
}

describe('FailedSyncDialog — #209 dead-letter UI', () => {
  it('renders all three queue types with their metadata', async () => {
    seedOneOfEach();
    const { default: FailedSyncDialog } = await import(
      '@/components/logger/FailedSyncDialog'
    );

    await act(async () => {
      render(<FailedSyncDialog isOpen={true} onClose={() => {}} />);
    });

    expect(await screen.findByTestId('failed-row-observation-11')).toBeTruthy();
    expect(screen.getByTestId('failed-row-animal-22')).toBeTruthy();
    expect(screen.getByTestId('failed-row-cover-reading-33')).toBeTruthy();

    expect(screen.getByText('Camp condition')).toBeTruthy();
    expect(screen.getByText('Animal arrival')).toBeTruthy();
    expect(screen.getByText('Cover reading')).toBeTruthy();
  });

  it('per-row metadata (lastError, status code, attempts, relative time) is rendered', async () => {
    seedOneOfEach();
    const { default: FailedSyncDialog } = await import(
      '@/components/logger/FailedSyncDialog'
    );

    await act(async () => {
      render(<FailedSyncDialog isOpen={true} onClose={() => {}} />);
    });

    await screen.findByTestId('failed-row-observation-11');

    expect(screen.getByText('gateway timeout')).toBeTruthy();
    expect(screen.getByText('HTTP 504')).toBeTruthy();
    expect(screen.getByText('HTTP 422')).toBeTruthy();
    expect(screen.getByText('HTTP 500')).toBeTruthy();
    expect(screen.getByText('Attempted 2 times')).toBeTruthy();
    expect(screen.getByText('Attempted 1 time')).toBeTruthy();
    expect(screen.getByText('Attempted 4 times')).toBeTruthy();
  });

  it('per-row Retry invokes markObservationPending with the row local_id (no new UUID minted)', async () => {
    seedOneOfEach();
    const { default: FailedSyncDialog } = await import(
      '@/components/logger/FailedSyncDialog'
    );

    await act(async () => {
      render(<FailedSyncDialog isOpen={true} onClose={() => {}} />);
    });
    await screen.findByTestId('failed-row-observation-11');

    const obsRow = screen.getByTestId('failed-row-observation-11');
    const retryButton = obsRow.querySelector('button')!;
    await act(async () => {
      fireEvent.click(retryButton);
    });

    expect(helperSpies.markObservationPending).toHaveBeenCalledTimes(1);
    expect(helperSpies.markObservationPending).toHaveBeenCalledWith(11);
    expect(providerSpies.syncNow).toHaveBeenCalledTimes(1);

    expect(failedRowsState.observations[0].clientLocalId).toBe(OBS_UUID);
  });

  it('Retry all invokes the right helper per row and triggers exactly one sync pass', async () => {
    seedOneOfEach();
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

    expect(helperSpies.markObservationPending).toHaveBeenCalledTimes(1);
    expect(helperSpies.markObservationPending).toHaveBeenCalledWith(11);
    expect(helperSpies.markAnimalCreatePending).toHaveBeenCalledTimes(1);
    expect(helperSpies.markAnimalCreatePending).toHaveBeenCalledWith(22);
    expect(helperSpies.markCoverReadingPending).toHaveBeenCalledTimes(1);
    expect(helperSpies.markCoverReadingPending).toHaveBeenCalledWith(33);

    expect(providerSpies.syncNow).toHaveBeenCalledTimes(1);
  });

  it('auto-closes when the failed list drains', async () => {
    failedRowsState.observations = [
      {
        local_id: 11,
        type: 'camp_condition',
        camp_id: 'A',
        details: '{}',
        created_at: '2026-05-11T10:00:00Z',
        synced_at: null,
        sync_status: 'failed',
        clientLocalId: OBS_UUID,
        attempts: 1,
        lastError: 'oh no',
        firstFailedAt: Date.now() - 30_000,
        lastStatusCode: 500,
      },
    ];
    helperSpies.markObservationPending.mockImplementation(async () => {
      failedRowsState.observations = [];
    });

    const onClose = vi.fn();
    const { default: FailedSyncDialog } = await import(
      '@/components/logger/FailedSyncDialog'
    );

    await act(async () => {
      render(<FailedSyncDialog isOpen={true} onClose={onClose} />);
    });
    await screen.findByTestId('failed-row-observation-11');

    const retryButton = screen
      .getByTestId('failed-row-observation-11')
      .querySelector('button')!;
    await act(async () => {
      fireEvent.click(retryButton);
    });

    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing when isOpen is false (no IDB reads triggered)', async () => {
    seedOneOfEach();
    const { default: FailedSyncDialog } = await import(
      '@/components/logger/FailedSyncDialog'
    );

    render(<FailedSyncDialog isOpen={false} onClose={() => {}} />);

    expect(screen.queryByLabelText('Failed sync rows')).toBeNull();
    expect(screen.queryByTestId('failed-row-observation-11')).toBeNull();
  });
});
