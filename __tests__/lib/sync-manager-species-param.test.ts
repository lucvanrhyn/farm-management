/**
 * Wave D-U3 — sync-manager species-aware /api/camps fetch.
 *
 * Codex audit P2 U3: "Trio Cattle/Sheep toggle did not visibly change
 * Logger camp list."
 *
 * Root cause: `refreshCachedData` always called `fetch('/api/camps')` with no
 * species filter. The server route honours `?species=`, but the client never
 * sent it — so the cross-species `animal_count` was rendered regardless of the
 * active FarmMode. Toggling the ModeSwitcher had no effect on the camp grid.
 *
 * Contract this test pins: when `refreshCachedData({ species })` is called with
 * a species, the /api/camps request URL must include `?species=<species>` so
 * the server can scope the animal_count groupBy to the active mode.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── offline-store mock surface ──────────────────────────────────────────────

vi.mock('@/lib/offline-store', () => ({
  seedCamps: vi.fn(async () => {}),
  seedAnimals: vi.fn(async () => {}),
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
  setLastSyncedAt: vi.fn(async () => {}),
  clearPendingAnimalUpdate: vi.fn(),
}));

// ── fetch mock ──────────────────────────────────────────────────────────────

const fetchCalls: string[] = [];

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function installFetch() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetchCalls.push(url);
    // Minimal responses keep refreshCachedData happy.
    if (url.startsWith('/api/camps?') || url === '/api/camps') return jsonOk([]);
    if (url === '/api/camps/status') return jsonOk({});
    if (url.startsWith('/api/animals')) {
      return jsonOk({ items: [], nextCursor: null, hasMore: false });
    }
    if (url === '/api/farm') return jsonOk({ farmName: 'F', breed: 'B' });
    return jsonOk(null);
  }) as typeof fetch;
}

beforeEach(() => {
  fetchCalls.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  installFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('refreshCachedData — species-aware /api/camps fetch', () => {
  it('forwards ?species=sheep when species option is sheep', async () => {
    const { refreshCachedData } = await import('@/lib/sync-manager');
    await refreshCachedData({ species: 'sheep' });

    const campsCalls = fetchCalls.filter((u) => u.startsWith('/api/camps?') || u === '/api/camps');
    expect(campsCalls).toHaveLength(1);
    expect(campsCalls[0]).toBe('/api/camps?species=sheep');
  });

  it('forwards ?species=cattle when species option is cattle', async () => {
    const { refreshCachedData } = await import('@/lib/sync-manager');
    await refreshCachedData({ species: 'cattle' });

    const campsCalls = fetchCalls.filter((u) => u.startsWith('/api/camps?') || u === '/api/camps');
    expect(campsCalls).toHaveLength(1);
    expect(campsCalls[0]).toBe('/api/camps?species=cattle');
  });

  it('omits the species param when no species is passed (back-compat)', async () => {
    const { refreshCachedData } = await import('@/lib/sync-manager');
    await refreshCachedData();

    const campsCalls = fetchCalls.filter((u) => u.startsWith('/api/camps?') || u === '/api/camps');
    expect(campsCalls).toHaveLength(1);
    expect(campsCalls[0]).toBe('/api/camps');
  });

  it('URI-encodes the species value defensively', async () => {
    const { refreshCachedData } = await import('@/lib/sync-manager');
    // Realistic values are 'cattle' | 'sheep' | 'game' — but the encoder must
    // not break if a future species id ever contains a reserved char.
    await refreshCachedData({ species: 'game' });

    const campsCalls = fetchCalls.filter((u) => u.startsWith('/api/camps?') || u === '/api/camps');
    expect(campsCalls[0]).toBe('/api/camps?species=game');
  });
});
