/**
 * @vitest-environment node
 *
 * Wave G1 (#165) — `adminWriteSlug` adapter tests.
 *
 * Mirrors `admin-write.test.ts` but uses `getFarmContextForSlug`. Verifies
 * the AUTH_REQUIRED → FORBIDDEN-on-non-admin → FORBIDDEN-on-stale-admin →
 * INVALID_BODY → VALIDATION_FAILED → handle-throw → revalidate-on-2xx
 * path is identical.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const hoisted = vi.hoisted(() => ({
  getFarmContextForSlug: vi.fn(),
  verifyFreshAdminRole: vi.fn(),
  mapApiDomainError: vi.fn(),
}));

vi.mock("@/lib/server/farm-context-slug", () => ({
  getFarmContextForSlug: hoisted.getFarmContextForSlug,
}));

vi.mock("@/lib/auth", () => ({
  verifyFreshAdminRole: hoisted.verifyFreshAdminRole,
}));

vi.mock("@/lib/server/api-errors", () => ({
  mapApiDomainError: hoisted.mapApiDomainError,
}));

import { adminWriteSlug } from "@/lib/server/route/admin-write-slug";

const adminCtx = {
  session: { user: { id: "u1", email: "u@x", role: "ADMIN" } },
  prisma: {} as never,
  slug: "farm-a",
  role: "ADMIN",
};

const loggerCtx = {
  ...adminCtx,
  role: "LOGGER",
  session: { user: { id: "u2", email: "u2@x", role: "LOGGER" } },
};

function makeReq(body: unknown = {}, method = "POST"): NextRequest {
  return new NextRequest("http://localhost/api/farm-a/nvd", {
    method,
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  hoisted.getFarmContextForSlug.mockReset();
  hoisted.verifyFreshAdminRole.mockReset();
  hoisted.verifyFreshAdminRole.mockResolvedValue(true);
  hoisted.mapApiDomainError.mockReset();
  hoisted.mapApiDomainError.mockReturnValue(null);
});

describe("adminWriteSlug — auth + role gates", () => {
  it("returns 401 AUTH_REQUIRED when getFarmContextForSlug returns null", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(null);
    const handle = vi.fn();
    const route = adminWriteSlug({ handle });

    const res = await route(makeReq({}), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "AUTH_REQUIRED" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("returns 403 FORBIDDEN when role is not ADMIN", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(loggerCtx);
    const handle = vi.fn();
    const route = adminWriteSlug({ handle });

    const res = await route(makeReq({}), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "FORBIDDEN" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("returns 403 FORBIDDEN when verifyFreshAdminRole returns false (stale admin)", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(adminCtx);
    hoisted.verifyFreshAdminRole.mockResolvedValueOnce(false);
    const handle = vi.fn();
    const route = adminWriteSlug({ handle });

    const res = await route(makeReq({}), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "FORBIDDEN" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("calls verifyFreshAdminRole with (userId, slug) from the resolved context", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(adminCtx);
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = adminWriteSlug({ handle });

    await route(makeReq({}), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(hoisted.verifyFreshAdminRole).toHaveBeenCalledWith("u1", "farm-a");
  });

  it("calls getFarmContextForSlug with params.farmSlug + req", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(adminCtx);
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = adminWriteSlug({ handle });
    const req = makeReq({});

    await route(req, { params: Promise.resolve({ farmSlug: "farm-a" }) });

    expect(hoisted.getFarmContextForSlug).toHaveBeenCalledWith("farm-a", req);
  });
});

describe("adminWriteSlug — body parse + handle", () => {
  it("returns 400 INVALID_BODY on bad JSON", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(adminCtx);
    const handle = vi.fn();
    const route = adminWriteSlug({ handle });

    const req = new NextRequest("http://localhost/api/farm-a/nvd", {
      method: "POST",
      body: "{nope",
      headers: { "content-type": "application/json" },
    });
    const res = await route(req, {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "INVALID_BODY" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("calls revalidate(slug) on 2xx response", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(adminCtx);
    const revalidate = vi.fn();
    const handle = vi
      .fn()
      .mockResolvedValue(NextResponse.json({ ok: true }, { status: 201 }));
    const route = adminWriteSlug({ revalidate, handle });

    await route(makeReq({}), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(revalidate).toHaveBeenCalledWith("farm-a");
  });

  it("does NOT call revalidate when handle returns 4xx", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(adminCtx);
    const revalidate = vi.fn();
    const handle = vi
      .fn()
      .mockResolvedValue(NextResponse.json({ error: "nope" }, { status: 409 }));
    const route = adminWriteSlug({ revalidate, handle });

    await route(makeReq({}), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(revalidate).not.toHaveBeenCalled();
  });

  it("delegates to mapApiDomainError when it returns a response", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(adminCtx);
    const domain = NextResponse.json(
      { error: "NVD_NOT_FOUND" },
      { status: 404 },
    );
    hoisted.mapApiDomainError.mockReturnValueOnce(domain);
    const handle = vi.fn().mockRejectedValueOnce(new Error("NvdNotFound"));
    const route = adminWriteSlug({ handle });

    const res = await route(makeReq({}), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(res).toBe(domain);
  });

  it("attaches Server-Timing header on success", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(adminCtx);
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = adminWriteSlug({ handle });

    const res = await route(makeReq({}), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(res.headers.get("Server-Timing")).toMatch(/total;dur=/);
  });
});
