/**
 * @vitest-environment node
 *
 * Wave A — tenant-read adapter tests.
 *
 * Covers:
 *   (a) `getFarmContext` returns null → 401 envelope
 *   (b) success → handler invoked with ctx + resolved params
 *   (c) handler throws → 500 DB_QUERY_FAILED envelope (with message)
 *   (d) handler throws a domain error → mapApiDomainError wins
 *   (e) Server-Timing header present on the response
 *
 * Per `feedback-vi-hoisted-shared-mocks.md`, shared mock state is wrapped
 * in `vi.hoisted()` so factory references stay outside the TDZ.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const hoisted = vi.hoisted(() => {
  return {
    getFarmContext: vi.fn(),
    mapApiDomainError: vi.fn(),
  };
});

vi.mock("@/lib/server/farm-context", () => ({
  getFarmContext: hoisted.getFarmContext,
}));

vi.mock("@/lib/server/api-errors", () => ({
  mapApiDomainError: hoisted.mapApiDomainError,
}));

import { tenantRead } from "@/lib/server/route/tenant-read";

function makeReq(url = "http://localhost/api/test"): NextRequest {
  return new NextRequest(url);
}

const fakeCtx = {
  session: { user: { id: "u1", email: "u@x", role: "ADMIN" } },
  prisma: {} as never,
  slug: "test-farm",
  role: "ADMIN",
};

describe("tenantRead adapter", () => {
  beforeEach(() => {
    hoisted.getFarmContext.mockReset();
    hoisted.mapApiDomainError.mockReset();
    hoisted.mapApiDomainError.mockReturnValue(null);
  });

  it("returns 401 AUTH_REQUIRED envelope when getFarmContext returns null", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(null);
    const handle = vi.fn();
    const route = tenantRead({ handle });

    const res = await route(makeReq(), { params: Promise.resolve({}) });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "AUTH_REQUIRED",
      message: "Unauthorized",
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it("invokes handle with FarmContext + resolved params + req on success", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(fakeCtx);
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = tenantRead<{ id: string }>({ handle });
    const req = makeReq();

    const res = await route(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
    const args = handle.mock.calls[0];
    expect(args[0]).toBe(fakeCtx);
    expect(args[1]).toBe(req);
    expect(args[2]).toEqual({ id: "abc" });
  });

  it("returns 500 DB_QUERY_FAILED envelope with message when handle throws", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(fakeCtx);
    const handle = vi
      .fn()
      .mockRejectedValueOnce(new Error("libsql_error: no such column"));
    const route = tenantRead({ handle });

    const res = await route(makeReq(), { params: Promise.resolve({}) });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ error: "DB_QUERY_FAILED" });
    expect(body.message).toMatch(/no such column|libsql/i);
  });

  it("delegates to mapApiDomainError when it returns a response", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(fakeCtx);
    const domainResponse = NextResponse.json({ error: "Mob not found" }, { status: 404 });
    hoisted.mapApiDomainError.mockReturnValueOnce(domainResponse);
    const handle = vi.fn().mockRejectedValueOnce(new Error("MobNotFoundError"));
    const route = tenantRead({ handle });

    const res = await route(makeReq(), { params: Promise.resolve({}) });

    expect(res).toBe(domainResponse);
    expect(res.status).toBe(404);
    expect(hoisted.mapApiDomainError).toHaveBeenCalledTimes(1);
  });

  it("attaches a Server-Timing header on success", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(fakeCtx);
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = tenantRead({ handle });

    const res = await route(makeReq(), { params: Promise.resolve({}) });

    const header = res.headers.get("Server-Timing");
    expect(header).toBeTruthy();
    expect(header).toMatch(/total;dur=/);
  });

  it("attaches a Server-Timing header even on error envelope responses", async () => {
    hoisted.getFarmContext.mockResolvedValueOnce(null);
    const handle = vi.fn();
    const route = tenantRead({ handle });

    const res = await route(makeReq(), { params: Promise.resolve({}) });

    expect(res.status).toBe(401);
    expect(res.headers.get("Server-Timing")).toMatch(/total;dur=/);
  });
});
