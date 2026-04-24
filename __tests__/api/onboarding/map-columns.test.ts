import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks — declared before route import
// ---------------------------------------------------------------------------

const getServerSessionMock = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSessionMock(...args),
}));

const campFindManyMock = vi.fn();
const getPrismaWithAuthMock = vi.fn();
vi.mock("@/lib/farm-prisma", () => ({
  getPrismaWithAuth: (...args: unknown[]) => getPrismaWithAuthMock(...args),
}));

const checkRateLimitMock = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}));

// Phase H.2: verifyFreshAdminRole hits the meta-db, which isn't available in
// unit tests. For handlers under test we trust the mocked ADMIN session.
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...actual, verifyFreshAdminRole: vi.fn().mockResolvedValue(true) };
});

const proposeColumnMappingMock = vi.fn();
vi.mock("@/lib/onboarding/adaptive-import", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/onboarding/adaptive-import")
  >("@/lib/onboarding/adaptive-import");
  return {
    ...actual,
    proposeColumnMapping: (...args: unknown[]) =>
      proposeColumnMappingMock(...args),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/onboarding/map-columns", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const validBody = {
  parsedColumns: ["Oormerk", "Geslag", "Kamp"],
  sampleRows: [{ Oormerk: "BB-C001", Geslag: "Vroulik", Kamp: "Bergkamp" }],
  fullRowCount: 103,
};

const happyProposal = {
  proposal: {
    mapping: [{ source: "Oormerk", target: "earTag", confidence: 0.98 }],
    unmapped: [],
    warnings: [],
    row_count: 103,
  },
  usage: {
    inputTokens: 800,
    outputTokens: 1500,
    cacheCreationTokens: 0,
    cacheReadTokens: 5000,
    costUsd: 0.0264,
    costZar: 0.49,
  },
  model: "gpt-4o-mini" as const,
  promptVersion: "1.0.0",
};

function primeHappyMocks() {
  getServerSessionMock.mockResolvedValue({
    user: { email: "luc@example.com", farms: [] },
  });
  campFindManyMock.mockResolvedValue([
    { campId: "bergkamp", campName: "Bergkamp", sizeHectares: 42.5 },
    { campId: "weiveld-1", campName: "Weiveld 1", sizeHectares: 18 },
  ]);
  getPrismaWithAuthMock.mockResolvedValue({
    prisma: { camp: { findMany: campFindManyMock } },
    slug: "basson-boerdery",
    role: "ADMIN",
  });
  checkRateLimitMock.mockReturnValue({ allowed: true, retryAfterMs: 0 });
  proposeColumnMappingMock.mockResolvedValue(happyProposal);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/onboarding/map-columns", () => {
  beforeEach(() => {
    getServerSessionMock.mockReset();
    getPrismaWithAuthMock.mockReset();
    campFindManyMock.mockReset();
    checkRateLimitMock.mockReset();
    proposeColumnMappingMock.mockReset();
  });

  it("returns 401 when there is no session", async () => {
    getServerSessionMock.mockResolvedValue(null);
    const { POST } = await import(
      "@/app/api/onboarding/map-columns/route"
    );
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(401);
  });

  it("returns 403 when the farm role is not ADMIN", async () => {
    primeHappyMocks();
    getPrismaWithAuthMock.mockResolvedValue({
      prisma: { camp: { findMany: campFindManyMock } },
      slug: "basson-boerdery",
      role: "VIEWER",
    });
    const { POST } = await import(
      "@/app/api/onboarding/map-columns/route"
    );
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(403);
    expect(proposeColumnMappingMock).not.toHaveBeenCalled();
  });

  it("returns 400 when getPrismaWithAuth returns an error", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { email: "luc@example.com", farms: [] },
    });
    getPrismaWithAuthMock.mockResolvedValue({
      error: "No active farm selected",
      status: 400,
    });
    const { POST } = await import(
      "@/app/api/onboarding/map-columns/route"
    );
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(400);
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    primeHappyMocks();
    checkRateLimitMock.mockReturnValue({
      allowed: false,
      retryAfterMs: 60_000,
    });
    const { POST } = await import(
      "@/app/api/onboarding/map-columns/route"
    );
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(429);
    expect(proposeColumnMappingMock).not.toHaveBeenCalled();
  });

  it("uses a per-farm rate limit key scoped to map-columns", async () => {
    primeHappyMocks();
    const { POST } = await import(
      "@/app/api/onboarding/map-columns/route"
    );
    await POST(makeReq(validBody));
    expect(checkRateLimitMock).toHaveBeenCalledTimes(1);
    const [key, max, windowMs] = checkRateLimitMock.mock.calls[0];
    expect(key).toBe("map-columns:basson-boerdery");
    expect(max).toBe(3);
    expect(windowMs).toBe(24 * 60 * 60 * 1000);
  });

  it("returns 400 when body is missing required fields", async () => {
    primeHappyMocks();
    const { POST } = await import(
      "@/app/api/onboarding/map-columns/route"
    );
    const res = await POST(makeReq({ parsedColumns: [] }));
    expect(res.status).toBe(400);
    expect(proposeColumnMappingMock).not.toHaveBeenCalled();
  });

  it("returns 400 when parsedColumns has more than 200 entries", async () => {
    primeHappyMocks();
    const { POST } = await import(
      "@/app/api/onboarding/map-columns/route"
    );
    const tooMany = Array.from({ length: 201 }, (_, i) => `col${i}`);
    const res = await POST(
      makeReq({ ...validBody, parsedColumns: tooMany })
    );
    expect(res.status).toBe(400);
    expect(proposeColumnMappingMock).not.toHaveBeenCalled();
  });

  it("returns 400 when a sampleRows value exceeds 512 chars", async () => {
    primeHappyMocks();
    const { POST } = await import(
      "@/app/api/onboarding/map-columns/route"
    );
    const res = await POST(
      makeReq({ ...validBody, sampleRows: [{ col: "x".repeat(513) }] })
    );
    expect(res.status).toBe(400);
    expect(proposeColumnMappingMock).not.toHaveBeenCalled();
  });

  it("returns 400 when fullRowCount is not an integer", async () => {
    primeHappyMocks();
    const { POST } = await import(
      "@/app/api/onboarding/map-columns/route"
    );
    const res = await POST(makeReq({ ...validBody, fullRowCount: 1.5 }));
    expect(res.status).toBe(400);
    expect(proposeColumnMappingMock).not.toHaveBeenCalled();
  });

  it("does not charge rate limit when body is malformed", async () => {
    primeHappyMocks();
    const { POST } = await import(
      "@/app/api/onboarding/map-columns/route"
    );
    const res = await POST(makeReq({ parsedColumns: [] }));
    expect(res.status).toBe(400);
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(proposeColumnMappingMock).not.toHaveBeenCalled();
  });

  it("returns 400 when body is not valid JSON", async () => {
    primeHappyMocks();
    const req = new NextRequest(
      "http://localhost/api/onboarding/map-columns",
      {
        method: "POST",
        body: "not-json",
        headers: { "Content-Type": "application/json" },
      }
    );
    const { POST } = await import(
      "@/app/api/onboarding/map-columns/route"
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("happy path: calls proposeColumnMapping with camps from DB and returns 200", async () => {
    primeHappyMocks();
    const { POST } = await import(
      "@/app/api/onboarding/map-columns/route"
    );
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.proposal.row_count).toBe(103);
    expect(json.model).toBe("gpt-4o-mini");
    expect(json.usage.costZar).toBeGreaterThan(0);

    expect(proposeColumnMappingMock).toHaveBeenCalledTimes(1);
    const call = proposeColumnMappingMock.mock.calls[0][0];
    expect(call.parsedColumns).toEqual(validBody.parsedColumns);
    expect(call.sampleRows).toEqual(validBody.sampleRows);
    expect(call.fullRowCount).toBe(103);
    expect(call.existingCamps).toEqual([
      { campId: "bergkamp", campName: "Bergkamp", sizeHectares: 42.5 },
      { campId: "weiveld-1", campName: "Weiveld 1", sizeHectares: 18 },
    ]);
  });

  it("selects only the camp fields the mapper needs", async () => {
    primeHappyMocks();
    const { POST } = await import(
      "@/app/api/onboarding/map-columns/route"
    );
    await POST(makeReq(validBody));
    expect(campFindManyMock).toHaveBeenCalledTimes(1);
    const selectArg = campFindManyMock.mock.calls[0][0]?.select;
    expect(selectArg).toEqual({
      campId: true,
      campName: true,
      sizeHectares: true,
    });
  });

  it("returns 500 and a generic message when the mapper throws unexpectedly", async () => {
    primeHappyMocks();
    proposeColumnMappingMock.mockRejectedValue(new Error("boom"));
    const { POST } = await import(
      "@/app/api/onboarding/map-columns/route"
    );
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(500);
    const json = await res.json();
    // never leak raw error messages to the client
    expect(JSON.stringify(json)).not.toContain("boom");
  });

  it("returns 502 when the mapper throws AdaptiveImportError (upstream failure)", async () => {
    primeHappyMocks();
    const { AdaptiveImportError } = await import(
      "@/lib/onboarding/adaptive-import"
    );
    proposeColumnMappingMock.mockRejectedValue(
      new AdaptiveImportError("Anthropic API call failed.", {
        cause: new Error("ECONNRESET"),
      })
    );
    const { POST } = await import(
      "@/app/api/onboarding/map-columns/route"
    );
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toMatch(/import/i);
  });
});
