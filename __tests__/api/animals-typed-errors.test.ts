/**
 * __tests__/api/animals-typed-errors.test.ts
 *
 * Hotfix P0.1 — production triage 2026-05-03
 *
 * Production triage 2026-05-03 found `GET /api/animals` returns 500 with an
 * EMPTY BODY on both `acme-cattle` and `delta-livestock`. Cascades into
 * 11 broken admin pages + zero-animals on every per-camp logger page.
 *
 * Empty body on 500 violates `silent-failure-pattern.md`: every Prisma /
 * libSQL failure mode looks identical to the operator and the client. The
 * handler must:
 *   1. Catch every non-auth failure that crosses the response boundary.
 *   2. Emit a typed JSON body `{ error: "DB_QUERY_FAILED", message: "..." }`.
 *   3. Log the underlying error so Vercel + Sentry capture it server-side.
 *
 * These tests pin both contracts: happy-path 200 with body, and DB-failure
 * 500 with a typed body (NEVER an empty body).
 *
 * See:
 *   - memory/production-triage-2026-05-03.md (P0.1)
 *   - memory/silent-failure-pattern.md
 *   - memory/feedback-vercel-cached-prisma-client.md (one of the failure
 *     modes the typed body unmasks)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: {
      id: "user-1",
      email: "user-1@example.com",
      role: "admin",
      farms: [{ slug: "delta-livestock", role: "admin" }],
    },
  }),
}));

const mockFindMany = vi.fn();
const mockPrisma = {
  animal: { findMany: mockFindMany },
};

vi.mock("@/lib/farm-prisma", () => ({
  getPrismaWithAuth: vi.fn().mockResolvedValue({
    prisma: mockPrisma,
    slug: "delta-livestock",
    role: "admin",
  }),
  // getFarmContext fast-path falls back to legacy when no signed headers,
  // so we don't need to mock getPrismaForFarm for these tests.
  getPrismaForFarm: vi.fn().mockResolvedValue(null),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

describe("GET /api/animals — happy path returns JSON array (production sanity)", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it("?limit=1000 returns 200 + paginated body when prisma resolves successfully", async () => {
    const fixture = Array.from({ length: 5 }, (_, i) => ({
      animalId: `T-${String(i + 1).padStart(3, "0")}`,
      name: null,
      sex: "Female",
      dateOfBirth: null,
      breed: "Brangus",
      category: "Cow",
      currentCamp: "Speenkamp",
      status: "Active",
      motherId: null,
      fatherId: null,
      species: "cattle",
      dateAdded: "2026-01-01",
    }));
    mockFindMany.mockResolvedValueOnce(fixture);

    const { GET } = await import("@/app/api/animals/route");
    const req = new NextRequest("http://localhost/api/animals?limit=1000");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(5);
    expect(body.items[0]).toMatchObject({ animalId: "T-001", species: "cattle" });
  });

  it("unpaginated request returns 200 + bare array (legacy contract)", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    const { GET } = await import("@/app/api/animals/route");
    const req = new NextRequest("http://localhost/api/animals");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe("GET /api/animals — typed-error contract on DB failure", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it("returns 500 with typed JSON body (NEVER empty) when prisma.findMany throws on the unpaginated path", async () => {
    mockFindMany.mockRejectedValueOnce(
      new Error("libsql_error: no such column: 'speciesData'"),
    );

    const { GET } = await import("@/app/api/animals/route");
    const req = new NextRequest("http://localhost/api/animals");
    const res = await GET(req);

    expect(res.status).toBe(500);
    // Body MUST be valid JSON, not empty. The whole point of this hotfix is
    // that empty 500 bodies cascade into "Something went wrong" everywhere.
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
    const body = JSON.parse(text);
    expect(body).toMatchObject({ error: "DB_QUERY_FAILED" });
    expect(typeof body.message).toBe("string");
    // Underlying Prisma message should be propagated for triage. Operators
    // need a clue without having to dig into Vercel logs every time.
    expect(body.message).toMatch(/no such column|speciesData|libsql/i);
  });

  it("returns 500 with typed JSON body when prisma.findMany throws on the paginated path", async () => {
    mockFindMany.mockRejectedValueOnce(new Error("Connection refused"));

    const { GET } = await import("@/app/api/animals/route");
    const req = new NextRequest("http://localhost/api/animals?limit=500");
    const res = await GET(req);

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
    const body = JSON.parse(text);
    expect(body).toMatchObject({ error: "DB_QUERY_FAILED" });
    expect(typeof body.message).toBe("string");
  });

  it("does not change the auth contract — still returns 401 on no session", async () => {
    // This is a regression-lock — the typed-error wrapper must not swallow
    // the auth check from getFarmContext.
    const { getServerSession } = await import("next-auth");
    vi.mocked(getServerSession).mockResolvedValueOnce(null);

    const { GET } = await import("@/app/api/animals/route");
    const req = new NextRequest("http://localhost/api/animals");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });
});
