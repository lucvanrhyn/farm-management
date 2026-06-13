/**
 * @vitest-environment node
 *
 * Write-path coverage for the repro bull-trait observation sub-types
 * (body_condition_score / temperament_score / scrotal_circumference) through
 * the REAL POST /api/observations route.
 *
 * Closes a residual-closeout gap: these three types are in OBSERVATION_TYPES
 * (registry.ts:56-58) and validateReproductiveState enforces their required
 * fields, but no test posted a CLEAN payload for them through the route
 * asserting 200 + persistence — the existing repro tests assert only the 422
 * REJECT paths and call the validator in isolation. A live replay logging a
 * clean BCS/temperament/scrotal observation is exactly this happy path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockCreate = vi.fn().mockResolvedValue({ id: "obs-1" });
const mockFindMany = vi.fn().mockResolvedValue([]);
const mockCampFindFirst = vi.fn().mockResolvedValue({ campId: "A" });
const mockCampFindUnique = vi
  .fn()
  .mockResolvedValue({ id: "camp-row-1", species: "cattle" });
const mockAnimalFindUnique = vi.fn().mockResolvedValue({ species: "cattle" });

const mockPrisma = {
  observation: { create: mockCreate, findMany: mockFindMany },
  camp: { findFirst: mockCampFindFirst, findUnique: mockCampFindUnique },
  animal: { findUnique: mockAnimalFindUnique },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/server/farm-context", () => ({
  getFarmContext: vi.fn().mockResolvedValue({
    session: {
      user: {
        id: "user-1",
        email: "user-1@example.com",
        role: "field_logger",
        farms: [{ slug: "test-farm-slug", role: "field_logger" }],
      },
    },
    prisma: mockPrisma,
    slug: "test-farm-slug",
    role: "field_logger",
  }),
}));
vi.mock("@/lib/farm-prisma", () => ({
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 100 }),
}));

function postBody(type: string, details: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/observations", {
    method: "POST",
    body: JSON.stringify({
      type,
      camp_id: "A",
      animal_id: "bull-001",
      details: JSON.stringify(details),
      created_at: "2026-06-13T08:00:00.000Z",
    }),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({ id: "obs-1" });
  mockCampFindUnique.mockResolvedValue({ id: "camp-row-1", species: "cattle" });
  mockAnimalFindUnique.mockResolvedValue({ species: "cattle" });
});

describe("POST /api/observations — repro sub-type happy path persists", () => {
  it.each([
    ["body_condition_score", { score: 6 }],
    ["temperament_score", { score: 3 }],
    ["scrotal_circumference", { measurement_cm: 36 }],
  ])("%s with a valid payload → 200 and persists with species stamp", async (type, details) => {
    const { POST } = await import("@/app/api/observations/route");

    const res = await POST(postBody(type, details), {
      params: Promise.resolve({}),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type,
        animalId: "bull-001",
        species: "cattle",
      }),
    });
  });
});
