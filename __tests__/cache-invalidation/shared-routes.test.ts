/**
 * __tests__/cache-invalidation/shared-routes.test.ts
 *
 * Contract tests: every mutation in the shared API routes
 * (not farm-slug-scoped in the URL) must call revalidateTag with the
 * correct farm-scoped tags after a successful DB write.
 *
 * Pattern:
 *   1. Mock session + prisma + DB operation to succeed.
 *   2. Call the route handler with a mutation method.
 *   3. Assert revalidateTag was called with the expected tag(s).
 *
 * These tests are the safety net that catches a missed or mis-tagged
 * invalidation before a user sees stale data.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { farmTag } from "@/lib/server/cache-tags";

const SLUG = "test-farm";

// ── Session mock ─────────────────────────────────────────────────────────────

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: {
      id: "user-1",
      email: "user@test.com",
      farms: [{ slug: SLUG, role: "ADMIN" }],
    },
  }),
}));

vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));

// ── Prisma mock ──────────────────────────────────────────────────────────────

const mockCreate = vi.fn().mockResolvedValue({ animalId: "T001" });
const mockFindUnique = vi.fn().mockResolvedValue(null);
const mockCount = vi.fn().mockResolvedValue(5);
const mockGroupBy = vi.fn().mockResolvedValue([]);
const mockFindMany = vi.fn().mockResolvedValue([]);
const mockUpdate = vi.fn().mockResolvedValue({});
const mockDelete = vi.fn().mockResolvedValue({});

const mockPrisma = {
  animal: { create: mockCreate, findUnique: mockFindUnique, findMany: mockFindMany, count: mockCount, groupBy: mockGroupBy, update: mockUpdate, delete: mockDelete },
  // Phase A of #28: camp routes now use findFirst (campId no longer globally unique).
  camp: { create: mockCreate, findUnique: mockFindUnique, findFirst: mockFindUnique, findMany: mockFindMany, count: mockCount },
  observation: { create: mockCreate, findMany: mockFindMany, count: mockCount },
  task: { create: mockCreate, findMany: mockFindMany, findUnique: mockFindUnique, update: mockUpdate, delete: mockDelete },
  taskOccurrence: { findMany: mockFindMany, findUnique: mockFindUnique, update: mockUpdate },
  farmSettings: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue({}) },
  farmSpeciesSettings: { findMany: mockFindMany, upsert: vi.fn().mockResolvedValue({}) },
  mob: { create: mockCreate, findUnique: mockFindUnique, findMany: mockFindMany, delete: mockDelete, update: mockUpdate },
  mobAnimal: { create: mockCreate, delete: mockDelete, findFirst: vi.fn().mockResolvedValue(null), deleteMany: vi.fn().mockResolvedValue({}) },
};

vi.mock("@/lib/farm-prisma", () => ({
  getPrismaWithAuth: vi.fn().mockResolvedValue({
    prisma: mockPrisma,
    slug: SLUG,
    role: "ADMIN",
  }),
  getPrismaForFarm: vi.fn().mockResolvedValue(mockPrisma),
  withFarmPrisma: vi.fn().mockImplementation((_slug: string, fn: (p: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma)),

  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

// ── Cache mocks ──────────────────────────────────────────────────────────────

const mockRevalidateTag = vi.fn();
const mockRevalidatePath = vi.fn();
const mockUnstableCache = vi.fn().mockImplementation((fn: (...args: unknown[]) => unknown) => fn);

vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
  unstable_cache: (...args: unknown[]) => mockUnstableCache(...args),
}));

// Stub cached helpers and species registry
vi.mock("@/lib/server/cached", () => ({
  getCachedCampList: vi.fn().mockResolvedValue([]),
  getCachedFarmSummary: vi.fn().mockResolvedValue({ farmName: "Test", breed: "Mixed", heroImageUrl: "/img.jpg", animalCount: 0, campCount: 0 }),
}));

vi.mock("@/lib/species/registry", () => ({
  getAllSpeciesConfigs: vi.fn().mockReturnValue([
    { id: "cattle", label: "Cattle" },
    { id: "sheep", label: "Sheep" },
  ]),
}));

vi.mock("@/lib/auth", () => ({
  getUserRoleForFarm: vi.fn().mockReturnValue("ADMIN"),
  // Phase H.2: every admin-write route now re-verifies against meta-db.
  // Tests don't have meta-db; trust the mocked ADMIN role.
  verifyFreshAdminRole: vi.fn().mockResolvedValue(true),
}));

// Stub CAMP_COLOR_PALETTE to avoid import side effects
vi.mock("@/lib/camp-colors", () => ({
  CAMP_COLOR_PALETTE: ["#2563EB"],
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({ animalId: "T001", campId: "C1", id: "OBS1" });
  mockFindUnique.mockResolvedValue(null);
});

// ── Helper ────────────────────────────────────────────────────────────────────

function assertTagFired(tag: string): void {
  const calls = mockRevalidateTag.mock.calls.map((c) => c[0]);
  expect(calls, `Expected revalidateTag("${tag}") but got [${calls.join(", ")}]`).toContain(tag);
}

function assertNoRevalidatePath(): void {
  expect(mockRevalidatePath).not.toHaveBeenCalled();
}

// ── /api/animals POST ─────────────────────────────────────────────────────────

describe("POST /api/animals", () => {
  it("calls revalidateTag for animals + dashboard scopes", async () => {
    const { POST } = await import("@/app/api/animals/route");
    const req = new NextRequest("http://localhost/api/animals", {
      method: "POST",
      body: JSON.stringify({
        animalId: "T001",
        sex: "Female",
        category: "Cow",
        currentCamp: "Rivier",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    assertTagFired(farmTag(SLUG, "animals"));
    assertTagFired(farmTag(SLUG, "dashboard"));
    assertNoRevalidatePath();
  });
});

// ── /api/camps POST ───────────────────────────────────────────────────────────

describe("POST /api/camps", () => {
  it("calls revalidateTag for camps + dashboard scopes", async () => {
    const { POST } = await import("@/app/api/camps/route");
    const req = new NextRequest("http://localhost/api/camps", {
      method: "POST",
      body: JSON.stringify({ campId: "C1", campName: "Test Camp" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    assertTagFired(farmTag(SLUG, "camps"));
    assertTagFired(farmTag(SLUG, "dashboard"));
    assertNoRevalidatePath();
  });
});

// ── /api/observations POST ────────────────────────────────────────────────────

describe("POST /api/observations", () => {
  it("calls revalidateTag for observations + dashboard scopes", async () => {
    // Observations route verifies camp existence — mock camp as present
    mockFindUnique.mockResolvedValueOnce({ campId: "C1" });
    mockPrisma.observation.create = vi.fn().mockResolvedValue({
      id: "OBS1",
      campId: "C1",
      type: "camp_condition",
      observedAt: new Date(),
    });

    const { POST } = await import("@/app/api/observations/route");
    const req = new NextRequest("http://localhost/api/observations", {
      method: "POST",
      body: JSON.stringify({
        type: "camp_condition",
        camp_id: "C1",
        details: {},
      }),
    });

    const res = await POST(req);
    expect([200, 201]).toContain(res.status);

    assertTagFired(farmTag(SLUG, "observations"));
    assertTagFired(farmTag(SLUG, "dashboard"));
    assertNoRevalidatePath();
  });
});

// ── /api/tasks POST ───────────────────────────────────────────────────────────

describe("POST /api/tasks", () => {
  it("calls revalidateTag for tasks scope", async () => {
    mockPrisma.task.create = vi.fn().mockResolvedValue({
      id: "TASK1",
      title: "Check fences",
      campId: null,
      priority: "medium",
    });

    const { POST } = await import("@/app/api/tasks/route");
    const req = new NextRequest("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Check fences",
        priority: "medium",
        dueDate: "2026-04-30",
        assignedTo: "user@test.com",
      }),
    });

    const res = await POST(req);
    expect([200, 201]).toContain(res.status);

    assertTagFired(farmTag(SLUG, "tasks"));
    assertNoRevalidatePath();
  });
});

// ── /api/farm/species-settings PATCH ─────────────────────────────────────────

describe("PATCH /api/farm/species-settings", () => {
  it("calls revalidateTag for settings scope", async () => {
    const { PATCH } = await import("@/app/api/farm/species-settings/route");
    const req = new NextRequest(
      `http://localhost/api/farm/species-settings?farmSlug=${SLUG}`,
      {
        method: "PATCH",
        body: JSON.stringify({ species: "sheep", enabled: true }),
      },
    );

    const res = await PATCH(req);
    expect([200, 201]).toContain(res.status);

    assertTagFired(farmTag(SLUG, "settings"));
    assertNoRevalidatePath();
  });
});
