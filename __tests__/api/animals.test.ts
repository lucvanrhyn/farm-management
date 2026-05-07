/**
 * __tests__/api/animals.test.ts
 *
 * Phase H — tenant-scope assertion for the animal-picker handler.
 *
 * The observation-create modal's debounced AnimalPicker calls
 * `GET /api/animals?search=<q>&species=<mode>`. The route resolves the
 * caller's farm slug from the HMAC-signed identity tuple set by `proxy.ts`
 * via `getFarmContext()`. There is intentionally NO `farmSlug` query
 * parameter — a cross-tenant query is impossible by construction:
 *
 *   1. If no signed header is present (anonymous fetch, expired session,
 *      bypassed proxy), `getFarmContext()` returns null → 401.
 *   2. If a signed header IS present, the route binds prisma to that slug
 *      via `getPrismaWithAuth(session)` (called inside getFarmContext for
 *      the legacy fallback path) or via `getPrismaForFarm(slug)` for the
 *      signed-tuple fast path. Either way, the prisma instance is bound to
 *      the signed slug — search results come from that tenant's DB only.
 *
 * This test pins the no-auth case (401) so a regression that drops the
 * auth check would fail loud.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// No session → ensures the unsigned/legacy code path returns null.
vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/farm-prisma", () => ({
  // Both helpers reject when called without a session — exercises the
  // "anonymous request" branch.
  getPrismaWithAuth: vi.fn().mockResolvedValue(null),
  getPrismaForFarm: vi.fn().mockResolvedValue(null),

  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

describe("GET /api/animals — tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the request has no signed identity tuple and no session", async () => {
    const { GET } = await import("@/app/api/animals/route");
    // Plain GET — no `x-session-*` headers, no next-auth cookie.
    const req = new NextRequest("http://localhost/api/animals?search=C001");
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
    // Wave A (#148): the typed-error envelope replaced the free-form
    // `{ error: "Unauthorized" }` with the SCREAMING_SNAKE code +
    // human-readable `message` per ADR-0001.
    const body = (await res.json()) as { error?: string; message?: string };
    expect(body.error).toBe("AUTH_REQUIRED");
    expect(body.message).toBe("Unauthorized");
  });

  it("returns 401 when the request tries to spoof a farmSlug query param without auth", async () => {
    const { GET } = await import("@/app/api/animals/route");
    // The route does NOT honour `?farmSlug=`; tenant binding comes from the
    // signed identity tuple. Even with the param, the unauthenticated path
    // must still 401.
    const req = new NextRequest(
      "http://localhost/api/animals?search=C001&farmSlug=other-tenant",
    );
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
  });
});
