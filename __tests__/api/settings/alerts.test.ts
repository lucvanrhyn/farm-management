import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ────────────────────────────────────────────────────────────────
const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

// The next-auth provider chain pulls in credentials — skip it in tests.
vi.mock("next-auth/providers/credentials", () => ({
  default: () => ({ id: "credentials" }),
}));

// farm-prisma: return a mock whose role can be flipped per-test.
const mockAlertUpsert = vi.fn();
const mockAlertFindMany = vi.fn();
const mockFarmFindFirst = vi.fn();
const mockFarmUpsert = vi.fn();

const mockPrisma = {
  alertPreference: {
    upsert: mockAlertUpsert,
    findMany: mockAlertFindMany,
  },
  farmSettings: {
    findFirst: mockFarmFindFirst,
    upsert: mockFarmUpsert,
  },
} as const;

const mockGetPrismaForSlugWithAuth = vi.fn();
const mockGetPrismaWithAuth = vi.fn().mockResolvedValue({ error: "Forbidden", status: 403 });
const mockGetPrismaForFarm = vi.fn();
vi.mock("@/lib/farm-prisma", () => ({
  getPrismaForSlugWithAuth: (...args: unknown[]) => mockGetPrismaForSlugWithAuth(...args),
  // Phase G (P6.5): route funnels through getFarmContextForSlug which first
  // tries the cookie-scoped getFarmContext (getPrismaWithAuth). Tests don't
  // set signed headers so the fast path never fires; forcing the cookie
  // lookup to error keeps the helper on its slug-validated fallback.
  getPrismaWithAuth: (...args: unknown[]) => mockGetPrismaWithAuth(...args),
  getPrismaForFarm: (...args: unknown[]) => mockGetPrismaForFarm(...args),

  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

const mockVerifyFreshAdminRole = vi.fn();
vi.mock("@/lib/auth", () => ({
  verifyFreshAdminRole: (...args: unknown[]) => mockVerifyFreshAdminRole(...args),
}));

// Stub next/cache so revalidateTag calls don't blow up outside a Next.js runtime
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: vi.fn().mockImplementation((fn: (...args: unknown[]) => unknown) => fn),
}));

// ── Helpers ──────────────────────────────────────────────────────────────
function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/trio-b-boerdery/settings/alerts", {
    method: "PATCH",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = (): Promise<{ farmSlug: string }> =>
  Promise.resolve({ farmSlug: "trio-b-boerdery" });

function sessionOK(role: "ADMIN" | "LOGGER" = "LOGGER") {
  mockGetServerSession.mockResolvedValue({
    user: {
      id: "user-1",
      email: "u@test",
      farms: [{ slug: "trio-b-boerdery", role }],
    },
  });
  mockGetPrismaForSlugWithAuth.mockResolvedValue({
    prisma: mockPrisma,
    slug: "trio-b-boerdery",
    role,
  });
}

function resetAll() {
  mockGetServerSession.mockReset();
  mockGetPrismaForSlugWithAuth.mockReset();
  mockVerifyFreshAdminRole.mockReset();
  mockAlertUpsert.mockReset();
  mockAlertFindMany.mockReset();
  mockFarmFindFirst.mockReset();
  mockFarmUpsert.mockReset();
  mockAlertFindMany.mockResolvedValue([]);
  mockFarmFindFirst.mockResolvedValue({
    quietHoursStart: "20:00",
    quietHoursEnd: "06:00",
    timezone: "Africa/Johannesburg",
    speciesAlertThresholds: null,
  });
  mockAlertUpsert.mockResolvedValue({});
  mockFarmUpsert.mockResolvedValue({});
  mockVerifyFreshAdminRole.mockResolvedValue(true);
}

