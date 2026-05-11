import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Silence the low-volume warn/error noise emitted on fetch-failure paths —
// we assert returns/behaviours directly instead of scraping console output.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

// Stub the offline-store write surface — we only care that
// fetchAllAnimalsPaged walks pages correctly.
const seededAnimalBatches: unknown[][] = [];
const seededFarmSettings: unknown[] = [];
const seededCamps: unknown[][] = [];

vi.mock('@/lib/offline-store', () => ({
  seedCamps: vi.fn(async (c: unknown[]) => {
    seededCamps.push(c);
  }),
  seedAnimals: vi.fn(async (a: unknown[]) => {
    seededAnimalBatches.push(a);
  }),
  seedFarmSettings: vi.fn(async (s: unknown) => {
    seededFarmSettings.push(s);
  }),
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

type FetchCall = { url: string; init?: RequestInit };
const fetchCalls: FetchCall[] = [];

function mockFetch(responder: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetchCalls.push({ url, init });
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
  seededFarmSettings.length = 0;
  seededCamps.length = 0;
  fetchCalls.length = 0;
});

describe('refreshCachedData — animals pagination', () => {
  it('stops after one request when the server reports hasMore=false', async () => {
    mockFetch((url) => {
      if (url.startsWith('/api/animals')) {
        return jsonResponse({
          items: [makeAnimal('001'), makeAnimal('002')],
          nextCursor: null,
          hasMore: false,
        });
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
    expect(seededAnimalBatches).toHaveLength(1);
    expect(seededAnimalBatches[0]).toHaveLength(2);
  });

  it('walks cursors across multiple pages and passes the cursor back correctly', async () => {
    const batches = [
      {
        url: /cursor=/,
        matcher: (u: string) => u.includes('cursor=B'),
        body: { items: [makeAnimal('C'), makeAnimal('D')], nextCursor: null, hasMore: false },
      },
    ];
    mockFetch((url) => {
      if (url.startsWith('/api/animals')) {
        const matched = batches.find((b) => b.matcher(url));
        if (matched) return jsonResponse(matched.body);
        // First page (no cursor)
        return jsonResponse({
          items: [makeAnimal('A'), makeAnimal('B')],
          nextCursor: 'B',
          hasMore: true,
        });
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
    expect(animalsCalls[0].url).not.toContain('cursor=');
    expect(animalsCalls[1].url).toContain('cursor=B');

    // seedAnimals receives the combined list, not per-page batches.
    expect(seededAnimalBatches).toHaveLength(1);
    const flat = seededAnimalBatches[0] as Array<{ animal_id: string }>;
    expect(flat.map((a) => a.animal_id)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('skips seedAnimals entirely when a page request fails mid-walk', async () => {
    mockFetch((url) => {
      if (url.startsWith('/api/animals')) {
        if (url.includes('cursor=')) {
          return new Response('server error', { status: 500 });
        }
        return jsonResponse({
          items: [makeAnimal('A')],
          nextCursor: 'A',
          hasMore: true,
        });
      }
      if (url === '/api/camps') return jsonResponse([]);
      if (url === '/api/farm') return jsonResponse({ farmName: 'F', breed: 'B' });
      if (url === '/api/camps/status') return jsonResponse({});
      return new Response('not found', { status: 404 });
    });

    const { refreshCachedData } = await import('@/lib/sync-manager');
    await refreshCachedData();

    // On pagination failure, animals seed is skipped entirely — orphan-sweep
    // protection keeps the prior cache intact rather than half-wiping it.
    expect(seededAnimalBatches).toHaveLength(0);
    // Other refreshes still succeed.
    expect(seededCamps).toHaveLength(1);
    expect(seededFarmSettings).toHaveLength(1);
  });

  it('seeds heroImageUrl from /api/farm response into cached settings', async () => {
    mockFetch((url) => {
      if (url.startsWith('/api/animals')) {
        return jsonResponse({ items: [], nextCursor: null, hasMore: false });
      }
      if (url === '/api/camps') return jsonResponse([]);
      if (url === '/api/farm') {
        return jsonResponse({
          farmName: 'Trio B',
          breed: 'Brangus',
          heroImageUrl: '/farm-custom.jpg',
        });
      }
      if (url === '/api/camps/status') return jsonResponse({});
      return new Response('not found', { status: 404 });
    });

    const { refreshCachedData } = await import('@/lib/sync-manager');
    await refreshCachedData();

    expect(seededFarmSettings).toHaveLength(1);
    expect(seededFarmSettings[0]).toEqual({
      farmName: 'Trio B',
      breed: 'Brangus',
      heroImageUrl: '/farm-custom.jpg',
    });
  });

  // PRD #194 wave 3 / #197: the "refreshCachedData updates lastSyncedAt"
  // invariant was deleted alongside the legacy `setLastSyncedAt` setter.
  // Cache pulls no longer tick truth — only `syncAndRefresh` records cycle
  // outcomes via `recordSyncAttempt`. See
  // `__tests__/sync/sync-manager-truth.test.ts` for the canonical truth-tick
  // contract.
});
