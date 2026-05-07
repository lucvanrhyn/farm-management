/**
 * @vitest-environment node
 *
 * Wave A — tenant-write adapter tests.
 *
 * Same contract as admin-write minus the role/fresh-admin gates. Used by
 * routes where any authenticated farm role (LOGGER / VIEWER / ADMIN) may
 * invoke the write — observations, animal POST (calf creation), etc.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const hoisted = vi.hoisted(() => ({
  getFarmContext: vi.fn(),
  mapApiDomainError: vi.fn(),
}));

vi.mock("@/lib/server/farm-context", () => ({
  getFarmContext: hoisted.getFarmContext,
}));

vi.mock("@/lib/server/api-errors", () => ({
  mapApiDomainError: hoisted.mapApiDomainError,
}));

import { tenantWrite } from "@/lib/server/route/tenant-write";

const loggerCtx = {
  session: { user: { id: "u1", email: "u@x", role: "LOGGER" } },
  prisma: {} as never,
  slug: "test-farm",
  role: "LOGGER",
};

function makeReq(body: unknown = {}): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  hoisted.getFarmContext.mockReset();
  hoisted.mapApiDomainError.mockReset();
  hoisted.mapApiDomainError.mockReturnValue(null);
});

describe("tenantWrite — auth", () => {
  it("returns 401 AUTH_REQUIRED when getFarmContext returns null", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(null);
    const handle = vi.fn();
    const route = tenantWrite({ handle });

    const res = await route(makeReq(), { params: Promise.resolve({}) });

    expect(res.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });

  it("admits LOGGER role (no role gate)", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(loggerCtx);
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = tenantWrite({ handle });

    const res = await route(makeReq(), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
  });
});

describe("tenantWrite — body parse and revalidate", () => {
  it("returns 400 INVALID_BODY when no body is provided", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(loggerCtx);
    const handle = vi.fn();
    const route = tenantWrite({ handle });

    const res = await route(
      new NextRequest("http://localhost/api/test", { method: "POST" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "INVALID_BODY" });
  });

  it("returns 400 VALIDATION_FAILED when schema.parse throws", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(loggerCtx);
    const handle = vi.fn();
    const schema = { parse: () => { throw new Error("bad"); } };
    const route = tenantWrite({ schema, handle });

    const res = await route(makeReq(), { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "VALIDATION_FAILED", message: "bad" });
  });

  it("calls revalidate(slug) on a 2xx", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(loggerCtx);
    const revalidate = vi.fn();
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }, { status: 201 }));
    const route = tenantWrite({ revalidate, handle });

    await route(makeReq(), { params: Promise.resolve({}) });

    expect(revalidate).toHaveBeenCalledWith("test-farm");
  });

  it("does NOT call revalidate on a 4xx", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(loggerCtx);
    const revalidate = vi.fn();
    const handle = vi
      .fn()
      .mockResolvedValue(NextResponse.json({ error: "nope" }, { status: 400 }));
    const route = tenantWrite({ revalidate, handle });

    await route(makeReq(), { params: Promise.resolve({}) });

    expect(revalidate).not.toHaveBeenCalled();
  });
});

describe("tenantWrite — error path", () => {
  it("returns 500 DB_QUERY_FAILED when handle throws an unmapped error", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(loggerCtx);
    const handle = vi.fn().mockRejectedValueOnce(new Error("boom"));
    const route = tenantWrite({ handle });

    const res = await route(makeReq(), { params: Promise.resolve({}) });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "DB_QUERY_FAILED", message: "boom" });
  });

  it("delegates to mapApiDomainError when it returns a response", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(loggerCtx);
    const domain = NextResponse.json({ error: "Mob not found" }, { status: 404 });
    hoisted.mapApiDomainError.mockReturnValueOnce(domain);
    const handle = vi.fn().mockRejectedValueOnce(new Error("MobNotFound"));
    const route = tenantWrite({ handle });

    const res = await route(makeReq(), { params: Promise.resolve({}) });

    expect(res).toBe(domain);
  });

  it("attaches Server-Timing header on success", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(loggerCtx);
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = tenantWrite({ handle });

    const res = await route(makeReq(), { params: Promise.resolve({}) });

    expect(res.headers.get("Server-Timing")).toMatch(/total;dur=/);
  });
});
