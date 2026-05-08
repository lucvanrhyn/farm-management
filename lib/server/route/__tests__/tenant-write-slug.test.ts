/**
 * @vitest-environment node
 *
 * Wave G1 (#165) — `tenantWriteSlug` adapter tests.
 *
 * Mirrors `tenant-write.test.ts` but uses `getFarmContextForSlug`. Verifies
 * the AUTH_REQUIRED → INVALID_BODY → VALIDATION_FAILED → handle-throw →
 * revalidate-on-2xx path is identical.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const hoisted = vi.hoisted(() => ({
  getFarmContextForSlug: vi.fn(),
  mapApiDomainError: vi.fn(),
}));

vi.mock("@/lib/server/farm-context-slug", () => ({
  getFarmContextForSlug: hoisted.getFarmContextForSlug,
}));

vi.mock("@/lib/server/api-errors", () => ({
  mapApiDomainError: hoisted.mapApiDomainError,
}));

import { tenantWriteSlug } from "@/lib/server/route/tenant-write-slug";
import { RouteValidationError } from "@/lib/server/route/types";

const loggerCtx = {
  session: { user: { id: "u1", email: "u@x", role: "LOGGER" } },
  prisma: {} as never,
  slug: "farm-a",
  role: "LOGGER",
};

function makeReq(body: unknown = {}, method = "POST"): NextRequest {
  return new NextRequest("http://localhost/api/farm-a/nvd/validate", {
    method,
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  hoisted.getFarmContextForSlug.mockReset();
  hoisted.mapApiDomainError.mockReset();
  hoisted.mapApiDomainError.mockReturnValue(null);
});

describe("tenantWriteSlug — auth", () => {
  it("returns 401 AUTH_REQUIRED when getFarmContextForSlug returns null", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(null);
    const handle = vi.fn();
    const route = tenantWriteSlug({ handle });

    const res = await route(makeReq({}), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "AUTH_REQUIRED" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("calls getFarmContextForSlug with params.farmSlug + req", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(loggerCtx);
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = tenantWriteSlug({ handle });
    const req = makeReq({});

    await route(req, { params: Promise.resolve({ farmSlug: "farm-a" }) });

    expect(hoisted.getFarmContextForSlug).toHaveBeenCalledWith("farm-a", req);
  });
});

describe("tenantWriteSlug — body parse + validation", () => {
  it("returns 400 INVALID_BODY when body is not valid JSON", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(loggerCtx);
    const handle = vi.fn();
    const route = tenantWriteSlug({ handle });

    const req = new NextRequest("http://localhost/api/farm-a/nvd/validate", {
      method: "POST",
      body: "not json{",
      headers: { "content-type": "application/json" },
    });
    const res = await route(req, {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "INVALID_BODY" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_FAILED with details when schema throws RouteValidationError", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(loggerCtx);
    const handle = vi.fn();
    const schema = {
      parse: () => {
        throw new RouteValidationError("animalIds is required", {
          fieldErrors: { animalIds: "required" },
        });
      },
    };
    const route = tenantWriteSlug({ schema, handle });

    const res = await route(makeReq({}), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "VALIDATION_FAILED",
      message: "animalIds is required",
      details: { fieldErrors: { animalIds: "required" } },
    });
    expect(handle).not.toHaveBeenCalled();
  });
});

describe("tenantWriteSlug — handle errors + revalidate", () => {
  it("returns 500 DB_QUERY_FAILED when handle throws unmapped error", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(loggerCtx);
    const handle = vi.fn().mockRejectedValueOnce(new Error("kaboom"));
    const route = tenantWriteSlug({ handle });

    const res = await route(makeReq({}), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: "DB_QUERY_FAILED",
      message: "kaboom",
    });
  });

  it("calls revalidate(slug) on 2xx response", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(loggerCtx);
    const revalidate = vi.fn();
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = tenantWriteSlug({ revalidate, handle });

    await route(makeReq({}), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(revalidate).toHaveBeenCalledWith("farm-a");
  });

  it("does NOT call revalidate when handle returns 4xx", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(loggerCtx);
    const revalidate = vi.fn();
    const handle = vi
      .fn()
      .mockResolvedValue(NextResponse.json({ error: "nope" }, { status: 409 }));
    const route = tenantWriteSlug({ revalidate, handle });

    await route(makeReq({}), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(revalidate).not.toHaveBeenCalled();
  });

  it("attaches Server-Timing header on success", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(loggerCtx);
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = tenantWriteSlug({ handle });

    const res = await route(makeReq({}), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(res.headers.get("Server-Timing")).toMatch(/total;dur=/);
  });
});
