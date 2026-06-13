// @vitest-environment node
/**
 * S7 / MS-1 (stress-test remediation 2026-06-01) — species must survive the
 * animal seed mapper.
 *
 * Root cause pinned here: `mapPrismaAnimal` (lib/sync-manager.ts) dropped the
 * `species` field when converting the `/api/animals` wire shape into the IDB
 * `Animal` row. Every logger consumer filters the cached herd with
 * `(a.species ?? "cattle") === mode`, so on a sheep or game farm the seeded
 * rows (species: undefined → defaulted "cattle") never matched the active
 * mode and the mobile logger rendered an EMPTY list despite a healthy herd.
 *
 * Contract pinned by this suite:
 *   1. Rows handed to `seedAnimals` carry the server's `species` verbatim.
 *   2. The seed fetch stays CROSS-species (no `?species=` on /api/animals).
 *      This is a deliberate correction of the remediation brief's
 *      "defense-in-depth: pass ?species=mode" suggestion: `seedAnimals`
 *      orphan-sweeps any cached row missing from the payload, and the
 *      `animals` store is NOT mode-partitioned (unlike camps, issue #437).
 *      A species-scoped seed would therefore wipe the other species' herd
 *      from the device on every refresh — the exact bug class #437 fixed
 *      for camps. Cross-species seed + species-aware client filter is the
 *      correct pairing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const seededAnimalBatches: unknown[][] = [];

vi.mock('@/lib/offline-store', () => ({
  seedCamps: vi.fn(async () => {}),
  seedCampsForMode: vi.fn(async () => {}),
  seedAnimals: vi.fn(async (a: unknown[]) => {
    seededAnimalBatches.push(a);
  }),
  seedFarmSettings: vi.fn(async () => {}),
  getCachedFarmSettings: vi.fn(async () => null),
  getPendingObservations: vi.fn(async () => []),
  markObservationSynced: vi.fn(),
  markObservationFailed: vi.fn(),
  getPendingAnimalCreates: vi.fn(async () => []),
  markAnimalCreateSynced: vi.fn(),
  markAnimalCreateFailed: vi.fn(),
  getPendingPhotos: vi.fn(async () => []),
  markPhotoSynced: vi.fn(),
  markPhotoFailed: vi.fn(),
  markPhotoUploaded: vi.fn(),
  getPendingCoverReadings: vi.fn(async () => []),
  markCoverReadingSynced: vi.fn(),
  markCoverReadingFailed: vi.fn(),
  markCoverReadingPosted: vi.fn(),
  clearPendingAnimalUpdate: vi.fn(),
}));

const fetchCalls: string[] = [];

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function prismaAnimal(animalId: string, species: string) {
  return {
    id: `row-${animalId}`,
    animalId,
    name: null,
    sex: 'Female',
    dateOfBirth: null,
    breed: 'Dorper',
    category: 'Ewe',
    currentCamp: 'camp-1',
    status: 'Active',
    species,
    motherId: null,
    fatherId: null,
    mobId: null,
    registrationNumber: null,
    dateAdded: '2026-06-01',
    deceasedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
  };
}

function installFetch(animals: unknown[]) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetchCalls.push(url);
    if (url.startsWith('/api/camps?') || url === '/api/camps') return jsonOk([]);
    if (url === '/api/camps/status') return jsonOk({});
    if (url.startsWith('/api/animals')) {
      return jsonOk({ items: animals, nextCursor: null, hasMore: false });
    }
    if (url === '/api/farm') return jsonOk({ farmName: 'F', breed: 'B' });
    return jsonOk(null);
  }) as typeof fetch;
}

beforeEach(() => {
  fetchCalls.length = 0;
  seededAnimalBatches.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('refreshCachedData — species flows through the animal seed (MS-1)', () => {
  it('seeded rows carry the server species verbatim (sheep herd stays sheep in IDB)', async () => {
    installFetch([prismaAnimal('OOI-001', 'sheep'), prismaAnimal('BB-C014', 'cattle')]);

    const { refreshCachedData } = await import('@/lib/sync-manager');
    await refreshCachedData({ species: 'sheep' });

    expect(seededAnimalBatches).toHaveLength(1);
    const rows = seededAnimalBatches[0] as Array<{ animal_id: string; species?: string }>;
    expect(rows.map((r) => ({ animal_id: r.animal_id, species: r.species }))).toEqual([
      { animal_id: 'OOI-001', species: 'sheep' },
      { animal_id: 'BB-C014', species: 'cattle' },
    ]);
  });

  it('the animal seed fetch stays cross-species — no ?species= filter on /api/animals', async () => {
    installFetch([prismaAnimal('OOI-001', 'sheep')]);

    const { refreshCachedData } = await import('@/lib/sync-manager');
    await refreshCachedData({ species: 'sheep' });

    const animalCalls = fetchCalls.filter((u) => u.startsWith('/api/animals'));
    expect(animalCalls.length).toBeGreaterThan(0);
    for (const call of animalCalls) {
      expect(call).not.toContain('species=');
    }
  });
});
