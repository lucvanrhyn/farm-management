/**
 * @vitest-environment node
 *
 * Issue #486 (Epic B4) — every hand-rolled `getServerSession` /
 * `getFarmContext` route must emit the CANONICAL ADR-0001 401 envelope
 * `{ error: "AUTH_REQUIRED", message: "Unauthorized" }` — collapsing the
 * 5+ pre-existing ad-hoc shapes (`{error:"Unauthorized"}`,
 * `{error:"Unauthorized",code:"MISSING_ADMIN_SESSION"}`,
 * `{code:"EINSTEIN_UNAUTHENTICATED"}`, raw-JSON-string, ...).
 *
 * This pins the wire-shape per migrated route so the divergence cannot
 * silently re-appear. 401-vs-403 semantics are unchanged: these tests only
 * drive the unauthenticated branch (auth resolver → null / session → null).
 *
 * The route adapters (`tenantRead`, `adminWrite`, ...) already emit this
 * exact envelope via `routeError("AUTH_REQUIRED", "Unauthorized", 401)`;
 * see `__tests__/api/animals.test.ts` for the adapter-routed equivalent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Auth resolvers — every migrated route resolves the unauth branch
//    through one of these three. Default them all to the unauthenticated
//    outcome; individual tests re-assert as needed. ───────────────────────
const getFarmContextMock = vi.fn();
vi.mock("@/lib/server/farm-context", () => ({
  getFarmContext: (...args: unknown[]) => getFarmContextMock(...args),
}));

const getFarmContextForSlugMock = vi.fn();
vi.mock("@/lib/server/farm-context-slug", () => ({
  getFarmContextForSlug: (...args: unknown[]) => getFarmContextForSlugMock(...args),
}));

const getServerSessionMock = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSessionMock(...args),
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: () => ({ id: "credentials" }),
}));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));

// einstein/ask + admin/evict-farm-client transitively import `@/lib/farm-prisma`,
// which eagerly loads `@prisma/client`. Stub it so the route module evaluates
// without a generated client present in the test sandbox.
vi.mock("@/lib/farm-prisma", () => ({
  getPrismaForSlugWithAuth: vi.fn(),
  getPrismaForFarm: vi.fn(),
  getPrismaWithAuth: vi.fn(),
  evictFarmClient: vi.fn(),
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

// einstein/ask pulls these at module-eval; keep them inert.
vi.mock("@/lib/meta-db", () => ({
  getFarmCreds: vi.fn(),
  getFarmSubscription: vi.fn(),
  isPlatformAdmin: vi.fn(),
  updateConsultingLeadStatus: vi.fn(),
  VALID_LEAD_STATUSES: ["new", "scoped", "won", "lost"],
}));

beforeEach(() => {
  getFarmContextMock.mockReset().mockResolvedValue(null);
  getFarmContextForSlugMock.mockReset().mockResolvedValue(null);
  getServerSessionMock.mockReset().mockResolvedValue(null);
});

const CANONICAL_401 = { error: "AUTH_REQUIRED", message: "Unauthorized" };

async function expectCanonical401(res: Response) {
  expect(res.status).toBe(401);
  const body = (await res.json()) as { error?: string; message?: string };
  expect(body).toEqual(CANONICAL_401);
}

function req(url: string, init?: RequestInit) {
  return new NextRequest(url, init as never);
}

describe("issue #486 — canonical AUTH_REQUIRED 401 envelope per migrated route", () => {
  it("GET /api/farm", async () => {
    const { GET } = await import("@/app/api/farm/route");
    await expectCanonical401(await GET());
  });

  it("GET /api/farm/settings", async () => {
    const { GET } = await import("@/app/api/farm/settings/route");
    await expectCanonical401(await GET(req("http://localhost/api/farm/settings?farmSlug=delta")));
  });

  it("PATCH /api/farm/settings", async () => {
    const { PATCH } = await import("@/app/api/farm/settings/route");
    await expectCanonical401(await PATCH(req("http://localhost/api/farm/settings?farmSlug=delta")));
  });

  it("GET /api/farm/species-settings", async () => {
    const { GET } = await import("@/app/api/farm/species-settings/route");
    await expectCanonical401(
      await GET(req("http://localhost/api/farm/species-settings?farmSlug=delta")),
    );
  });

  it("PATCH /api/farm/species-settings", async () => {
    const { PATCH } = await import("@/app/api/farm/species-settings/route");
    await expectCanonical401(
      await PATCH(req("http://localhost/api/farm/species-settings?farmSlug=delta")),
    );
  });

  it("GET /api/transaction-categories", async () => {
    const { GET } = await import("@/app/api/transaction-categories/route");
    await expectCanonical401(await GET(req("http://localhost/api/transaction-categories")));
  });

  it("POST /api/transaction-categories", async () => {
    const { POST } = await import("@/app/api/transaction-categories/route");
    await expectCanonical401(
      await POST(req("http://localhost/api/transaction-categories", { method: "POST" })),
    );
  });

  it("DELETE /api/transaction-categories/[id]", async () => {
    const { DELETE } = await import("@/app/api/transaction-categories/[id]/route");
    await expectCanonical401(
      await DELETE(req("http://localhost/api/transaction-categories/x", { method: "DELETE" }), {
        params: Promise.resolve({ id: "x" }),
      }),
    );
  });

  it("GET /api/onboarding/template", async () => {
    const { GET } = await import("@/app/api/onboarding/template/route");
    await expectCanonical401(await GET(req("http://localhost/api/onboarding/template")));
  });

  it("POST /api/onboarding/map-columns", async () => {
    const { POST } = await import("@/app/api/onboarding/map-columns/route");
    await expectCanonical401(
      await POST(req("http://localhost/api/onboarding/map-columns", { method: "POST" })),
    );
  });

  it("POST /api/onboarding/commit-import", async () => {
    const { POST } = await import("@/app/api/onboarding/commit-import/route");
    await expectCanonical401(
      await POST(req("http://localhost/api/onboarding/commit-import", { method: "POST" })),
    );
  });

  it("GET /api/subscription/status", async () => {
    const { GET } = await import("@/app/api/subscription/status/route");
    await expectCanonical401(
      await GET(req("http://localhost/api/subscription/status?farm=delta")),
    );
  });

  it("POST /api/push/subscribe (authenticated session, missing email)", async () => {
    // push/subscribe is already on `tenantWrite`; the route-level 401 fires
    // when the session has NO email even though ctx resolved. Drive that
    // branch by returning a ctx whose session has no email.
    getFarmContextMock.mockResolvedValue({
      prisma: {},
      slug: "delta",
      role: "ADMIN",
      session: { user: { id: "u1" } },
    });
    const { POST } = await import("@/app/api/push/subscribe/route");
    await expectCanonical401(
      await POST(
        req("http://localhost/api/push/subscribe", {
          method: "POST",
          body: JSON.stringify({ endpoint: "e", keys: { p256dh: "p", auth: "a" } }),
          headers: { "Content-Type": "application/json" },
        }),
        { params: Promise.resolve({}) },
      ),
    );
  });

  it("DELETE /api/admin/reset", async () => {
    const { DELETE } = await import("@/app/api/admin/reset/route");
    await expectCanonical401(
      await DELETE(req("http://localhost/api/admin/reset", { method: "DELETE" })),
    );
  });

  it("POST /api/admin/evict-farm-client", async () => {
    const { POST } = await import("@/app/api/admin/evict-farm-client/route");
    await expectCanonical401(
      await POST(req("http://localhost/api/admin/evict-farm-client", { method: "POST" })),
    );
  });

  it("PATCH /api/admin/consulting/[id]", async () => {
    const { PATCH } = await import("@/app/api/admin/consulting/[id]/route");
    await expectCanonical401(
      await PATCH(req("http://localhost/api/admin/consulting/abc", { method: "PATCH" }), {
        params: Promise.resolve({ id: "abc" }),
      }),
    );
  });

  it("POST /api/einstein/ask", async () => {
    const { POST } = await import("@/app/api/einstein/ask/route");
    await expectCanonical401(
      await POST(
        req("http://localhost/api/einstein/ask", {
          method: "POST",
          body: JSON.stringify({ question: "q", farmSlug: "delta" }),
          headers: { "Content-Type": "application/json" },
        }),
        { params: Promise.resolve({}) },
      ),
    );
  });

  // Issue #493 (Epic B) — the feedback route's session-missing arm folds onto
  // the same canonical envelope as its `ask` sibling did in #486.
  it("POST /api/einstein/feedback", async () => {
    const { POST } = await import("@/app/api/einstein/feedback/route");
    await expectCanonical401(
      await POST(
        req("http://localhost/api/einstein/feedback", {
          method: "POST",
          body: JSON.stringify({
            queryLogId: "log-1",
            feedback: "up",
            farmSlug: "delta",
          }),
          headers: { "Content-Type": "application/json" },
        }),
        { params: Promise.resolve({}) },
      ),
    );
  });
});