// ── Tests ────────────────────────────────────────────────────────────────
describe("PATCH /api/[farmSlug]/settings/alerts", () => {
  beforeEach(() => {
    resetAll();
  });

  it("returns 401 when there is no session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/[farmSlug]/settings/alerts/route");
    const res = await PATCH(req({ prefs: [] }), { params: params() });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("AUTH_REQUIRED");
  });

  it("returns 403 ADMIN_REQUIRED_FOR_FARM_SETTINGS when a non-admin writes quietHoursStart", async () => {
    sessionOK("LOGGER");
    const { PATCH } = await import("@/app/api/[farmSlug]/settings/alerts/route");
    const res = await PATCH(req({ quietHoursStart: "21:00" }), { params: params() });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("ADMIN_REQUIRED_FOR_FARM_SETTINGS");
    expect(mockFarmUpsert).not.toHaveBeenCalled();
  });

  it("allows a non-admin to write their own prefs (200, upsert called per row)", async () => {
    sessionOK("LOGGER");
    const { PATCH } = await import("@/app/api/[farmSlug]/settings/alerts/route");

    const body = {
      prefs: [
        {
          category: "reproduction",
          alertType: null,
          channel: "email",
          enabled: true,
          digestMode: "realtime",
          speciesOverride: null,
        },
        {
          category: "performance",
          alertType: "no_weigh_90d",
          channel: "bell",
          enabled: false,
          digestMode: "weekly",
          speciesOverride: "cattle",
        },
      ],
    };

    const res = await PATCH(req(body), { params: params() });
    expect(res.status).toBe(200);
    expect(mockAlertUpsert).toHaveBeenCalledTimes(2);
    // First call carries the reproduction row — assert payload shape.
    expect(mockAlertUpsert.mock.calls[0][0].create).toMatchObject({
      userId: "user-1",
      category: "reproduction",
      channel: "email",
      enabled: true,
      digestMode: "realtime",
    });
  });

  it("admin successfully writes farm-level quietHours + a pref row together", async () => {
    sessionOK("ADMIN");
    const { PATCH } = await import("@/app/api/[farmSlug]/settings/alerts/route");

    const body = {
      quietHoursStart: "21:30",
      quietHoursEnd: "05:00",
      timezone: "Africa/Johannesburg",
      prefs: [
        {
          category: "veld",
          alertType: null,
          channel: "push",
          enabled: true,
          digestMode: "realtime",
          speciesOverride: null,
        },
      ],
    };

    const res = await PATCH(req(body), { params: params() });
    expect(res.status).toBe(200);
    expect(mockVerifyFreshAdminRole).toHaveBeenCalledWith("user-1", "trio-b-boerdery");
    expect(mockFarmUpsert).toHaveBeenCalledTimes(1);
    expect(mockFarmUpsert.mock.calls[0][0].update).toMatchObject({
      quietHoursStart: "21:30",
      quietHoursEnd: "05:00",
      timezone: "Africa/Johannesburg",
    });
    expect(mockAlertUpsert).toHaveBeenCalledTimes(1);
  });

  it("rejects predator digestMode != realtime (safety floor)", async () => {
    sessionOK("LOGGER");
    const { PATCH } = await import("@/app/api/[farmSlug]/settings/alerts/route");
    const res = await PATCH(
      req({
        prefs: [
          {
            category: "predator",
            channel: "email",
            enabled: true,
            digestMode: "daily",
          },
        ],
      }),
      { params: params() },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_PREF_FIELD");
    expect(mockAlertUpsert).not.toHaveBeenCalled();
  });

  it("rejects malformed quietHoursStart with INVALID_QUIET_HOURS", async () => {
    sessionOK("ADMIN");
    const { PATCH } = await import("@/app/api/[farmSlug]/settings/alerts/route");
    const res = await PATCH(req({ quietHoursStart: "25:99" }), { params: params() });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_QUIET_HOURS");
  });

  it("rejects an unknown timezone with INVALID_TIMEZONE", async () => {
    sessionOK("ADMIN");
    const { PATCH } = await import("@/app/api/[farmSlug]/settings/alerts/route");
    const res = await PATCH(req({ timezone: "Mars/Olympus_Mons" }), { params: params() });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_TIMEZONE");
  });

  it("returns 400 INVALID_BODY on non-JSON body", async () => {
    sessionOK("LOGGER");
    const { PATCH } = await import("@/app/api/[farmSlug]/settings/alerts/route");
    const res = await PATCH(req("{not-json"), { params: params() });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_BODY");
  });
});

describe("GET /api/[farmSlug]/settings/alerts", () => {
  beforeEach(() => {
    resetAll();
  });

  it("returns the user's prefs and tenant farmSettings", async () => {
    sessionOK("ADMIN");
    mockAlertFindMany.mockResolvedValue([
      { id: "p1", userId: "user-1", category: "veld", channel: "bell", enabled: true },
    ]);
    mockFarmFindFirst.mockResolvedValue({
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
      timezone: "Africa/Johannesburg",
      speciesAlertThresholds: null,
    });

    const { GET } = await import("@/app/api/[farmSlug]/settings/alerts/route");
    const res = await GET(new NextRequest("http://localhost/x"), { params: params() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.prefs).toHaveLength(1);
    expect(body.farmSettings.quietHoursStart).toBe("22:00");
  });
});
