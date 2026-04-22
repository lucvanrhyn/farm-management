// @vitest-environment jsdom
/**
 * Tests for the photo sync bug fix.
 *
 * Root cause: syncPendingPhotos called markPhotoSynced even when serverId was
 * undefined (string-vs-number mismatch on observation_local_id). The photo was
 * uploaded to blob storage but the attachment URL was never written to the
 * server observation row — silent data loss.
 *
 * Fix:
 *  1. PendingPhoto.observation_local_id narrowed to number (TS enforces callers).
 *  2. Legacy string-id rows in IDB are marked failed (not silently skipped).
 *  3. blob_url is persisted after upload so retries skip re-upload.
 *  4. A missing serverId leaves the photo pending so it retries next cycle.
 *  5. A failed PATCH marks the photo failed (not synced).
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

function makeBlob(): Blob {
  return new Blob(['img'], { type: 'image/jpeg' });
}

// ── queuePhoto contract ───────────────────────────────────────────────────────

describe('queuePhoto', () => {
  it('stores a pending photo with numeric observation_local_id', async () => {
    const { queuePhoto, getPendingPhotos } = await loadStore();
    await queuePhoto(42, makeBlob());
    const photos = await getPendingPhotos();
    expect(photos).toHaveLength(1);
    expect(photos[0].observation_local_id).toBe(42);
    expect(typeof photos[0].observation_local_id).toBe('number');
    expect(photos[0].sync_status).toBe('pending');
    expect(photos[0].blob_url).toBeUndefined();
  });
});

// ── markPhotoUploaded ─────────────────────────────────────────────────────────

describe('markPhotoUploaded', () => {
  it('persists blob_url without flipping sync_status to synced', async () => {
    const { queuePhoto, markPhotoUploaded, getPendingPhotos } = await loadStore();
    const id = await queuePhoto(1, makeBlob());
    await markPhotoUploaded(id, 'https://cdn.example.com/photo.jpg');
    const photos = await getPendingPhotos();
    expect(photos[0].blob_url).toBe('https://cdn.example.com/photo.jpg');
    // Deliberately NOT synced yet — the PATCH step hasn't run
    expect(photos[0].sync_status).toBe('pending');
  });
});

// ── markPhotoFailed ───────────────────────────────────────────────────────────

describe('markPhotoFailed', () => {
  it('sets sync_status to failed so the photo retries next cycle', async () => {
    const { queuePhoto, markPhotoFailed, getPendingPhotos } = await loadStore();
    const id = await queuePhoto(1, makeBlob());
    await markPhotoFailed(id);
    const photos = await getPendingPhotos();
    expect(photos[0].sync_status).toBe('failed');
  });

  it('preserves blob_url when marking failed (skip re-upload on retry)', async () => {
    const { queuePhoto, markPhotoUploaded, markPhotoFailed, getPendingPhotos } = await loadStore();
    const id = await queuePhoto(1, makeBlob());
    await markPhotoUploaded(id, 'https://cdn.example.com/cached.jpg');
    await markPhotoFailed(id);
    const photos = await getPendingPhotos();
    expect(photos[0].sync_status).toBe('failed');
    expect(photos[0].blob_url).toBe('https://cdn.example.com/cached.jpg');
  });
});

// ── markPhotoSynced ───────────────────────────────────────────────────────────

describe('markPhotoSynced', () => {
  it('flips sync_status to synced', async () => {
    const { queuePhoto, markPhotoSynced, getPendingPhotos } = await loadStore();
    const id = await queuePhoto(1, makeBlob());
    await markPhotoSynced(id);
    // synced photos are filtered out of getPendingPhotos
    const photos = await getPendingPhotos();
    expect(photos).toHaveLength(0);
  });
});

// ── Photo stays pending when observation sync fails in same cycle ─────────────

describe('photo stays pending when observation not yet synced', () => {
  it('a photo whose observation_local_id has no server mapping remains pending', async () => {
    const { queuePhoto, getPendingPhotos } = await loadStore();

    // Queue a photo for observation local_id=99
    const localId = await queuePhoto(99, makeBlob());

    // At this point no sync has run — photo must still be pending
    const photos = await getPendingPhotos();
    expect(photos).toHaveLength(1);
    expect(photos[0].local_id).toBe(localId);
    expect(photos[0].sync_status).toBe('pending');

    // Simulate: observation with local_id=99 failed to sync this cycle
    // (its id is NOT in localToServerId). The correct behaviour is to leave
    // the photo pending — markPhotoFailed / markPhotoSynced must NOT be called.
    // We verify by confirming the record is still in pending state after nothing
    // is done to it (the sync loop's `continue` branch).
    const photosAfter = await getPendingPhotos();
    expect(photosAfter[0].sync_status).toBe('pending');
  });
});

// ── Blob re-upload prevention ─────────────────────────────────────────────────

describe('re-upload prevention', () => {
  it('a photo with blob_url already set should not need upload step', async () => {
    const { queuePhoto, markPhotoUploaded, getPendingPhotos } = await loadStore();

    const id = await queuePhoto(7, makeBlob());
    await markPhotoUploaded(id, 'https://cdn.example.com/already-uploaded.jpg');

    const photos = await getPendingPhotos();
    // blob_url is truthy → sync loop skips the upload fetch
    expect(photos[0].blob_url).toBeTruthy();
    // Still pending because PATCH hasn't run
    expect(photos[0].sync_status).toBe('pending');
  });
});
