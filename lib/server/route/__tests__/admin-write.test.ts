/**
 * @vitest-environment node
 *
 * Wave A — admin-write adapter tests.
 *
 * Covers all six invariants ADR-0001 §"Invariants every adapter enforces":
 *   1. AUTH_REQUIRED on null FarmContext
 *   2. FORBIDDEN on non-ADMIN role  (and on stale-ADMIN per verifyFreshAdminRole)
 *   3. INVALID_BODY on missing/non-JSON body, VALIDATION_FAILED on schema fail
 *   4. mapApiDomainError first; DB_QUERY_FAILED fallback on throw
 *   5. revalidate fires only on 2xx
 *   6. Server-Timing attached
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const hoisted = vi.hoisted(() => ({
  getFarmContext: vi.fn(),
  verifyFreshAdminRole: vi.fn(),
  mapApiDomainError: vi.fn(),
}));

vi.mock("@/lib/server/farm-context", () => ({
  getFarmContext: hoisted.getFarmContext,
}));

vi.mock("@/lib/auth", () => ({
  verifyFreshAdminRole: hoisted.verifyFreshAdminRole,
}));

vi.mock("@/lib/server/api-errors", () => ({
  mapApiDomainError: hoisted.mapApiDomainError,
}));

import { adminWrite } from "@/lib/server/route/admin-write";
import { RouteValidationError } from "@/lib/server/route/types";

const adminCtx = {
  session: { user: { id: "u1", email: "u@x", role: "ADMIN" } },
  prisma: {} as never,
  slug: "test-farm",
  role: "ADMIN",
};

const loggerCtx = {
  ...adminCtx,
  role: "LOGGER",
  session: { user: { id: "u2", email: "u2@x", role: "LOGGER" } },
};

function makeReq(opts?: { body?: unknown; method?: string }): NextRequest {
  if (opts?.body !== undefined) {
    return new NextRequest("http://localhost/api/test", {
      method: opts.method ?? "POST",
      body: typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
      headers: { "content-type": "application/json" },
    });
  }
  return new NextRequest("http://localhost/api/test", {
    method: opts?.method ?? "POST",
  });
}

beforeEach(() => {
  hoisted.getFarmContext.mockReset();
  hoisted.verifyFreshAdminRole.mockReset();
  hoisted.verifyFreshAdminRole.mockResolvedValue(true);
  hoisted.mapApiDomainError.mockReset();
  hoisted.mapApiDomainError.mockReturnValue(null);
});

describe("adminWrite — auth + role gates", () => {
  it("returns 401 AUTH_REQUIRED when getFarmContext returns null", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(null);
    const handle = vi.fn();
    const route = adminWrite({ handle });

    const res = await route(makeReq({ body: {} }), { params: Promise.resolve({}) });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "AUTH_REQUIRED" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("returns 403 FORBIDDEN when role is not ADMIN", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(loggerCtx);
    const handle = vi.fn();
    const route = adminWrite({ handle });

    const res = await route(makeReq({ body: {} }), { params: Promise.resolve({}) });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "FORBIDDEN" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("returns 403 FORBIDDEN on stale-ADMIN (verifyFreshAdminRole returns false)", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(adminCtx);
    hoisted.verifyFreshAdminRole.mockResolvedValueOnce(false);
    const handle = vi.fn();
    const route = adminWrite({ handle });

    const res = await route(makeReq({ body: {} }), { params: Promise.resolve({}) });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "FORBIDDEN" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("calls verifyFreshAdminRole with (userId, slug) from the resolved context", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(adminCtx);
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = adminWrite({ handle });

    await route(makeReq({ body: {} }), { params: Promise.resolve({}) });

    expect(hoisted.verifyFreshAdminRole).toHaveBeenCalledWith("u1", "test-farm");
  });
});

describe("adminWrite — body parse", () => {
  it("returns 400 INVALID_BODY when body is non-empty and not valid JSON", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(adminCtx);
    const handle = vi.fn();
    const route = adminWrite({
      schema: { parse: (x) => x },
      handle,
    });

    const req = new NextRequest("http://localhost/api/test", {
      method: "POST",
      body: "not json{",
      headers: { "content-type": "application/json" },
    });
    const res = await route(req, { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "INVALID_BODY" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("treats an empty body as `{}` so DELETE handlers (no body) are admitted", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(adminCtx);
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = adminWrite({ handle });

    const res = await route(
      new NextRequest("http://localhost/api/test", { method: "DELETE" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(handle.mock.calls[0][1]).toEqual({});
  });

  it("returns 400 VALIDATION_FAILED with details when schema.parse throws RouteValidationError", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(adminCtx);
    const handle = vi.fn();
    const schema = {
      parse: (input: unknown) => {
        const obj = input as { campId?: string };
        if (!obj?.campId) {
          throw new RouteValidationError("campId is required", {
            fieldErrors: { campId: "required" },
          });
        }
        return obj;
      },
    };
    const route = adminWrite({ schema, handle });

    const res = await route(makeReq({ body: {} }), { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "VALIDATION_FAILED",
      message: "campId is required",
      details: { fieldErrors: { campId: "required" } },
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it("treats any non-RouteValidationError throw from schema.parse as VALIDATION_FAILED with message", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(adminCtx);
    const handle = vi.fn();
    const schema = {
      parse: () => {
        throw new Error("Bad shape");
      },
    };
    const route = adminWrite({ schema, handle });

    const res = await route(makeReq({ body: {} }), { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "VALIDATION_FAILED",
      message: "Bad shape",
    });
  });

  it("forwards a parsed body to handle when schema validates", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(adminCtx);
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    type Body = { campId: string; normalised: boolean };
    const schema = {
      parse: (x: unknown) =>
        ({ ...(x as object), normalised: true }) as unknown as Body,
    };
    const route = adminWrite<Body>({ schema, handle });

    await route(makeReq({ body: { campId: "C1" } }), {
      params: Promise.resolve({}),
    });

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][1]).toEqual({ campId: "C1", normalised: true });
  });

  it("forwards raw body as unknown when no schema is provided", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(adminCtx);
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = adminWrite({ handle });

    await route(makeReq({ body: { foo: "bar" } }), {
      params: Promise.resolve({}),
    });

    expect(handle.mock.calls[0][1]).toEqual({ foo: "bar" });
  });
});

describe("adminWrite — handle errors + revalidate", () => {
  it("returns 500 DB_QUERY_FAILED when handle throws an unmapped error", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(adminCtx);
    const handle = vi.fn().mockRejectedValueOnce(new Error("kaboom"));
    const route = adminWrite({ handle });

    const res = await route(makeReq({ body: {} }), { params: Promise.resolve({}) });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: "DB_QUERY_FAILED",
      message: "kaboom",
    });
  });

  it("delegates to mapApiDomainError when it returns a response", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(adminCtx);
    const domain = NextResponse.json({ error: "Mob not found" }, { status: 404 });
    hoisted.mapApiDomainError.mockReturnValueOnce(domain);
    const handle = vi.fn().mockRejectedValueOnce(new Error("MobNotFound"));
    const route = adminWrite({ handle });

    const res = await route(makeReq({ body: {} }), { params: Promise.resolve({}) });

    expect(res).toBe(domain);
  });

  it("calls revalidate(slug) on a 2xx response", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(adminCtx);
    const revalidate = vi.fn();
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }, { status: 201 }));
    const route = adminWrite({ revalidate, handle });

    await route(makeReq({ body: {} }), { params: Promise.resolve({}) });

    expect(revalidate).toHaveBeenCalledWith("test-farm");
  });

  it("does NOT call revalidate when handle returns a 4xx response", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(adminCtx);
    const revalidate = vi.fn();
    const handle = vi
      .fn()
      .mockResolvedValue(NextResponse.json({ error: "nope" }, { status: 409 }));
    const route = adminWrite({ revalidate, handle });

    await route(makeReq({ body: {} }), { params: Promise.resolve({}) });

    expect(revalidate).not.toHaveBeenCalled();
  });

  it("does NOT call revalidate when handle throws", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(adminCtx);
    const revalidate = vi.fn();
    const handle = vi.fn().mockRejectedValueOnce(new Error("boom"));
    const route = adminWrite({ revalidate, handle });

    await route(makeReq({ body: {} }), { params: Promise.resolve({}) });

    expect(revalidate).not.toHaveBeenCalled();
  });

  it("invokes every revalidate hook when given an array", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(adminCtx);
    const a = vi.fn();
    const b = vi.fn();
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = adminWrite({ revalidate: [a, b], handle });

    await route(makeReq({ body: {} }), { params: Promise.resolve({}) });

    expect(a).toHaveBeenCalledWith("test-farm");
    expect(b).toHaveBeenCalledWith("test-farm");
  });

  it("attaches Server-Timing header on success", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(adminCtx);
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = adminWrite({ handle });

    const res = await route(makeReq({ body: {} }), { params: Promise.resolve({}) });

    expect(res.headers.get("Server-Timing")).toMatch(/total;dur=/);
  });
});
