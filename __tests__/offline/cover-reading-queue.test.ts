// @vitest-environment jsdom
/**
 * Tests for the offline cover-reading queue (Chunk 3 of logger data-loss fix).
 *
 * CampCoverLogForm was the third form that bypassed the offline queue. It was
 * POSTing directly to /api/{farmSlug}/camps/{campId}/cover — if signal dropped,
 * the cover reading vanished. Fix: form now calls onSubmit(data) callback;
 * parent page calls queueCoverReading() which stores to IndexedDB; syncAndRefresh
 * replays the POST when online.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

async function loadStore() {
  const mod = await import('@/lib/offline-store');
  mod.setActiveFarmSlug(`test-${Math.random().toString(36).slice(2)}`);
  return mod;
}

describe('queueCoverReading', () => {
  it('stores a pending cover reading in IndexedDB', async () => {
    const { queueCoverReading, getPendingCoverReadings } = await loadStore();

    await queueCoverReading({
      farm_slug: 'test-farm',
      camp_id: 'camp-1',
      cover_category: 'Good',
      created_at: '2026-04-22T10:00:00.000Z',
      sync_status: 'pending',
    });

    const readings = await getPendingCoverReadings();
    expect(readings).toHaveLength(1);
    expect(readings[0].cover_category).toBe('Good');
    expect(readings[0].camp_id).toBe('camp-1');
    expect(readings[0].farm_slug).toBe('test-farm');
    expect(readings[0].sync_status).toBe('pending');
  });

  it('stores a blob with the reading for later photo upload', async () => {
    const { queueCoverReading, getPendingCoverReadings } = await loadStore();
    const blob = new Blob(['img'], { type: 'image/jpeg' });

    await queueCoverReading({
      farm_slug: 'test-farm',
      camp_id: 'camp-1',
      cover_category: 'Fair',
      created_at: '2026-04-22T10:00:00.000Z',
      photo_blob: blob,
      sync_status: 'pending',
    });

    const readings = await getPendingCoverReadings();
    // fake-indexeddb doesn't preserve Blob identity through structured clone;
    // assert non-null to confirm the field was stored and round-tripped at all.
    expect(readings[0].photo_blob).toBeTruthy();
  });

  it('multiple cover readings stack as individual pending rows', async () => {
    const { queueCoverReading, getPendingCoverReadings } = await loadStore();

    await queueCoverReading({ farm_slug: 'f', camp_id: 'c-1', cover_category: 'Good', created_at: '', sync_status: 'pending' });
    await queueCoverReading({ farm_slug: 'f', camp_id: 'c-2', cover_category: 'Poor', created_at: '', sync_status: 'pending' });

    const readings = await getPendingCoverReadings();
    expect(readings).toHaveLength(2);
  });
});

describe('markCoverReadingSynced', () => {
  it('removes reading from pending list after sync', async () => {
    const { queueCoverReading, markCoverReadingSynced, getPendingCoverReadings } = await loadStore();

    const id = await queueCoverReading({
      farm_slug: 'f', camp_id: 'c', cover_category: 'Good',
      created_at: '', sync_status: 'pending',
    });
    await markCoverReadingSynced(id);

    const readings = await getPendingCoverReadings();
    expect(readings).toHaveLength(0);
  });
});

describe('markCoverReadingFailed', () => {
  // Issue #208 — failed rows now move out of the pending bucket into their
  // own (sticky) failed bucket. The auto-retry behaviour that this test
  // originally pinned is gone; #209's retry-from-UI nudges failed rows back
  // to pending explicitly.
  it('moves reading from pending bucket into failed bucket', async () => {
    const {
      queueCoverReading,
      markCoverReadingFailed,
      getPendingCoverReadings,
      getFailedCoverReadings,
    } = await loadStore();

    const id = await queueCoverReading({
      farm_slug: 'f', camp_id: 'c', cover_category: 'Poor',
      created_at: '', sync_status: 'pending',
    });
    await markCoverReadingFailed(id, { statusCode: 500, error: 'server explode' });

    const pending = await getPendingCoverReadings();
    expect(pending).toHaveLength(0);

    const failed = await getFailedCoverReadings();
    expect(failed).toHaveLength(1);
    expect(failed[0].sync_status).toBe('failed');
    expect(failed[0].lastStatusCode).toBe(500);
    expect(failed[0].lastError).toBe('server explode');
  });
});

describe('markCoverReadingPosted', () => {
  it('persists server_reading_id to prevent duplicate row creation on retry', async () => {
    const { queueCoverReading, markCoverReadingPosted, getPendingCoverReadings } = await loadStore();

    const id = await queueCoverReading({
      farm_slug: 'f', camp_id: 'c', cover_category: 'Fair',
      created_at: '', sync_status: 'pending',
    });
    await markCoverReadingPosted(id, 'server-reading-xyz');

    const readings = await getPendingCoverReadings();
    expect(readings[0].server_reading_id).toBe('server-reading-xyz');
    // Still pending — photo PATCH hasn't run yet
    expect(readings[0].sync_status).toBe('pending');
  });
});

describe('getPendingCount includes cover readings', () => {
  it('counts queued cover readings in total pending badge', async () => {
    const { queueCoverReading, getPendingCount } = await loadStore();

    const before = await getPendingCount();
    await queueCoverReading({ farm_slug: 'f', camp_id: 'c', cover_category: 'Good', created_at: '', sync_status: 'pending' });
    const after = await getPendingCount();

    expect(after).toBe(before + 1);
  });
});
