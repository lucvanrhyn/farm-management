/**
 * @vitest-environment node
 *
 * Wave A1 — sync truthfulness gate.
 *
 * Bug context: `setLastSyncedAt` was called unconditionally at the end of
 * `refreshCachedData`, which `syncAndRefresh` always invokes after the
 * per-record upload loop. So when every queued observation failed (e.g. the
 * server allowlist drift that blocked `health_issue` and `animal_movement`
 * with a 422), the LoggerStatusBar still ticked "Synced: Just now" and the
 * pending badge stayed populated — a UI lie.
 *
 * Contract (this test enforces):
 *   1. Submits attempted, ALL failed   -> setLastSyncedAt MUST NOT be called.
 *   2. Submits attempted, partial OK   -> setLastSyncedAt SHOULD be called.
 *   3. Failure count is returned by `syncAndRefresh` so the UI layer can
 *      surface a red toast on `failed > 0`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const setLastSyncedAtMock = vi.fn(async () => {});
const markObservationSyncedMock = vi.fn(async () => {});
const markObservationFailedMock = vi.fn(async () => {});
const getPendingObservationsMock = vi.fn(async () => [] as unknown[]);

vi.mock("@/lib/offline-store", () => ({
  // Surfaces touched by the sync flow under test:
  getPendingObservations: getPendingObservationsMock,
  markObservationSynced: markObservationSyncedMock,
  markObservationFailed: markObservationFailedMock,
  setLastSyncedAt: setLastSyncedAtMock,
  clearPendingAnimalUpdate: vi.fn(),
  // Other surfaces touched indirectly by importing the module:
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
  seedCamps: vi.fn(),
  seedAnimals: vi.fn(),
  seedFarmSettings: vi.fn(),
  getCachedFarmSettings: vi.fn(async () => null),
}));

type FetchCall = { url: string; init?: RequestInit };
const fetchCalls: FetchCall[] = [];

function mockFetch(responder: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push({ url, init });
    return responder(url, init);
  }) as typeof fetch;
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function pendingObservation(localId: number, type: string) {
  return {
    local_id: localId,
    type,
    camp_id: "camp-1",
    animal_id: null,
    details: null,
    created_at: "2026-05-10T12:00:00.000Z",
    sync_status: "pending" as const,
  };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  fetchCalls.length = 0;
  setLastSyncedAtMock.mockClear();
  markObservationSyncedMock.mockClear();
  markObservationFailedMock.mockClear();
  getPendingObservationsMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("syncAndRefresh — lastSyncedAt truthfulness gate", () => {
  it("does NOT tick lastSyncedAt when all queued observations fail", async () => {
    getPendingObservationsMock.mockResolvedValue([
      pendingObservation(1, "health_issue"),
      pendingObservation(2, "animal_movement"),
    ]);

    // Server rejects every observation with 422 (the allowlist-drift symptom).
    // All cache-refresh GETs succeed so refreshCachedData itself is happy.
    mockFetch((url) => {
      if (url === "/api/observations") {
        return new Response(JSON.stringify({ error: "INVALID_TYPE" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "/api/camps") return jsonOk([]);
      if (url === "/api/camps/status") return jsonOk({});
      if (url === "/api/farm")
        return jsonOk({ farmName: "Test", breed: "Boran" });
      if (url.startsWith("/api/animals"))
        return jsonOk({ items: [], nextCursor: null, hasMore: false });
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const { syncAndRefresh } = await import("@/lib/sync-manager");
    const result = await syncAndRefresh();

    expect(result.failed).toBe(2);
    expect(result.synced).toBe(0);

    // The lie we are killing: previously this was called regardless.
    expect(setLastSyncedAtMock).not.toHaveBeenCalled();

    // Both must still be marked failed so the queue retries them.
    expect(markObservationFailedMock).toHaveBeenCalledWith(1);
    expect(markObservationFailedMock).toHaveBeenCalledWith(2);
  });

  it("DOES tick lastSyncedAt when at least one observation succeeds (partial success is real success)", async () => {
    getPendingObservationsMock.mockResolvedValue([
      pendingObservation(1, "weighing"), // will succeed
      pendingObservation(2, "animal_movement"), // will fail
    ]);

    let postCount = 0;
    mockFetch((url) => {
      if (url === "/api/observations") {
        postCount++;
        if (postCount === 1) {
          return jsonOk({ id: "srv-1" });
        }
        return new Response(JSON.stringify({ error: "INVALID_TYPE" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "/api/camps") return jsonOk([]);
      if (url === "/api/camps/status") return jsonOk({});
      if (url === "/api/farm")
        return jsonOk({ farmName: "Test", breed: "Boran" });
      if (url.startsWith("/api/animals"))
        return jsonOk({ items: [], nextCursor: null, hasMore: false });
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const { syncAndRefresh } = await import("@/lib/sync-manager");
    const result = await syncAndRefresh();

    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);

    // Partial success is a real success — the timestamp ticks.
    expect(setLastSyncedAtMock).toHaveBeenCalledTimes(1);
  });

  it("returns a non-zero `failed` count so the UI can surface a red toast", async () => {
    getPendingObservationsMock.mockResolvedValue([
      pendingObservation(1, "health_issue"),
    ]);

    mockFetch((url) => {
      if (url === "/api/observations") {
        return new Response(JSON.stringify({ error: "INVALID_TYPE" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "/api/camps") return jsonOk([]);
      if (url === "/api/camps/status") return jsonOk({});
      if (url === "/api/farm")
        return jsonOk({ farmName: "Test", breed: "Boran" });
      if (url.startsWith("/api/animals"))
        return jsonOk({ items: [], nextCursor: null, hasMore: false });
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const { syncAndRefresh } = await import("@/lib/sync-manager");
    const result = await syncAndRefresh();

    // The contract surface that LoggerStatusBar reads to render the failure
    // toast: a numeric `failed` field that exceeds zero on at least one
    // per-record failure.
    expect(result).toHaveProperty("failed");
    expect(result.failed).toBeGreaterThan(0);
  });
});
