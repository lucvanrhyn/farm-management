/**
 * Issue #485 — unified pagination-limit contract across list endpoints.
 *
 * The same bad `?limit` historically produced THREE different answers:
 *   - /api/animals      → `{ error: "Invalid limit" }` 400 (free-text literal)
 *   - /api/observations → SILENTLY clamped to the default 50 (no rejection)
 *   - /api/tasks        → `{ error: "INVALID_LIMIT" }` 400 (typed, the good one)
 *
 * This suite locks all three onto the tasks contract: a non-finite / ≤0
 * `?limit` returns the SAME typed `{ error: "INVALID_LIMIT" }` 400, a valid
 * value clamps to the route's own MAX_LIMIT, and an omitted `?limit` uses
 * that route's fallback (NOT an error). The shared validator lives at
 * `lib/domain/shared/limit.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Prisma mock — findMany for all three resources ──────────────────────────
const mockAnimalFindMany = vi.fn().mockResolvedValue([]);
const mockObservationFindMany = vi.fn().mockResolvedValue([]);
const mockTaskFindMany = vi.fn().mockResolvedValue([]);
const mockPrisma = {
  animal: { findMany: mockAnimalFindMany },
  observation: { findMany: mockObservationFindMany },
  task: { findMany: mockTaskFindMany },
  taskOccurrence: { findMany: vi.fn().mockResolvedValue([]) },
};

// ── Auth: Issue #495 — every list route here is cookie-scoped and resolves
//    auth through the proxy-signed `getFarmContext` (admin so each authorises).
//    The legacy `getServerSession` + `getPrismaWithAuth` Referer fallback is
//    gone, so we mock the chokepoint directly. ────────────────────────────────
vi.mock("@/lib/server/farm-context", () => ({
  getFarmContext: vi.fn().mockResolvedValue({
    session: {
      user: {
        id: "user-1",
        email: "user-1@example.com",
        role: "admin",
        farms: [{ slug: "test-farm-slug", role: "admin" }],
      },
    },
    prisma: mockPrisma,
    slug: "test-farm-slug",
    role: "admin",
  }),
}));

vi.mock("@/lib/farm-prisma", () => ({
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const EMPTY_CTX = { params: Promise.resolve({}) };
function req(url: string): NextRequest {
  return new NextRequest(url);
}

// Each route's findMany mock + its declared per-route MAX_LIMIT + the
// `take` math (animals/tasks fetch limit+1; observations fetches `take=limit`).
const ROUTES = [
  {
    name: "/api/animals",
    path: "@/app/api/animals/route",
    findMany: mockAnimalFindMany,
    base: "http://localhost/api/animals",
    maxLimit: 2000,
    takeForMax: 2001, // limit + 1
  },
  {
    name: "/api/observations",
    path: "@/app/api/observations/route",
    findMany: mockObservationFindMany,
    base: "http://localhost/api/observations",
    maxLimit: 200,
    takeForMax: 200, // take = clamped limit
  },
  {
    name: "/api/tasks",
    path: "@/app/api/tasks/route",
    findMany: mockTaskFindMany,
    base: "http://localhost/api/tasks",
    maxLimit: 500,
    takeForMax: 501, // limit + 1
  },
] as const;

describe("unified ?limit validation contract", () => {
  beforeEach(() => {
    mockAnimalFindMany.mockReset().mockResolvedValue([]);
    mockObservationFindMany.mockReset().mockResolvedValue([]);
    mockTaskFindMany.mockReset().mockResolvedValue([]);
  });

  describe.each(ROUTES)("$name", (route) => {
    it.each(["-5", "abc", "0"])(
      "rejects ?limit=%s with a typed 400 { error: 'INVALID_LIMIT' }",
      async (bad) => {
        const { GET } = await import(route.path);
        const res = await GET(req(`${route.base}?limit=${bad}`), EMPTY_CTX);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBe("INVALID_LIMIT");
        // The query must never reach the database on a bad limit.
        expect(route.findMany).not.toHaveBeenCalled();
      },
    );

    it(`clamps a too-large ?limit to MAX_LIMIT (${route.maxLimit})`, async () => {
      const { GET } = await import(route.path);
      const res = await GET(req(`${route.base}?limit=99999`), EMPTY_CTX);

      expect(res.status).toBe(200);
      expect(route.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: route.takeForMax }),
      );
    });
  });

  // Omitted ?limit uses each route's fallback (NOT an error). Animals and
  // tasks fall back to their unbounded array shape (no pagination) when no
  // limit/cursor is present; observations always paginates with its default
  // take=50. All must respond 200.
  it("omitted ?limit is not an error on /api/animals (200, unbounded array)", async () => {
    const { GET } = await import("@/app/api/animals/route");
    const res = await GET(req("http://localhost/api/animals"), EMPTY_CTX);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  it("omitted ?limit is not an error on /api/tasks (200, unbounded array)", async () => {
    const { GET } = await import("@/app/api/tasks/route");
    const res = await GET(req("http://localhost/api/tasks"), EMPTY_CTX);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  it("omitted ?limit uses the default take=50 on /api/observations (200)", async () => {
    const { GET } = await import("@/app/api/observations/route");
    const res = await GET(req("http://localhost/api/observations"), EMPTY_CTX);
    expect(res.status).toBe(200);
    expect(mockObservationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });
});
