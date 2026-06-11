// @vitest-environment node
/**
 * S4 / OS-1 (stress-test remediation 2026-06-01) — offline drain ordering.
 *
 * Root cause pinned here: `syncAndRefresh` drained animals + observations
 * concurrently via `Promise.all`, so an observation referencing an animal
 * that was itself still queued (the offline-calf case) could POST before the
 * animal-create landed. The server answered 404 for the unknown animal, the
 * failure classifier saw a terminal-by-status code, and the observation was
 * permanently dead-lettered — silent data loss for a row that would have
 * succeeded had the drain run in dependency order.
 *
 * Contract pinned by this suite:
 *   1. Every pending animal-create POST completes BEFORE the first
 *      observation POST is attempted (create-before-observe ordering).
 *   2. The old loss scenario (calf + calf-observation queued together while
 *      offline) drains with zero failures on the first reconnect cycle.
 *
 * Harness mirrors `__tests__/sync/sync-manager-truth.test.ts`: offline-store
 * fully mocked (node env, no IDB), real `lib/sync/queue` facade backed by an
 * in-memory metadata map, and a STATEFUL fetch mock that behaves like the
 * server: an observation for an animal the server has not yet seen returns
 * 404, mirroring the production `/api/observations` not-found path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted shared mock state (feedback-vi-hoisted-shared-mocks.md) ─────────
const mocks = vi.hoisted(() => ({
  getPendingObservations: vi.fn(async () => [] as unknown[]),
  getPendingAnimalCreates: vi.fn(async () => [] as unknown[]),
  getPendingCoverReadings: vi.fn(async () => [] as unknown[]),
  getPendingPhotos: vi.fn(async () => [] as unknown[]),
  markObservationFailed: vi.fn(async () => {}),
  markAnimalCreateFailed: vi.fn(async () => {}),
  memMetadata: new Map<string, string>(),
}));

vi.mock('@/lib/offline-store', () => ({
  getPendingObservations: mocks.getPendingObservations,
  getPendingAnimalCreates: mocks.getPendingAnimalCreates,
  getPendingCoverReadings: mocks.getPendingCoverReadings,
  getPendingPhotos: mocks.getPendingPhotos,
  getFailedObservations: vi.fn(async () => []),
  getFailedAnimals: vi.fn(async () => []),
  getFailedCoverReadings: vi.fn(async () => []),
  getFailedObservationsCount: vi.fn(async () => 0),
  getFailedAnimalCreatesCount: vi.fn(async () => 0),
  getFailedCoverReadingsCount: vi.fn(async () => 0),
  getFailedPhotosCount: vi.fn(async () => 0),
  getSyncMetadataValue: vi.fn(async (key: string) => mocks.memMetadata.get(key) ?? null),
  setSyncMetadataValue: vi.fn(async (key: string, value: string) => {
    mocks.memMetadata.set(key, value);
  }),
  markObservationSynced: vi.fn(async () => {}),
  markObservationFailed: mocks.markObservationFailed,
  markAnimalCreateSynced: vi.fn(async () => {}),
  markAnimalCreateFailed: mocks.markAnimalCreateFailed,
  markPhotoSynced: vi.fn(async () => {}),
  markPhotoUploaded: vi.fn(async () => {}),
  markPhotoFailed: vi.fn(async () => {}),
  markCoverReadingSynced: vi.fn(async () => {}),
  markCoverReadingFailed: vi.fn(async () => {}),
  markCoverReadingPosted: vi.fn(async () => {}),
  clearPendingAnimalUpdate: vi.fn(async () => {}),
  seedCamps: vi.fn(async () => {}),
  seedCampsForMode: vi.fn(async () => {}),
  seedAnimals: vi.fn(async () => {}),
  seedFarmSettings: vi.fn(async () => {}),
  getCachedFarmSettings: vi.fn(async () => null),
  queueObservation: vi.fn(async () => 1),
  queueAnimalCreate: vi.fn(async () => 1),
  queueCoverReading: vi.fn(async () => 1),
  queuePhoto: vi.fn(async () => 1),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

const CALF_ID = 'KALF-2026-01';

function pendingCalfCreate() {
  return {
    local_id: 1,
    animal_id: CALF_ID,
    name: undefined,
    sex: 'Female',
    category: 'Calf',
    current_camp: 'camp-1',
    mother_id: 'BB-C014',
    date_added: '2026-06-01',
    species: 'cattle',
    sync_status: 'pending' as const,
    clientLocalId: 'calf-uuid-001',
    attempts: 0,
    firstFailedAt: null,
    lastError: null,
    lastStatusCode: null,
  };
}

function pendingCalfObservation() {
  return {
    local_id: 11,
    type: 'health_issue',
    camp_id: 'camp-1',
    animal_id: CALF_ID,
    details: '{"issue":"navel check"}',
    created_at: '2026-06-01T08:00:00.000Z',
    sync_status: 'pending' as const,
    clientLocalId: 'obs-uuid-001',
    attempts: 0,
    firstFailedAt: null,
    lastError: null,
    lastStatusCode: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Stateful server double: animals POSTed to /api/animals are registered;
 * an observation for an unregistered animal returns the production 404
 * not-found shape. Records the order of write attempts.
 */
