/**
 * @vitest-environment node
 *
 * __tests__/api/task-completion-flow.test.ts — Phase K Wave 3G
 *
 * Integration test: task-observation bridge end-to-end.
 *
 * Exercises the full sequence:
 *   1. POST /api/task-templates/install → seeds 20 templates
 *   2. POST /api/tasks → creates a weighing task
 *   3. PATCH /api/tasks/[id] status→completed with completionPayload
 *   4. Asserts response shape (observationCreated, observationId)
 *   5. Asserts prisma.observation.create was called with correct type+details
 *   6. Asserts prisma.task.update sets completedObservationId
 *   7. Negative path: PATCH without payload → observationCreated=false, no obs
 *
 * Mock strategy mirrors __tests__/api/tasks.test.ts (same file's beforeEach
 * pattern). No real DB I/O — we verify the bridge logic through mock call args.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── next-auth ─────────────────────────────────────────────────────────────────
const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: () => ({ id: "credentials" }),
}));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));

// Phase H.2: verifyFreshAdminRole hits the meta-db, which isn't available in
// unit tests. For handlers under test we trust the mocked ADMIN session.
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
const mockTransaction = vi.fn();
// Phase I.3 — task route now looks up Animal.species at write time so the
// denormalised Observation.species stays fresh. Default mock returns cattle.
const mockAnimalFindUnique = vi.fn().mockResolvedValue({ species: "cattle" });
// ADR-0006 — updateTask now routes the task-completion observation
// through `createObservation`, which calls `crossSpecies(...).camp.findFirst`
// to verify camp existence and read its species. Stub a default
// "camp exists, species null" so the door's CampNotFoundError path is
// not the default outcome. The mob stub is defensive (mob_id is never
// supplied on task-completion observations).
const mockCampFindFirst = vi.fn().mockResolvedValue({ campId: "camp-north", species: null });
const mockMobFindUnique = vi.fn();

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
  animal: {
    findUnique: mockAnimalFindUnique,
  },
  camp: {
    findFirst: mockCampFindFirst,
  },
  mob: {
    findUnique: mockMobFindUnique,
  },
  taskTemplate: {
    upsert: mockTemplateUpsert,
  },
  $transaction: mockTransaction,
};

vi.mock("@/lib/farm-prisma", () => ({
  getPrismaWithAuth: vi.fn().mockImplementation((session: { user?: { farms?: Array<{ role: string }> } }) => {
    const role = session?.user?.farms?.[0]?.role ?? "field_logger";
    return Promise.resolve({ prisma: mockPrisma, slug: "test-farm", role });
  }),

  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 100 }),
}));

// ── Session fixtures ──────────────────────────────────────────────────────────
const ADMIN_SESSION = {
  user: {
    id: "user-admin",
    email: "admin@trio-b.farm",
    role: "ADMIN",
    farms: [{ slug: "test-farm", role: "ADMIN" }],
  },
};

// ── Task row fixture ──────────────────────────────────────────────────────────
const BASE_TASK = {
  id: "task-weighing-1",
  title: "Weigh cattle batch A",
  dueDate: "2026-04-22",
  assignedTo: "worker@trio-b.farm",
  createdBy: "admin@trio-b.farm",
  status: "pending",
  priority: "normal",
  taskType: "weighing",
  lat: null,
  lng: null,
  campId: "camp-north",
  animalId: "animal-1",
  recurrenceRule: null,
  reminderOffset: null,
  assigneeIds: null,
  templateId: null,
  blockedByIds: null,
  completedObservationId: null,
  recurrenceSource: null,
  completedAt: null,
  createdAt: new Date("2026-04-20T07:00:00Z"),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(url: string, options?: Record<string, any>): NextRequest {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(url, options as any);
}

// Wave E (#161) — adapter-wrapped POST takes a Next.js 16 RouteContext
// as the second arg. /api/tasks has no dynamic segments → empty params.
const EMPTY_CTX = { params: Promise.resolve({}) };

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: POST /api/task-templates/install
// ─────────────────────────────────────────────────────────────────────────────
describe("Step 1 — POST /api/task-templates/install", () => {
  beforeEach(() => {
    // Clear all call history so counts are per-test
    mockTemplateUpsert.mockClear();
    mockTaskCreate.mockClear();
    mockObservationCreate.mockClear();
    mockTransaction.mockClear();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    // Simulate fresh install: createdAt ≈ updatedAt (within 1 second)
    mockTemplateUpsert.mockImplementation(() => {
      const now = new Date();
      return Promise.resolve({ id: "tmpl", createdAt: now, updatedAt: now });
    });
    vi.resetModules();
  });

  it("returns 200 with installed + skipped summing to 20", async () => {
    const { POST } = await import("@/app/api/task-templates/install/route");
    const req = makeReq("http://localhost/api/task-templates/install", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.installed).toBe("number");
    expect(typeof data.skipped).toBe("number");
    expect(data.installed + data.skipped).toBe(20);
  });

  it("calls prisma.taskTemplate.upsert once per seed template (20 times)", async () => {
    const { POST } = await import("@/app/api/task-templates/install/route");
    const req = makeReq("http://localhost/api/task-templates/install", {
      method: "POST",
    });
    await POST(req);
    expect(mockTemplateUpsert).toHaveBeenCalledTimes(20);
  });

  it("each upsert call includes tenantSlug and name in where clause", async () => {
    const { POST } = await import("@/app/api/task-templates/install/route");
    const req = makeReq("http://localhost/api/task-templates/install", {
      method: "POST",
    });
    await POST(req);
    for (const call of mockTemplateUpsert.mock.calls) {
      const arg = call[0] as { where?: { tenantSlug_name?: { tenantSlug: string; name: string } } };
      expect(arg.where?.tenantSlug_name?.tenantSlug).toBe("test-farm");
      expect(typeof arg.where?.tenantSlug_name?.name).toBe("string");
    }
  });

  it("upsert update body is empty {} to preserve customised templates", async () => {
    const { POST } = await import("@/app/api/task-templates/install/route");
    const req = makeReq("http://localhost/api/task-templates/install", {
      method: "POST",
    });
    await POST(req);
    for (const call of mockTemplateUpsert.mock.calls) {
      const arg = call[0] as { update?: Record<string, unknown> };
      expect(arg.update).toEqual({});
    }
  });

  it("returns 401 for missing session", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const { POST } = await import("@/app/api/task-templates/install/route");
    const res = await POST(
      makeReq("http://localhost/api/task-templates/install", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-ADMIN session", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: {
        id: "u2",
        email: "field@farm.com",
        farms: [{ slug: "test-farm", role: "field_logger" }],
      },
    });
    const { POST } = await import("@/app/api/task-templates/install/route");
    const res = await POST(
      makeReq("http://localhost/api/task-templates/install", { method: "POST" }),
    );
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: POST /api/tasks — create a weighing task
// ─────────────────────────────────────────────────────────────────────────────
describe("Step 2 — POST /api/tasks (create weighing task)", () => {
  beforeEach(() => {
    mockTemplateUpsert.mockClear();
    mockTaskCreate.mockClear();
    mockObservationCreate.mockClear();
    mockTransaction.mockClear();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockTaskCreate.mockResolvedValue({ ...BASE_TASK, id: "task-weighing-1" });
    vi.resetModules();
  });

  it("creates task with taskType=weighing and returns 201", async () => {
    const { POST } = await import("@/app/api/tasks/route");
    const req = makeReq("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Weigh cattle batch A",
        dueDate: "2026-04-22",
        assignedTo: "worker@trio-b.farm",
        taskType: "weighing",
        animalId: "animal-1",
        campId: "camp-north",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, EMPTY_CTX);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe("task-weighing-1");
    expect(data.taskType).toBe("weighing");
  });

  it("passes taskType to prisma.task.create", async () => {
    const { POST } = await import("@/app/api/tasks/route");
    const req = makeReq("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Weigh cattle",
        dueDate: "2026-04-22",
        assignedTo: "worker@trio-b.farm",
        taskType: "weighing",
        animalId: "animal-1",
      }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req, EMPTY_CTX);
    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ taskType: "weighing", animalId: "animal-1" }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 3–6: PATCH /api/tasks/[id] → status:completed WITH payload
// ─────────────────────────────────────────────────────────────────────────────
describe("Step 3-6 — PATCH /api/tasks/[id] status→completed WITH completionPayload", () => {
  const CREATED_OBS = { id: "obs-auto-1" };

  beforeEach(() => {
    mockTemplateUpsert.mockClear();
    mockTaskCreate.mockClear();
    mockObservationCreate.mockClear();
    mockTransaction.mockClear();
    mockTaskUpdate.mockClear();
    mockTaskFindUnique.mockClear();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockTaskFindUnique.mockResolvedValue({ ...BASE_TASK });
    mockObservationCreate.mockResolvedValue(CREATED_OBS);
    mockTaskUpdate.mockResolvedValue({
      ...BASE_TASK,
      status: "completed",
      completedAt: new Date().toISOString(),
      completedObservationId: CREATED_OBS.id,
    });
    // $transaction runs the callback immediately with the mock prisma client
    mockTransaction.mockImplementation(
      (fn: (p: typeof mockPrisma) => unknown) => fn(mockPrisma),
    );
    vi.resetModules();
  });

  it("returns 200 with observationCreated=true and valid observationId", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-weighing-1", {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        completionPayload: { weightKg: 450 },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "task-weighing-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.observationCreated).toBe(true);
    expect(typeof data.observationId).toBe("string");
    expect(data.observationId).toBe("obs-auto-1");
  });

  it("creates observation with type=weighing and details containing the weight", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-weighing-1", {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        completionPayload: { weightKg: 450 },
      }),
      headers: { "Content-Type": "application/json" },
    });
    await PATCH(req, { params: Promise.resolve({ id: "task-weighing-1" }) });
    expect(mockObservationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "weighing",
          details: expect.stringContaining("450"),
        }),
      }),
    );
  });

  it("links observation to task via completedObservationId in task update", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-weighing-1", {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        completionPayload: { weightKg: 450 },
      }),
      headers: { "Content-Type": "application/json" },
    });
    await PATCH(req, { params: Promise.resolve({ id: "task-weighing-1" }) });
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "task-weighing-1" },
        data: expect.objectContaining({
          completedObservationId: "obs-auto-1",
        }),
      }),
    );
  });

  it("wraps both writes in a $transaction (atomicity guarantee)", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-weighing-1", {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        completionPayload: { weightKg: 450 },
      }),
      headers: { "Content-Type": "application/json" },
    });
    await PATCH(req, { params: Promise.resolve({ id: "task-weighing-1" }) });
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it("sets status=completed on the task row", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-weighing-1", {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        completionPayload: { weightKg: 450 },
      }),
      headers: { "Content-Type": "application/json" },
    });
    await PATCH(req, { params: Promise.resolve({ id: "task-weighing-1" }) });
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed" }),
      }),
    );
  });

  // treatment task type
  it("creates treatment observation when taskType=treatment with product payload", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      ...BASE_TASK,
      taskType: "treatment",
      animalId: "animal-2",
    });
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-weighing-1", {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        completionPayload: { product: "Copper supplement", dose: "10ml" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    await PATCH(req, { params: Promise.resolve({ id: "task-weighing-1" }) });
    expect(mockObservationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "treatment",
          details: expect.stringContaining("Copper supplement"),
        }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 7: Negative path — PATCH without payload → no observation
// ─────────────────────────────────────────────────────────────────────────────
describe("Step 7 — PATCH /api/tasks/[id] status→completed WITHOUT payload (negative path)", () => {
  beforeEach(() => {
    mockTemplateUpsert.mockClear();
    mockTaskCreate.mockClear();
    mockObservationCreate.mockClear();
    mockTransaction.mockClear();
    mockTaskUpdate.mockClear();
    mockTaskFindUnique.mockClear();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockTaskFindUnique.mockResolvedValue({ ...BASE_TASK });
    mockTaskUpdate.mockResolvedValue({
      ...BASE_TASK,
      status: "completed",
      completedAt: new Date().toISOString(),
      completedObservationId: null,
    });
    mockTransaction.mockImplementation(
      (fn: (p: typeof mockPrisma) => unknown) => fn(mockPrisma),
    );
    vi.resetModules();
  });

  it("returns 200 with observationCreated=false when no completionPayload", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-weighing-1", {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "task-weighing-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.observationCreated).toBe(false);
    expect(data.observationId).toBeUndefined();
  });

  it("does NOT call prisma.observation.create when no payload", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-weighing-1", {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
      headers: { "Content-Type": "application/json" },
    });
    await PATCH(req, { params: Promise.resolve({ id: "task-weighing-1" }) });
    expect(mockObservationCreate).not.toHaveBeenCalled();
  });

  it("does NOT call $transaction when no observation is created", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-weighing-1", {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
      headers: { "Content-Type": "application/json" },
    });
    await PATCH(req, { params: Promise.resolve({ id: "task-weighing-1" }) });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 200 with observationCreated=false for incomplete weighing payload (missing weightKg)", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-weighing-1", {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        completionPayload: { notes: "no weight recorded" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "task-weighing-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.observationCreated).toBe(false);
    expect(mockObservationCreate).not.toHaveBeenCalled();
  });

  it("returns 200 with observationCreated=false for maintenance taskType (no obs expected)", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      ...BASE_TASK,
      taskType: "fence_repair",
      animalId: null,
    });
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-weighing-1", {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        completionPayload: { repairType: "post replacement" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "task-weighing-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.observationCreated).toBe(false);
    expect(mockObservationCreate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Supplementary: observation type coverage for key task types
// ─────────────────────────────────────────────────────────────────────────────
describe("observationFromTaskCompletion — observation type coverage via PATCH", () => {
  const CREATED_OBS_2 = { id: "obs-2" };

  beforeEach(() => {
    mockTemplateUpsert.mockClear();
    mockTaskCreate.mockClear();
    mockObservationCreate.mockClear();
    mockTransaction.mockClear();
    mockTaskUpdate.mockClear();
    mockTaskFindUnique.mockClear();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockObservationCreate.mockResolvedValue(CREATED_OBS_2);
    mockTaskUpdate.mockResolvedValue({
      ...BASE_TASK,
      status: "completed",
      completedObservationId: CREATED_OBS_2.id,
    });
    mockTransaction.mockImplementation(
      (fn: (p: typeof mockPrisma) => unknown) => fn(mockPrisma),
    );
    vi.resetModules();
  });

  // ADR-0006 — task-completion observations route through
  // `createObservation`, which enforces the registry allowlist and the
  // #321 camp_condition required-field guard.
  //
  // Issue #360 — rainfall_reading, camp_inspection, and camp_move are
  // reminder-only task types: `observationFromTaskCompletion` maps them
  // to null, so completing one of those tasks updates status to
  // "completed" with `observationCreated: false` and writes no
  // Observation row. The scenarios below cover the flows that DO
  // produce a valid door input; the reminder-only contract is pinned in
  // the section that follows.
  const taskTypeScenarios = [
    {
      taskType: "pregnancy_scan",
      payload: { result: "positive" },
      expectedObsType: "pregnancy_scan",
      expectedDetailsFragment: "positive",
    },
    {
      taskType: "vaccination",
      payload: { product: "Lumpy Skin vax", dose: "2ml" },
      expectedObsType: "treatment",
      expectedDetailsFragment: "Lumpy Skin vax",
    },
  ];

  for (const scenario of taskTypeScenarios) {
    it(`taskType=${scenario.taskType} → obs.type=${scenario.expectedObsType}`, async () => {
      mockTaskFindUnique.mockResolvedValueOnce({
        ...BASE_TASK,
        taskType: scenario.taskType,
      });

      const { PATCH } = await import("@/app/api/tasks/[id]/route");
      const req = makeReq("http://localhost/api/tasks/task-weighing-1", {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          completionPayload: scenario.payload,
        }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "task-weighing-1" }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.observationCreated).toBe(true);

      expect(mockObservationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: scenario.expectedObsType,
            details: expect.stringContaining(scenario.expectedDetailsFragment),
          }),
        }),
      );

      // Clean up call count for next iteration
      mockObservationCreate.mockClear();
      mockTaskUpdate.mockClear();
      mockTransaction.mockClear();
    });
  }

  // ── Reminder-only task types (issue #360) ──────────────────────────
  // rainfall_reading / camp_inspection / camp_move are reminder-only:
  // `observationFromTaskCompletion` returns null, so the task completes
  // 200 with observationCreated=false and no Observation row is written.
  // Pre-#360 these emitted door-invalid payloads (off-registry
  // `rainfall` / `camp_move`; `camp_condition` missing the #321
  // grazing/water/fence keys) and surfaced as 422 — observation-mapping.ts
  // is now structurally incapable of producing a door-rejection.
  it("taskType=rainfall_reading → 200, no observation (reminder-only)", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      ...BASE_TASK,
      taskType: "rainfall_reading",
    });

    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-weighing-1", {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        completionPayload: { rainfallMm: 12 },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "task-weighing-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.observationCreated).toBe(false);
    expect(mockObservationCreate).not.toHaveBeenCalled();
  });

  it("taskType=camp_inspection → 200, no observation (reminder-only)", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      ...BASE_TASK,
      taskType: "camp_inspection",
    });

    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-weighing-1", {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        completionPayload: { condition: "good" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "task-weighing-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.observationCreated).toBe(false);
    expect(mockObservationCreate).not.toHaveBeenCalled();
  });

  it("taskType=camp_move → 200, no observation (reminder-only)", async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      ...BASE_TASK,
      taskType: "camp_move",
    });

    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = makeReq("http://localhost/api/tasks/task-weighing-1", {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        completionPayload: { toCampId: "camp-B" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "task-weighing-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.observationCreated).toBe(false);
    expect(mockObservationCreate).not.toHaveBeenCalled();
  });
});
