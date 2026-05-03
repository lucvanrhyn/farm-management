/**
 * Tests for app/api/task-templates/[id]/route.ts (DELETE + PATCH)
 * and app/api/farm-settings/tasks/route.ts (GET + PUT)
 *
 * Mock strategy mirrors __tests__/api/tasks.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Session mock ────────────────────────────────────────────────────────────
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
// unit tests. For handlers under test we trust the mocked ADMIN session.
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...actual, verifyFreshAdminRole: vi.fn().mockResolvedValue(true) };
});

// ── Prisma mock ─────────────────────────────────────────────────────────────
const mockTemplateFindFirst = vi.fn();
const mockTemplateDelete = vi.fn();
const mockTemplateUpdate = vi.fn();
const mockFarmSettingsFindFirst = vi.fn();
const mockFarmSettingsUpsert = vi.fn();

const mockPrisma = {
  taskTemplate: {
    findFirst: mockTemplateFindFirst,
    delete: mockTemplateDelete,
    update: mockTemplateUpdate,
  },
  farmSettings: {
    findFirst: mockFarmSettingsFindFirst,
    upsert: mockFarmSettingsUpsert,
  },
};

const ADMIN_SESSION = {
  user: {
    id: "admin-1",
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

  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

// Stub next/cache so revalidateTag calls don't blow up outside a Next.js runtime
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: vi.fn().mockImplementation((fn: (...args: unknown[]) => unknown) => fn),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(url: string, options?: Record<string, any>): NextRequest {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(url, options as any);
}

const TEMPLATE_ROW = {
  id: "tmpl-1",
  tenantSlug: "test-farm",
  name: "Dip day",
  name_af: "Dipdag",
  taskType: "dipping",
  description: null,
  description_af: null,
  priorityDefault: "medium",
  recurrenceRule: null,
  reminderOffset: 1440,
  species: null,
  isPublic: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ────────────────────────────────────────────────────────────────────────────
// DELETE /api/task-templates/[id]
// ────────────────────────────────────────────────────────────────────────────
describe("DELETE /api/task-templates/[id]", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockTemplateFindFirst.mockResolvedValue(TEMPLATE_ROW);
    mockTemplateDelete.mockResolvedValue(TEMPLATE_ROW);
  });

  it("returns 200 and success=true for ADMIN on existing template", async () => {
    const { DELETE } = await import("@/app/api/task-templates/[id]/route");
    const req = makeReq("http://localhost/api/task-templates/tmpl-1", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "tmpl-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deleted).toBe("tmpl-1");
    expect(mockTemplateDelete).toHaveBeenCalledWith({ where: { id: "tmpl-1" } });
  });

  it("returns 401 with MISSING_ADMIN_SESSION when unauthed", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const { DELETE } = await import("@/app/api/task-templates/[id]/route");
    const req = makeReq("http://localhost/api/task-templates/tmpl-1", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "tmpl-1" }) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("MISSING_ADMIN_SESSION");
  });

  it("returns 403 with FORBIDDEN for non-admin", async () => {
    mockGetServerSession.mockResolvedValueOnce(FIELD_SESSION);
    const { DELETE } = await import("@/app/api/task-templates/[id]/route");
    const req = makeReq("http://localhost/api/task-templates/tmpl-1", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "tmpl-1" }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("FORBIDDEN");
  });

  it("returns 404 with TEMPLATE_NOT_FOUND when template doesn't exist", async () => {
    mockTemplateFindFirst.mockResolvedValueOnce(null);
    const { DELETE } = await import("@/app/api/task-templates/[id]/route");
    const req = makeReq("http://localhost/api/task-templates/missing", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("TEMPLATE_NOT_FOUND");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PATCH /api/task-templates/[id]
// ────────────────────────────────────────────────────────────────────────────
describe("PATCH /api/task-templates/[id]", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockTemplateFindFirst.mockResolvedValue(TEMPLATE_ROW);
    mockTemplateUpdate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...TEMPLATE_ROW, ...data }),
    );
  });

  it("updates only the provided fields", async () => {
    const { PATCH } = await import("@/app/api/task-templates/[id]/route");
    const req = makeReq("http://localhost/api/task-templates/tmpl-1", {
      method: "PATCH",
      body: JSON.stringify({ name: "New name" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "tmpl-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("New name");
    expect(mockTemplateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tmpl-1" },
        data: expect.objectContaining({ name: "New name" }),
      }),
    );
    // Unspecified fields must not be sent
    const callData = mockTemplateUpdate.mock.calls[0][0].data;
    expect(callData).not.toHaveProperty("taskType");
    expect(callData).not.toHaveProperty("reminderOffset");
  });

  it("accepts reminderOffset update (including null)", async () => {
    const { PATCH } = await import("@/app/api/task-templates/[id]/route");
    const req = makeReq("http://localhost/api/task-templates/tmpl-1", {
      method: "PATCH",
      body: JSON.stringify({ reminderOffset: null }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "tmpl-1" }) });
    expect(res.status).toBe(200);
    expect(mockTemplateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reminderOffset: null }),
      }),
    );
  });

  it("rejects invalid priorityDefault with INVALID_FIELD", async () => {
    const { PATCH } = await import("@/app/api/task-templates/[id]/route");
    const req = makeReq("http://localhost/api/task-templates/tmpl-1", {
      method: "PATCH",
      body: JSON.stringify({ priorityDefault: "urgent" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "tmpl-1" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_FIELD");
  });

  it("returns 401 MISSING_ADMIN_SESSION when unauthed", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const { PATCH } = await import("@/app/api/task-templates/[id]/route");
    const req = makeReq("http://localhost/api/task-templates/tmpl-1", {
      method: "PATCH",
      body: JSON.stringify({ name: "x" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "tmpl-1" }) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("MISSING_ADMIN_SESSION");
  });

  it("returns 404 TEMPLATE_NOT_FOUND when template doesn't exist", async () => {
    mockTemplateFindFirst.mockResolvedValueOnce(null);
    const { PATCH } = await import("@/app/api/task-templates/[id]/route");
    const req = makeReq("http://localhost/api/task-templates/missing", {
      method: "PATCH",
      body: JSON.stringify({ name: "x" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("TEMPLATE_NOT_FOUND");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PUT /api/farm-settings/tasks
// ────────────────────────────────────────────────────────────────────────────
describe("PUT /api/farm-settings/tasks", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockFarmSettingsUpsert.mockResolvedValue({ id: "singleton" });
  });

  it("saves valid settings and returns the persisted shape", async () => {
    const { PUT } = await import("@/app/api/farm-settings/tasks/route");
    const req = makeReq("http://localhost/api/farm-settings/tasks", {
      method: "PUT",
      body: JSON.stringify({
        defaultReminderOffset: 720,
        autoObservation: false,
        horizonDays: 60,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      defaultReminderOffset: 720,
      autoObservation: false,
      horizonDays: 60,
    });
    expect(mockFarmSettingsUpsert).toHaveBeenCalled();
  });

  it("rejects invalid horizonDays with INVALID_FIELD", async () => {
    const { PUT } = await import("@/app/api/farm-settings/tasks/route");
    const req = makeReq("http://localhost/api/farm-settings/tasks", {
      method: "PUT",
      body: JSON.stringify({
        defaultReminderOffset: 1440,
        autoObservation: true,
        horizonDays: 120,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_FIELD");
  });

  it("returns 403 FORBIDDEN for non-admin", async () => {
    mockGetServerSession.mockResolvedValueOnce(FIELD_SESSION);
    const { PUT } = await import("@/app/api/farm-settings/tasks/route");
    const req = makeReq("http://localhost/api/farm-settings/tasks", {
      method: "PUT",
      body: JSON.stringify({
        defaultReminderOffset: 1440,
        autoObservation: true,
        horizonDays: 30,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("FORBIDDEN");
  });
});
