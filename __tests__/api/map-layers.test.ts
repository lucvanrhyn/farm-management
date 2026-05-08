/**
 * Phase K — Wave 2C — Map data + GIS proxy route tests.
 *
 * Covers:
 *   /api/[farmSlug]/map/water-points
 *   /api/[farmSlug]/map/infrastructure
 *   /api/[farmSlug]/map/rainfall-gauges
 *   /api/[farmSlug]/map/task-pins
 *   /api/map/gis/afis
 *   /api/map/gis/saws-fdi
 *   /api/map/gis/eskom-se-push/allowances
 *   /api/map/gis/eskom-se-push/status/[areaId]
 *   /api/map/gis/fmd-zones
 *
 * Contract:
 *   - Tenant endpoints: valid GeoJSON FeatureCollection; reject cross-tenant
 *     with AUTH_REQUIRED (401). Wave G3 (#167) — the slug-aware adapter
 *     `tenantReadSlug` collapses both no-session and cross-tenant failure
 *     into a single 401 AUTH_REQUIRED envelope (since
 *     `getFarmContextForSlug` returns `null` for both branches without
 *     classifying). This matches the canonical Wave A-G2 pattern.
 *   - GIS proxies on upstream failure: HTTP 200 with `_stale: true` + `_error`.
 *   - Eskom without token: returns stale envelope, NOT 500.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ── next-auth + credentials plumbing ────────────────────────────────────
const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: () => ({ id: "credentials" }),
}));

// ── farm-prisma ─────────────────────────────────────────────────────────
const mockGameWaterPointFindMany = vi.fn();
const mockGameInfrastructureFindMany = vi.fn();
const mockRainfallFindMany = vi.fn();
const mockTaskFindMany = vi.fn();
const mockCampFindMany = vi.fn();

const mockPrisma = {
  gameWaterPoint: { findMany: mockGameWaterPointFindMany },
  gameInfrastructure: { findMany: mockGameInfrastructureFindMany },
  rainfallRecord: { findMany: mockRainfallFindMany },
  task: { findMany: mockTaskFindMany },
  camp: { findMany: mockCampFindMany },
} as const;

const mockGetPrismaForSlugWithAuth = vi.fn();
const mockGetPrismaWithAuth = vi.fn();
const mockGetPrismaForFarm = vi.fn();
vi.mock("@/lib/farm-prisma", () => ({
  getPrismaForSlugWithAuth: (...args: unknown[]) =>
    mockGetPrismaForSlugWithAuth(...args),
  // Phase G (P6.5): `getFarmContextForSlug` first tries the cookie-scoped
  // `getFarmContext`, which falls back to `getPrismaWithAuth(session)` when
  // there are no signed headers (tests don't provide any). Mock both so the
  // fall-through reaches `getPrismaForSlugWithAuth` via the slug-mismatch
  // path. The cookie-scoped helper always returns { error } here so the
  // slug-validated helper re-issues the URL-slug auth.
  getPrismaWithAuth: (...args: unknown[]) => mockGetPrismaWithAuth(...args),
  getPrismaForFarm: (...args: unknown[]) => mockGetPrismaForFarm(...args),

  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

// ── helpers ─────────────────────────────────────────────────────────────
const params = (slug = "trio-b-boerdery"): Promise<{ farmSlug: string }> =>
  Promise.resolve({ farmSlug: slug });

function sessionForFarms(slugs: string[]) {
  mockGetServerSession.mockResolvedValue({
    user: {
      id: "user-1",
      email: "u@test",
      farms: slugs.map((s) => ({ slug: s, role: "ADMIN" })),
    },
  });
}

function dbResolvesFor(slug: string) {
  mockGetPrismaForSlugWithAuth.mockImplementation(
    async (_session: unknown, urlSlug: string) => {
      if (urlSlug !== slug) {
        return { error: "Forbidden", status: 403 } as const;
      }
      return { prisma: mockPrisma, slug, role: "ADMIN" } as const;
    },
  );
}

function dbForbids() {
  mockGetPrismaForSlugWithAuth.mockResolvedValue({
    error: "Forbidden",
    status: 403,
  });
}

function resetAll() {
  mockGetServerSession.mockReset();
  mockGetPrismaForSlugWithAuth.mockReset();
  mockGetPrismaWithAuth.mockReset();
  mockGetPrismaForFarm.mockReset();
  mockGameWaterPointFindMany.mockReset();
  mockGameInfrastructureFindMany.mockReset();
  mockRainfallFindMany.mockReset();
  mockTaskFindMany.mockReset();
  mockCampFindMany.mockReset();

  // Phase G: getFarmContext (cookie-scoped) tries getPrismaWithAuth first.
  // Force it to fail so the helper falls through to getPrismaForSlugWithAuth
  // for URL-slug validation — matches the pre-G behaviour these tests expect.
  mockGetPrismaWithAuth.mockResolvedValue({ error: "Forbidden", status: 403 });
  mockGetPrismaForFarm.mockResolvedValue(mockPrisma);

  mockGameWaterPointFindMany.mockResolvedValue([]);
  mockGameInfrastructureFindMany.mockResolvedValue([]);
  mockRainfallFindMany.mockResolvedValue([]);
  mockTaskFindMany.mockResolvedValue([]);
  mockCampFindMany.mockResolvedValue([]);
}

// ── /api/[farmSlug]/map/water-points ────────────────────────────────────
describe("GET /api/[farmSlug]/map/water-points", () => {
  beforeEach(() => {
    resetAll();
    sessionForFarms(["trio-b-boerdery"]);
    dbResolvesFor("trio-b-boerdery");
  });

  it("returns a GeoJSON FeatureCollection", async () => {
    mockGameWaterPointFindMany.mockResolvedValue([
      {
        id: "wp1",
        name: "North Dam",
        type: "dam",
        status: "operational",
        gpsLat: -25.5,
        gpsLon: 28.1,
      },
    ]);
    const { GET } = await import(
      "@/app/api/[farmSlug]/map/water-points/route"
    );
    const res = await GET(new NextRequest("http://localhost/x"), {
      params: params(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(1);
    expect(body.features[0].geometry).toEqual({
      type: "Point",
      coordinates: [28.1, -25.5],
    });
    expect(body.features[0].properties).toMatchObject({
      id: "wp1",
      name: "North Dam",
      waterPointType: "dam",
      condition: "operational",
    });
  });

  it("skips rows with null gpsLat/gpsLon", async () => {
    mockGameWaterPointFindMany.mockResolvedValue([
      { id: "a", name: "x", type: "dam", status: "ok", gpsLat: null, gpsLon: 28 },
      { id: "b", name: "y", type: "dam", status: "ok", gpsLat: -25, gpsLon: null },
      { id: "c", name: "z", type: "dam", status: "ok", gpsLat: -25, gpsLon: 28 },
    ]);
    const { GET } = await import(
      "@/app/api/[farmSlug]/map/water-points/route"
    );
    const res = await GET(new NextRequest("http://localhost/x"), {
      params: params(),
    });
    const body = await res.json();
    expect(body.features).toHaveLength(1);
    expect(body.features[0].properties.id).toBe("c");
  });

  it("rejects no-session with AUTH_REQUIRED 401", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { GET } = await import(
      "@/app/api/[farmSlug]/map/water-points/route"
    );
    const res = await GET(new NextRequest("http://localhost/x"), {
      params: params(),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("AUTH_REQUIRED");
  });

  it("rejects cross-tenant with AUTH_REQUIRED 401 (adapter collapses both branches)", async () => {
    sessionForFarms(["other-farm"]);
    dbForbids();
    const { GET } = await import(
      "@/app/api/[farmSlug]/map/water-points/route"
    );
    const res = await GET(new NextRequest("http://localhost/x"), {
      params: params("trio-b-boerdery"),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("AUTH_REQUIRED");
  });
});

// ── /api/[farmSlug]/map/infrastructure ──────────────────────────────────
describe("GET /api/[farmSlug]/map/infrastructure", () => {
  beforeEach(() => {
    resetAll();
    sessionForFarms(["trio-b-boerdery"]);
    dbResolvesFor("trio-b-boerdery");
  });

  it("returns a GeoJSON FeatureCollection for Point rows", async () => {
    mockGameInfrastructureFindMany.mockResolvedValue([
      {
        id: "i1",
        name: "East Boma",
        type: "boma",
        condition: "good",
        gpsLat: -25.5,
        gpsLon: 28.1,
        lengthKm: null,
        capacityAnimals: 40,
      },
    ]);
    const { GET } = await import(
      "@/app/api/[farmSlug]/map/infrastructure/route"
    );
    const res = await GET(new NextRequest("http://localhost/x"), {
      params: params(),
    });
    const body = await res.json();
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(1);
    expect(body.features[0].properties).toMatchObject({
      id: "i1",
      infrastructureType: "boma",
      condition: "good",
    });
  });

  it("cross-tenant rejection — AUTH_REQUIRED 401 (adapter collapses both branches)", async () => {
    dbForbids();
    const { GET } = await import(
      "@/app/api/[farmSlug]/map/infrastructure/route"
    );
    const res = await GET(new NextRequest("http://localhost/x"), {
      params: params("trio-b-boerdery"),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("AUTH_REQUIRED");
  });
});

// ── /api/[farmSlug]/map/rainfall-gauges ─────────────────────────────────
describe("GET /api/[farmSlug]/map/rainfall-gauges", () => {
  beforeEach(() => {
    resetAll();
    sessionForFarms(["trio-b-boerdery"]);
    dbResolvesFor("trio-b-boerdery");
  });

  it("groups records by (lat,lng) and sums mm24h + mm7d", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    mockRainfallFindMany.mockResolvedValue([
      { date: today, rainfallMm: 5, stationName: "A", campId: "C1", lat: -25.5, lng: 28.1 },
      { date: yesterday, rainfallMm: 3, stationName: "A", campId: "C1", lat: -25.5, lng: 28.1 },
      { date: threeDaysAgo, rainfallMm: 2, stationName: "A", campId: "C1", lat: -25.5, lng: 28.1 },
      // A second gauge a few km east.
      { date: today, rainfallMm: 1, stationName: "B", campId: "C2", lat: -25.5, lng: 28.2 },
      // Row with null lat — must be skipped.
      { date: today, rainfallMm: 99, stationName: "X", campId: null, lat: null, lng: 28.3 },
    ]);

    const { GET } = await import(
      "@/app/api/[farmSlug]/map/rainfall-gauges/route"
    );
    const res = await GET(new NextRequest("http://localhost/x"), {
      params: params(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(2);

    const gaugeA = body.features.find(
      (f: { properties: { stationName: string } }) =>
        f.properties.stationName === "A",
    );
    expect(gaugeA.properties.mm7d).toBe(10);
    // 24h is just today's row.
    expect(gaugeA.properties.mm24h).toBe(5);
  });

  it("cross-tenant rejection — AUTH_REQUIRED 401 (adapter collapses both branches)", async () => {
    dbForbids();
    const { GET } = await import(
      "@/app/api/[farmSlug]/map/rainfall-gauges/route"
    );
    const res = await GET(new NextRequest("http://localhost/x"), {
      params: params("trio-b-boerdery"),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("AUTH_REQUIRED");
  });
});

// ── /api/[farmSlug]/map/task-pins ───────────────────────────────────────
describe("GET /api/[farmSlug]/map/task-pins", () => {
  beforeEach(() => {
    resetAll();
    sessionForFarms(["trio-b-boerdery"]);
    dbResolvesFor("trio-b-boerdery");
  });

  it("prefers task lat/lng over camp centroid", async () => {
    mockTaskFindMany.mockResolvedValue([
      {
        id: "t1",
        title: "Move cattle",
        taskType: "camp_move",
        status: "pending",
        priority: "normal",
        dueDate: "2026-04-20",
        animalId: null,
        campId: "C1",
        lat: -25.0,
        lng: 28.0,
      },
    ]);
    mockCampFindMany.mockResolvedValue([
      {
        campId: "C1",
        geojson: JSON.stringify({
          type: "Polygon",
          coordinates: [
            [
              [29, -26],
              [30, -26],
              [30, -25],
              [29, -25],
              [29, -26],
            ],
          ],
        }),
      },
    ]);
    const { GET } = await import("@/app/api/[farmSlug]/map/task-pins/route");
    const res = await GET(new NextRequest("http://localhost/x?status=open"), {
      params: params(),
    });
    const body = await res.json();
    expect(body.features).toHaveLength(1);
    expect(body.features[0].geometry.coordinates).toEqual([28.0, -25.0]);
  });

  it("falls back to camp centroid when task lat/lng null", async () => {
    mockTaskFindMany.mockResolvedValue([
      {
        id: "t1",
        title: "Inspect",
        taskType: "camp_inspection",
        status: "pending",
        priority: "normal",
        dueDate: "2026-04-20",
        animalId: null,
        campId: "C1",
        lat: null,
        lng: null,
      },
    ]);
    mockCampFindMany.mockResolvedValue([
      {
        campId: "C1",
        geojson: JSON.stringify({
          type: "Polygon",
          coordinates: [
            [
              [29, -26],
              [31, -26],
              [31, -24],
              [29, -24],
              [29, -26],
            ],
          ],
        }),
      },
    ]);
    const { GET } = await import("@/app/api/[farmSlug]/map/task-pins/route");
    const res = await GET(new NextRequest("http://localhost/x?status=open"), {
      params: params(),
    });
    const body = await res.json();
    expect(body.features).toHaveLength(1);
    // Centroid of that rectangle is (30, -25). Ring closes at the first point,
    // so the duplicate vertex skews it slightly — accept any reasonable pick
    // that's close to the rectangle's centre.
    const [lng, lat] = body.features[0].geometry.coordinates;
    expect(lng).toBeGreaterThan(29);
    expect(lng).toBeLessThan(31);
    expect(lat).toBeGreaterThan(-26);
    expect(lat).toBeLessThan(-24);
  });

  it("skips tasks with no resolvable coordinate", async () => {
    mockTaskFindMany.mockResolvedValue([
      {
        id: "t1",
        title: "Stray",
        taskType: "generic",
        status: "pending",
        priority: "normal",
        dueDate: "2026-04-20",
        animalId: null,
        campId: null,
        lat: null,
        lng: null,
      },
    ]);
    mockCampFindMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/[farmSlug]/map/task-pins/route");
    const res = await GET(new NextRequest("http://localhost/x?status=open"), {
      params: params(),
    });
    const body = await res.json();
    expect(body.features).toHaveLength(0);
  });

  it("rejects invalid status filter with INVALID_STATUS_FILTER", async () => {
    const { GET } = await import("@/app/api/[farmSlug]/map/task-pins/route");
    const res = await GET(
      new NextRequest("http://localhost/x?status=bogus"),
      { params: params() },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_STATUS_FILTER");
  });

  it("cross-tenant rejection — AUTH_REQUIRED 401 (adapter collapses both branches)", async () => {
    dbForbids();
    const { GET } = await import("@/app/api/[farmSlug]/map/task-pins/route");
    const res = await GET(new NextRequest("http://localhost/x"), {
      params: params("trio-b-boerdery"),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("AUTH_REQUIRED");
  });
});

// ── /api/map/gis/afis ───────────────────────────────────────────────────
describe("GET /api/map/gis/afis", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns stale envelope when bbox missing", async () => {
    const { GET } = await import("@/app/api/map/gis/afis/route");
    const res = await GET(new NextRequest("http://localhost/api/map/gis/afis"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._stale).toBe(true);
    expect(body._error).toBe("MISSING_BBOX");
    expect(body.features).toEqual([]);
  });

  it("returns INVALID_BBOX for malformed bbox", async () => {
    const { GET } = await import("@/app/api/map/gis/afis/route");
    const res = await GET(
      new NextRequest("http://localhost/api/map/gis/afis?bbox=notanumber"),
    );
    const body = await res.json();
    expect(body._stale).toBe(true);
    expect(body._error).toBe("INVALID_BBOX");
  });

  it("returns UPSTREAM_ERROR on upstream failure, HTTP 200", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("network down"),
    );
    const { GET } = await import("@/app/api/map/gis/afis/route");
    const res = await GET(
      new NextRequest("http://localhost/api/map/gis/afis?bbox=25,-35,35,-20"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._stale).toBe(true);
    expect(body._error).toBe("UPSTREAM_ERROR");
    expect(body.features).toEqual([]);
  });

  it("forwards upstream FeatureCollection when successful", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [28, -25] },
              properties: { fire: true },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { GET } = await import("@/app/api/map/gis/afis/route");
    const res = await GET(
      new NextRequest("http://localhost/api/map/gis/afis?bbox=25,-35,35,-20"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(1);
  });
});

// ── /api/map/gis/saws-fdi ───────────────────────────────────────────────
describe("GET /api/map/gis/saws-fdi", () => {
  it("returns the fallback reading with UPSTREAM_NOT_WIRED", async () => {
    const { GET } = await import("@/app/api/map/gis/saws-fdi/route");
    const res = await GET(
      new NextRequest("http://localhost/api/map/gis/saws-fdi?province=GP"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.province).toBe("GP");
    expect(body.band).toBe("Moderate");
    expect(body._stale).toBe(true);
    expect(body._error).toBe("UPSTREAM_NOT_WIRED");
  });

  it("returns INVALID_PROVINCE for an unknown province", async () => {
    const { GET } = await import("@/app/api/map/gis/saws-fdi/route");
    const res = await GET(
      new NextRequest("http://localhost/api/map/gis/saws-fdi?province=ZZ"),
    );
    const body = await res.json();
    expect(body._stale).toBe(true);
    expect(body._error).toBe("INVALID_PROVINCE");
  });

  it("returns MISSING_PROVINCE when param absent", async () => {
    const { GET } = await import("@/app/api/map/gis/saws-fdi/route");
    const res = await GET(
      new NextRequest("http://localhost/api/map/gis/saws-fdi"),
    );
    const body = await res.json();
    expect(body._stale).toBe(true);
    expect(body._error).toBe("MISSING_PROVINCE");
  });
});

// ── /api/map/gis/eskom-se-push/allowances ───────────────────────────────
describe("GET /api/map/gis/eskom-se-push/allowances", () => {
  const prevToken = process.env.ESKOMSEPUSH_TOKEN;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevToken === undefined) delete process.env.ESKOMSEPUSH_TOKEN;
    else process.env.ESKOMSEPUSH_TOKEN = prevToken;
  });

  it("returns NO_TOKEN stale envelope when token missing (no 500)", async () => {
    delete process.env.ESKOMSEPUSH_TOKEN;
    const { GET } = await import(
      "@/app/api/map/gis/eskom-se-push/allowances/route"
    );
    const res = await GET(new NextRequest("http://localhost/x"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._stale).toBe(true);
    expect(body._error).toBe("NO_TOKEN");
  });

  it("forwards upstream JSON when token set and fetch succeeds", async () => {
    process.env.ESKOMSEPUSH_TOKEN = "fake-token";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ allowance: { count: 23, limit: 50 } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { GET } = await import(
      "@/app/api/map/gis/eskom-se-push/allowances/route"
    );
    const res = await GET(new NextRequest("http://localhost/x"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowance.count).toBe(23);
  });

  it("returns UPSTREAM_ERROR on upstream failure", async () => {
    process.env.ESKOMSEPUSH_TOKEN = "fake-token";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("bad", { status: 503 }),
    );
    const { GET } = await import(
      "@/app/api/map/gis/eskom-se-push/allowances/route"
    );
    const res = await GET(new NextRequest("http://localhost/x"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._stale).toBe(true);
    expect(body._error).toBe("UPSTREAM_ERROR");
  });
});

// ── /api/map/gis/eskom-se-push/status/[areaId] ──────────────────────────
describe("GET /api/map/gis/eskom-se-push/status/[areaId]", () => {
  const prevToken = process.env.ESKOMSEPUSH_TOKEN;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevToken === undefined) delete process.env.ESKOMSEPUSH_TOKEN;
    else process.env.ESKOMSEPUSH_TOKEN = prevToken;
  });

  it("NO_TOKEN when token missing", async () => {
    delete process.env.ESKOMSEPUSH_TOKEN;
    const { GET } = await import(
      "@/app/api/map/gis/eskom-se-push/status/[areaId]/route"
    );
    const res = await GET(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ areaId: "eskde-10-witbankmp" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._stale).toBe(true);
    expect(body._error).toBe("NO_TOKEN");
  });

  it("INVALID_AREA_ID for bad area id", async () => {
    process.env.ESKOMSEPUSH_TOKEN = "fake-token";
    const { GET } = await import(
      "@/app/api/map/gis/eskom-se-push/status/[areaId]/route"
    );
    const res = await GET(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ areaId: "x$$$" }),
    });
    const body = await res.json();
    expect(body._stale).toBe(true);
    expect(body._error).toBe("INVALID_AREA_ID");
  });

  it("forwards upstream when token + area ok", async () => {
    process.env.ESKOMSEPUSH_TOKEN = "fake-token";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ events: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { GET } = await import(
      "@/app/api/map/gis/eskom-se-push/status/[areaId]/route"
    );
    const res = await GET(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ areaId: "eskde-10-witbankmp" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual([]);
  });
});

// ── /api/map/gis/fmd-zones ──────────────────────────────────────────────
describe("GET /api/map/gis/fmd-zones", () => {
  it("returns the committed static GeoJSON FeatureCollection", async () => {
    const { GET } = await import("@/app/api/map/gis/fmd-zones/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("FeatureCollection");
    expect(Array.isArray(body.features)).toBe(true);
    // Wave 2C ships at least one placeholder zone.
    expect(body.features.length).toBeGreaterThanOrEqual(1);
  });
});
