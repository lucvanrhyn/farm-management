/**
 * __tests__/tasks/route-pagination.test.ts
 *
 * TDD — written before implementation (RED phase).
 *
 * Phase I.1: cursor-paginate /api/tasks GET with a composite cursor over
 * {dueDate, createdAt, id} so stable ordering is preserved across ties.
 *
 * Mock strategy mirrors __tests__/api/tasks.test.ts (next-auth stubbed,
 * farm-prisma stubbed so no DB I/O occurs).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Session mock ──
const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: () => ({ id: "credentials" }),
}));
vi.mock("@/lib/auth-options", () => ({
  authOptions: {},
}));

// ── Prisma mock ──
const mockTaskFindMany = vi.fn();
const mockOccurrenceFindMany = vi.fn();
const mockPrisma = {
  task: { findMany: mockTaskFindMany },
  taskOccurrence: { findMany: mockOccurrenceFindMany },
};

const FIELD_SESSION = {
  user: {
    id: "user-2",
    email: "worker@farm.com",
    role: "field_logger",
    farms: [{ slug: "test-farm", role: "field_logger" }],
  },
};

vi.mock("@/lib/farm-prisma", () => ({
  getPrismaWithAuth: vi.fn().mockImplementation((session) => {
    const role = session?.user?.farms?.[0]?.role ?? "field_logger";
    return Promise.resolve({ prisma: mockPrisma, slug: "test-farm", role });
  }),
  getPrismaForRequest: vi
    .fn()
    .mockResolvedValue({ prisma: mockPrisma, slug: "test-farm" }),
  getPrismaForFarm: vi.fn().mockResolvedValue(mockPrisma),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 100 }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(url: string, options?: Record<string, any>): NextRequest {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(url, options as any);
}

function makeTasks(
  rows: Array<{ id: string; dueDate: string; createdAt: string }>,
) {
  return rows.map((r) => ({
    id: r.id,
    title: `Task ${r.id}`,
    description: null,
    dueDate: r.dueDate,
    assignedTo: "worker@farm.com",
    createdBy: "admin@farm.com",
    status: "pending",
    priority: "normal",
    taskType: null,
    lat: null,
    lng: null,
    campId: null,
    animalId: null,
    recurrenceRule: null,
    reminderOffset: null,
    assigneeIds: null,
    templateId: null,
    blockedByIds: null,
    completedObservationId: null,
    recurrenceSource: null,
    completedAt: null,
    createdAt: new Date(r.createdAt),
  }));
}

describe("GET /api/tasks — cursor pagination (opt-in)", () => {
  beforeEach(() => {
    mockTaskFindMany.mockReset();
    mockOccurrenceFindMany.mockReset();
    mockGetServerSession.mockResolvedValue(FIELD_SESSION);
  });

  it("returns ≤limit items with nextCursor populated when more exist", async () => {
    // Stub returns limit+1=6 rows; the 6th signals "more available".
    mockTaskFindMany.mockResolvedValueOnce(
      makeTasks([
        { id: "t1", dueDate: "2026-04-01", createdAt: "2026-04-01T08:00:00Z" },
        { id: "t2", dueDate: "2026-04-02", createdAt: "2026-04-02T08:00:00Z" },
        { id: "t3", dueDate: "2026-04-03", createdAt: "2026-04-03T08:00:00Z" },
        { id: "t4", dueDate: "2026-04-04", createdAt: "2026-04-04T08:00:00Z" },
        { id: "t5", dueDate: "2026-04-05", createdAt: "2026-04-05T08:00:00Z" },
        { id: "t6", dueDate: "2026-04-06", createdAt: "2026-04-06T08:00:00Z" },
      ]),
    );
    const { GET } = await import("@/app/api/tasks/route");
    const req = makeReq("http://localhost/api/tasks?limit=5");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.tasks).toHaveLength(5);
    expect(data.hasMore).toBe(true);
    expect(typeof data.nextCursor).toBe("string");
    expect(data.nextCursor.length).toBeGreaterThan(0);

    // Paginated mode should fetch limit+1 rows and order by a stable
    // composite sort (dueDate, createdAt, id).
    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 6,
        orderBy: [
          { dueDate: "asc" },
          { createdAt: "asc" },
          { id: "asc" },
        ],
      }),
    );
  });

  it("returns hasMore:false and nextCursor:null when the page is the last", async () => {
    mockTaskFindMany.mockResolvedValueOnce(
      makeTasks([
        { id: "t1", dueDate: "2026-04-01", createdAt: "2026-04-01T08:00:00Z" },
        { id: "t2", dueDate: "2026-04-02", createdAt: "2026-04-02T08:00:00Z" },
      ]),
    );
    const { GET } = await import("@/app/api/tasks/route");
    const req = makeReq("http://localhost/api/tasks?limit=5");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.tasks).toHaveLength(2);
    expect(data.hasMore).toBe(false);
    expect(data.nextCursor).toBeNull();
  });

  it("applies a composite cursor filter so the next page starts strictly after the cursor row", async () => {
    mockTaskFindMany.mockResolvedValueOnce(makeTasks([]));

    // Build a cursor from a synthetic "last row" of the previous page.
    const lastRow = {
      dueDate: "2026-04-05",
      createdAt: "2026-04-05T08:00:00.000Z",
      id: "t5",
    };
    const cursor = Buffer.from(JSON.stringify(lastRow), "utf-8").toString(
      "base64url",
    );

    const { GET } = await import("@/app/api/tasks/route");
    const req = makeReq(
      `http://localhost/api/tasks?limit=5&cursor=${cursor}`,
    );
    await GET(req);

    // The handler must translate the opaque cursor into a tuple-strict-gt
    // filter: (dueDate > d) OR (dueDate = d AND createdAt > c) OR
    //        (dueDate = d AND createdAt = c AND id > i).
    expect(mockTaskFindMany).toHaveBeenCalledTimes(1);
    const callArgs = mockTaskFindMany.mock.calls[0][0];
    expect(callArgs).toHaveProperty("where");
    const where = callArgs.where as Record<string, unknown>;
    expect(where).toHaveProperty("OR");
    const orClauses = where.OR as Array<Record<string, unknown>>;
    expect(orClauses).toHaveLength(3);
    // Clause 1: strict gt on dueDate
    expect(orClauses[0]).toEqual({ dueDate: { gt: lastRow.dueDate } });
    // Clause 2: equal dueDate + strict gt createdAt
    expect(orClauses[1]).toMatchObject({
      dueDate: lastRow.dueDate,
      createdAt: { gt: expect.anything() },
    });
    // Clause 3: equal dueDate + equal createdAt + strict gt id
    expect(orClauses[2]).toMatchObject({
      dueDate: lastRow.dueDate,
      createdAt: expect.anything(),
      id: { gt: lastRow.id },
    });
  });

  it("rejects a non-numeric limit with 400", async () => {
    const { GET } = await import("@/app/api/tasks/route");
    const req = makeReq("http://localhost/api/tasks?limit=abc");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/invalid limit/i);
    expect(mockTaskFindMany).not.toHaveBeenCalled();
  });

  it("rejects a malformed cursor with 400", async () => {
    const { GET } = await import("@/app/api/tasks/route");
    const req = makeReq(
      "http://localhost/api/tasks?limit=5&cursor=%21%21not-base64%21%21",
    );
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/invalid cursor/i);
    expect(mockTaskFindMany).not.toHaveBeenCalled();
  });

  it("keeps the legacy array shape when neither limit nor cursor is provided", async () => {
    mockTaskFindMany.mockResolvedValueOnce(
      makeTasks([
        { id: "t1", dueDate: "2026-04-01", createdAt: "2026-04-01T08:00:00Z" },
      ]),
    );
    const { GET } = await import("@/app/api/tasks/route");
    const req = makeReq("http://localhost/api/tasks");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });
});