function installStatefulServer() {
  const serverAnimals = new Set<string>();
  const writeOrder: Array<'animal-create' | 'observation'> = [];

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';

    if (url === '/api/animals' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { animalId: string };
      writeOrder.push('animal-create');
      serverAnimals.add(body.animalId);
      return jsonResponse({ id: `srv-${body.animalId}` });
    }
    if (url === '/api/observations' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { animal_id: string | null };
      writeOrder.push('observation');
      if (body.animal_id && !serverAnimals.has(body.animal_id)) {
        return jsonResponse({ error: 'ANIMAL_NOT_FOUND' }, 404);
      }
      return jsonResponse({ id: 'srv-obs-1' });
    }

    // Cache-pull GETs.
    if (url === '/api/camps' || url.startsWith('/api/camps?')) return jsonResponse([]);
    if (url === '/api/camps/status') return jsonResponse({});
    if (url === '/api/farm') return jsonResponse({ farmName: 'Test', breed: 'Boran' });
    if (url.startsWith('/api/animals')) {
      return jsonResponse({ items: [], nextCursor: null, hasMore: false });
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  }) as typeof fetch;

  return { serverAnimals, writeOrder };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.memMetadata.clear();
  mocks.getPendingObservations.mockResolvedValue([]);
  mocks.getPendingAnimalCreates.mockResolvedValue([]);
  mocks.getPendingCoverReadings.mockResolvedValue([]);
  mocks.getPendingPhotos.mockResolvedValue([]);
  mocks.markObservationFailed.mockClear();
  mocks.markAnimalCreateFailed.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('syncAndRefresh — S4/OS-1 drain ordering (animals before observations)', () => {
  it('drains every pending animal-create to completion before the first observation POST', async () => {
    mocks.getPendingAnimalCreates.mockResolvedValue([pendingCalfCreate()]);
    mocks.getPendingObservations.mockResolvedValue([pendingCalfObservation()]);
    const { writeOrder } = installStatefulServer();

    const { syncAndRefresh } = await import('@/lib/sync-manager');
    await syncAndRefresh();

    const firstObservation = writeOrder.indexOf('observation');
    const lastAnimalCreate = writeOrder.lastIndexOf('animal-create');
    expect(lastAnimalCreate).toBeGreaterThanOrEqual(0);
    expect(firstObservation).toBeGreaterThanOrEqual(0);
    expect(lastAnimalCreate).toBeLessThan(firstObservation);
  });

  it('offline-queued calf + calf-observation both sync on the first reconnect drain (old loss scenario resolved)', async () => {
    mocks.getPendingAnimalCreates.mockResolvedValue([pendingCalfCreate()]);
    mocks.getPendingObservations.mockResolvedValue([pendingCalfObservation()]);
    installStatefulServer();

    const { syncAndRefresh } = await import('@/lib/sync-manager');
    const result = await syncAndRefresh();

    // Both rows land server-side in one cycle; nothing dead-letters.
    expect(result.failed).toBe(0);
    expect(result.synced).toBe(2);
    expect(mocks.markObservationFailed).not.toHaveBeenCalled();
    expect(mocks.markAnimalCreateFailed).not.toHaveBeenCalled();
  });

  it('an observation for a genuinely-unknown animal still fails (ordering fix must not mask real 404s)', async () => {
    mocks.getPendingObservations.mockResolvedValue([
      { ...pendingCalfObservation(), animal_id: 'GHOST-999', local_id: 12, clientLocalId: 'obs-uuid-002' },
    ]);
    installStatefulServer();

    const { syncAndRefresh } = await import('@/lib/sync-manager');
    const result = await syncAndRefresh();

    expect(result.failed).toBe(1);
    expect(mocks.markObservationFailed).toHaveBeenCalledTimes(1);
  });
});
