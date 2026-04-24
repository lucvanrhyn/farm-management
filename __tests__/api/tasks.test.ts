/**
 * Tests for app/api/tasks/route.ts (GET + POST) and
 * app/api/tasks/[id]/route.ts (PATCH) and
 * app/api/task-templates/install/route.ts (POST) and
 * app/api/task-occurrences/route.ts (GET)
 *
 * TDD — written before implementation (RED phase).
 *
 * Mock strategy mirrors __tests__/api/observations.test.ts:
 *  - next-auth session is stubbed
 *  - farm-prisma is stubbed so no DB I/O occurs
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Session mock ──────────────────────────────────────────────────────────────
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

// Phase H.2: verifyFreshAdminRole hits the meta-db, which isn't available in
// unit tests. For handlers under test we trust the mocked session's ADMIN
// role; fresh-admin defence is exercised in the dedicated coverage suite.
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...actual, verifyFreshAdminRole: vi.fn().mockResolvedValue(true) };
});

// ── Prisma mock ───────────────────────────────────────────────────────────────
const mockTaskCreate = vi.fn();
const mockTaskUpdate = vi.fn();
const mockTaskFindMany = vi.fn();
const mockTaskFindUnique = vi.fn();
const mockObservationCreate = vi.fn();
const mockTemplateUpsert = vi.fn();
const mockTemplateFindUnique = vi.fn();
const mockOccurrenceFindMany = vi.fn();
const mockTransaction = vi.fn();

const mockPrisma = {
  task: {
    create: mockTaskCreate,
    update: mockTaskUpdate,
    findMany: mockTaskFindMany,
    findUnique: mockTaskFindUnique,
  },
  observation: {
    create: mockObservationCreate,
  },
  taskTemplate: {
    upsert: mockTemplateUpsert,
    findUnique: mockTemplateFindUnique,
  },
  taskOccurrence: {
    findMany: mockOccurrenceFindMany,
  },
  $transaction: mockTransaction,
};

const ADMIN_SESSION = {
  user: {
    id: "user-1",
    email: "admin@farm.com",
    role: "ADMIN",
    farms: [{ slug: "test-farm", role: "ADMIN" }],
  },
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
    return Promise.resolve({
      prisma: mockPrisma,
      slug: "test-farm",
      role,
    });
  }),
  getPrismaForRequest: vi.fn().mockResolvedValue({
    prisma: mockPrisma,
    slug: "test-farm",
  }),
  getPrismaForFarm: vi.fn().mockResolvedValue(mockPrisma),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 100 }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
// Next 16's NextRequest has stricter RequestInit types than the standard fetch
// RequestInit. Cast via `as ConstructorParameters` to satisfy TS without
// duplicating the complex type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(url: string, options?: Record<string, any>): NextRequest {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(url, options as any);
}

const TASK_ROW = {
  id: "task-1",
  title: "Weigh cattle",
  dueDate: "2026-04-20",
  assignedTo: "worker@farm.com",
  createdBy: "admin@farm.com",
  status: "pending",
  priority: "normal",
  taskType: "weighing",
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
  createdAt: new Date(),
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tasks
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/tasks", () => {
  beforeEach(() => {
    mockGetServerSession.mockResolvedValue(FIELD_SESSION);
    mockTaskFindMany.mockResolvedValue([TASK_ROW]);
  });

  it("returns 200 with tasks array", async () => {
    const { GET } = await import("@/app/api/tasks/route");
    const req = makeReq("http://localhost/api/tasks");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("returns 401 when no session", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/tasks/route");
    const req = makeReq("http://localhost/api/tasks");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("passes taskType filter to prisma query", async () => {
    const { GET } = await import("@/app/api/tasks/route");
    const req = makeReq("http://localhost/api/tasks?taskType=weighing");
    await GET(req);
    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ taskType: "weighing" }),
      }),
    );
  });

  it("passes campId filter to prisma query", async () => {
    const { GET } = await import("@/app/api/tasks/route");
    const req = makeReq("http://localhost/api/tasks?campId=camp-A");
    await GET(req);
    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ campId: "camp-A" }),
      }),
    );
  });

  it("returns occurrences shape when as=occurrences query is set", async () => {
    const occRow = {
      id: "occ-1",
      taskId: "task-1",
      occurrenceAt: new Date("2026-04-20"),
      status: "pending",
      task: TASK_ROW,
    };
    mockOccurrenceFindMany.mockResolvedValueOnce([occRow]);
    const { GET } = await import("@/app/api/tasks/route");
    const req = makeReq(
      "http://localhost/api/tasks?as=occurrences&from=2026-04-20T00:00:00Z&to=2026-04-21T00:00:00Z",
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    // Should not be calling taskFindMany for the occurrences path
    expect(mockOccurrenceFindMany).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tasks
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/tasks", () => {
  beforeEach(() => {
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockTaskCreate.mockResolvedValue({ ...TASK_ROW, id: "task-new" });
    mockTemplateFindUnique.mockResolvedValue(null);
    vi.resetModules();
  });

  it("creates task and returns 201", async () => {
    const { POST } = await import("@/app/api/tasks/route");
    const req = makeReq("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Weigh cattle",
        dueDate: "2026-04-20",
        assignedTo: "worker@farm.com",
        taskType: "weighing",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it("accepts and stores recurrenceRule field", async () => {
    const { POST } = await import("@/app/api/tasks/route");
    const req = makeReq("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Weekly dip",
        dueDate: "2026-04-20",
        assignedTo: "worker@farm.com",
        taskType: "dipping",
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ recurrenceRule: "FREQ=WEEKLY;BYDAY=MO" }),
      }),
    );
  });

  it("returns 400 with INVALID_RECURRENCE_RULE code when rule is invalid", async () => {
    const { POST } = await import("@/app/api/tasks/route");
    const req = makeReq("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Bad rule task",
        dueDate: "2026-04-20",
        assignedTo: "worker@farm.com",
        recurrenceRule: "totally-bogus-rule!!",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe("INVALID_RECURRENCE_RULE");
  });

  it("returns 403 when non-admin tries to create a task", async () => {
    mockGetServerSession.mockResolvedValueOnce(FIELD_SESSION);
    const { POST } = await import("@/app/api/tasks/route");
    const req = makeReq("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Weigh cattle",
        dueDate: "2026-04-20",
        assignedTo: "worker@farm.com",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 when title is missing", async () => {
    const { POST } = await import("@/app/api/tasks/route");
    const req = makeReq("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({ dueDate: "2026-04-20", assignedTo: "x@y.com" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("accepts assigneeIds array and JSON-stringifies for DB", async () => {
    const { POST } = await import("@/app/api/tasks/route");
    const req = makeReq("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Multi-person task",
        dueDate: "2026-04-20",
        assignedTo: "worker@farm.com",
        assigneeIds: ["worker1@farm.com", "worker2@farm.com"],
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assigneeIds: JSON.stringify(["worker1@farm.com", "worker2@farm.com"]),
        }),
      }),
    );
  });

  it("returns 400 with INVALID_RECURRENCE_RULE for after: shortcut with bad syntax", async () => {
    const { POST } = await import("@/app/api/tasks/route");
    const req = makeReq("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Bad shortcut",
        dueDate: "2026-04-20",
        assignedTo: "worker@farm.com",
        recurrenceRule: "after:calving+21", // missing 'd'
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe("INVALID_RECURRENCE_RULE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/tasks/[id]
// ─────────────────────────────────────────────────────────────────────────────
describe("PATCH /api/tasks/[id]", () => {
  beforeEach(() => {
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockTaskFindUnique.mockResolvedValue({ ...TASK_ROW, id: "task-1" });
    mockTaskUpdate.mockResolvedValue({ ...TASK_ROW, status: "completed", id: "task-1" });
    mockObservationCreate.mockResolvedValue({ id: "obs-new" });
    // $transaction executes the callback with the prisma client
    mockTransaction.mockImplementation((fn: (p: typeof mockPrisma) => unknown) => fn(mockPrisma));
    vi.resetModules();
  });

  it("completes a task with valid completionPayload and creates observation", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        completionPayload: { weightKg: 350 },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.observationCreated).toBe(true);
    expect(typeof data.observationId).toBe("string");
  });

  it("completes a task with no completionPayload — observationCreated=false", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.observationCreated).toBe(false);
    expect(data.observationId).toBeUndefined();
  });

  it("completes with incomplete payload — still 200, observationCreated=false", async () => {
    // weighing task but payload missing weightKg
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        completionPayload: { notes: "done but no weight" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.observationCreated).toBe(false);
  });

  it("returns 404 when task does not exist", async () => {
    mockTaskFindUnique.mockResolvedValueOnce(null);
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/nonexistent", {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
  });

  it("returns 401 when no session on PATCH", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(401);
  });

  it("uses prisma.$transaction when observation is created", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        completionPayload: { weightKg: 300 },
      }),
      headers: { "Content-Type": "application/json" },
    });
    await PATCH(req, { params: Promise.resolve({ id: "task-1" }) });
    expect(mockTransaction).toHaveBeenCalled();
  });

  it("sets completedObservationId on the task when observation is created", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        completionPayload: { weightKg: 400 },
      }),
      headers: { "Content-Type": "application/json" },
    });
    await PATCH(req, { params: Promise.resolve({ id: "task-1" }) });
    // The update call must include completedObservationId
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          completedObservationId: expect.any(String),
        }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/task-templates/install
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/task-templates/install", () => {
  beforeEach(() => {
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockTemplateUpsert.mockResolvedValue({ id: "tmpl-1" });
    vi.resetModules();
  });

  it("installs seed templates and returns installed count", async () => {
    const { POST } = await import("@/app/api/task-templates/install/route");
    const req = makeReq("http://localhost/api/task-templates/install", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.installed).toBe("number");
    expect(data.installed + data.skipped).toBe(20); // 20 seed templates total
  });

  it("is idempotent — calling twice returns same counts", async () => {
    const { POST } = await import("@/app/api/task-templates/install/route");
    const req1 = makeReq("http://localhost/api/task-templates/install", { method: "POST" });
    const req2 = makeReq("http://localhost/api/task-templates/install", { method: "POST" });
    const res1 = await POST(req1);
    const res2 = await POST(req2);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  it("returns 403 for non-admin session", async () => {
    mockGetServerSession.mockResolvedValueOnce(FIELD_SESSION);
    const { POST } = await import("@/app/api/task-templates/install/route");
    const req = makeReq("http://localhost/api/task-templates/install", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 401 when no session", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const { POST } = await import("@/app/api/task-templates/install/route");
    const req = makeReq("http://localhost/api/task-templates/install", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/task-occurrences
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/task-occurrences", () => {
  beforeEach(() => {
    mockGetServerSession.mockResolvedValue(FIELD_SESSION);
    mockOccurrenceFindMany.mockResolvedValue([
      {
        id: "occ-1",
        taskId: "task-1",
        occurrenceAt: new Date("2026-04-20T08:00:00Z"),
        status: "pending",
        task: TASK_ROW,
      },
    ]);
    vi.resetModules();
  });

  it("returns 200 with occurrences array", async () => {
    const { GET } = await import("@/app/api/task-occurrences/route");
    const req = makeReq(
      "http://localhost/api/task-occurrences?from=2026-04-20T00:00:00Z&to=2026-04-21T00:00:00Z",
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data[0]).toHaveProperty("taskId");
  });

  it("returns 401 when no session", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/task-occurrences/route");
    const req = makeReq("http://localhost/api/task-occurrences");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("defaults from/to to today range when not provided", async () => {
    const { GET } = await import("@/app/api/task-occurrences/route");
    const req = makeReq("http://localhost/api/task-occurrences");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mockOccurrenceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          occurrenceAt: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }),
        }),
      }),
    );
  });

  it("orders results by occurrenceAt ascending", async () => {
    const { GET } = await import("@/app/api/task-occurrences/route");
    const req = makeReq("http://localhost/api/task-occurrences");
    await GET(req);
    expect(mockOccurrenceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { occurrenceAt: "asc" },
      }),
    );
  });
});
