/**
 * Integration test: the five instrumented API routes emit a valid
 * `Server-Timing` header. This is the cold-perf observability contract
 * — if this test passes in CI we know the header is visible to LHCI
 * and devtools on every instrumented route.
 *
 * Routes covered:
 *   - /api/farm
 *   - /api/camps
 *   - /api/camps/status
 *   - /api/animals
 *   - /api/tasks
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: {
      id: "user-1",
      email: "user-1@example.com",
      role: "admin",
      farms: [{ slug: "test-farm-slug", role: "admin" }],
    },
  }),
}));

const mockPrisma = {
  animal: { findMany: vi.fn().mockResolvedValue([]) },
  task: { findMany: vi.fn().mockResolvedValue([]) },
};

vi.mock("@/lib/farm-prisma", () => ({
  getPrismaWithAuth: vi.fn().mockResolvedValue({
    prisma: mockPrisma,
    slug: "test-farm-slug",
    role: "admin",
  }),

  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

vi.mock("@/lib/server/cached", () => ({
  getCachedFarmSummary: vi
    .fn()
    .mockResolvedValue({ farmName: "Test", breed: "", animalCount: 0, campCount: 0 }),
  getCachedCampList: vi.fn().mockResolvedValue([]),
  getCachedCampConditions: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

describe("Server-Timing header on instrumented routes", () => {
  beforeEach(() => {
    mockPrisma.animal.findMany.mockClear();
    mockPrisma.task.findMany.mockClear();
  });

  it("GET /api/farm emits Server-Timing with session + query + total", async () => {
    const { GET } = await import("@/app/api/farm/route");
    const res = await GET();
    const header = res.headers.get("Server-Timing") ?? "";
    expect(header).toMatch(/session;dur=/);
    expect(header).toMatch(/query;dur=/);
    expect(header).toMatch(/total;dur=/);
  });

  it("GET /api/camps emits Server-Timing", async () => {
    const { GET } = await import("@/app/api/camps/route");
    const res = await GET(new NextRequest("http://localhost/api/camps"));
    expect(res.headers.get("Server-Timing") ?? "").toMatch(/total;dur=/);
  });

  it("GET /api/camps/status emits Server-Timing", async () => {
    const { GET } = await import("@/app/api/camps/status/route");
    const res = await GET(new NextRequest("http://localhost/api/camps/status"));
    expect(res.headers.get("Server-Timing") ?? "").toMatch(/total;dur=/);
  });

  it("GET /api/animals emits Server-Timing", async () => {
    const { GET } = await import("@/app/api/animals/route");
    const res = await GET(new NextRequest("http://localhost/api/animals"));
    expect(res.headers.get("Server-Timing") ?? "").toMatch(/query;dur=/);
  });

  it("GET /api/tasks emits Server-Timing", async () => {
    const { GET } = await import("@/app/api/tasks/route");
    const res = await GET(new NextRequest("http://localhost/api/tasks"));
    expect(res.headers.get("Server-Timing") ?? "").toMatch(/query;dur=/);
  });

  it("unauthorised request still returns a well-formed response (header optional)", async () => {
    // Flip the session mock to null for this single invocation
    const { getServerSession } = await import("next-auth");
    vi.mocked(getServerSession).mockResolvedValueOnce(null as never);

    const { GET } = await import("@/app/api/farm/route");
    const res = await GET();
    expect(res.status).toBe(401);
    // Header is still present because withServerTiming runs around the 401
    expect(res.headers.get("Server-Timing") ?? "").toMatch(/total;dur=/);
  });
});
