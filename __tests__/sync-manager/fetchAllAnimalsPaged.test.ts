import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// P2 — Logger fan-out de-dupe. Default page size jumped from 500 → 1000 so that
// farms up to ~1000 animals (including Trio B's 874) fit in a single round trip
// instead of two sequential ones on a cold visit to /logger. Pagination remains
// the fallback for herds larger than a single page — this test file pins both
// the single-page fast path at the new default limit and the multi-page fallback.

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const seededAnimalBatches: unknown[][] = [];

vi.mock('@/lib/offline-store', () => ({
  seedCamps: vi.fn(async () => {}),
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
  clearPendingAnimalUpdate: vi.fn(),
}));

type FetchCall = { url: string };
const fetchCalls: FetchCall[] = [];

function mockFetch(responder: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetchCalls.push({ url });
    return responder(url);
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeAnimal(id: string) {
  return {
    animalId: id,
    name: `A ${id}`,
    sex: 'Female',
    dateOfBirth: null,
    breed: 'Brangus',
    category: 'Cow',
    currentCamp: 'A',
    status: 'Active',
    motherId: null,
    fatherId: null,
    dateAdded: '2026-01-01',
  };
}

beforeEach(() => {
  seededAnimalBatches.length = 0;
  fetchCalls.length = 0;
});

describe('fetchAllAnimalsPaged — default page size', () => {
  it('requests /api/animals with limit=1000 on the first call', async () => {
    mockFetch((url) => {
      if (url.startsWith('/api/animals')) {
        return jsonResponse({ items: [makeAnimal('001')], nextCursor: null, hasMore: false });
      }
      if (url === '/api/camps') return jsonResponse([]);
      if (url === '/api/farm') return jsonResponse({ farmName: 'F', breed: 'B' });
      if (url === '/api/camps/status') return jsonResponse({});
      return new Response('not found', { status: 404 });
    });

    const { refreshCachedData } = await import('@/lib/sync-manager');
    await refreshCachedData();

    const animalsCalls = fetchCalls.filter((c) => c.url.startsWith('/api/animals'));
    expect(animalsCalls).toHaveLength(1);
    expect(animalsCalls[0].url).toContain('limit=1000');
  });

  it('makes exactly ONE fetch for a farm with 874 animals (fits in one page)', async () => {
    // Trio B has 874 animals — this is the scenario that motivated the change.
    // The prior default (500) forced two sequential round-trips on every cold
    // logger visit; the new default collapses the common case to a single call.
    const allAnimals = Array.from({ length: 874 }, (_, i) =>
      makeAnimal(String(i + 1).padStart(3, '0')),
    );

    mockFetch((url) => {
      if (url.startsWith('/api/animals')) {
        return jsonResponse({ items: allAnimals, nextCursor: null, hasMore: false });
      }
      if (url === '/api/camps') return jsonResponse([]);
      if (url === '/api/farm') return jsonResponse({ farmName: 'F', breed: 'B' });
      if (url === '/api/camps/status') return jsonResponse({});
      return new Response('not found', { status: 404 });
    });

    const { refreshCachedData } = await import('@/lib/sync-manager');
    await refreshCachedData();

    const animalsCalls = fetchCalls.filter((c) => c.url.startsWith('/api/animals'));
    expect(animalsCalls).toHaveLength(1);
    expect(seededAnimalBatches).toHaveLength(1);
    expect(seededAnimalBatches[0]).toHaveLength(874);
  });

  it('falls back to multi-page pagination for herds larger than 1000', async () => {
    // Keep pagination working as a fallback — any farm above the default page
    // size must still be fetched completely via cursor walks.
    const firstPage = Array.from({ length: 1000 }, (_, i) =>
      makeAnimal(String(i + 1).padStart(4, '0')),
    );
    const secondPage = Array.from({ length: 500 }, (_, i) =>
      makeAnimal(String(i + 1001).padStart(4, '0')),
    );

    mockFetch((url) => {
      if (url.startsWith('/api/animals')) {
        if (url.includes('cursor=')) {
          return jsonResponse({ items: secondPage, nextCursor: null, hasMore: false });
        }
        return jsonResponse({ items: firstPage, nextCursor: '1000', hasMore: true });
      }
      if (url === '/api/camps') return jsonResponse([]);
      if (url === '/api/farm') return jsonResponse({ farmName: 'F', breed: 'B' });
      if (url === '/api/camps/status') return jsonResponse({});
      return new Response('not found', { status: 404 });
    });

    const { refreshCachedData } = await import('@/lib/sync-manager');
    await refreshCachedData();

    const animalsCalls = fetchCalls.filter((c) => c.url.startsWith('/api/animals'));
    expect(animalsCalls).toHaveLength(2);
    expect(animalsCalls[0].url).toContain('limit=1000');
    expect(animalsCalls[0].url).not.toContain('cursor=');
    expect(animalsCalls[1].url).toContain('cursor=1000');
    expect(seededAnimalBatches[0]).toHaveLength(1500);
  });
});
