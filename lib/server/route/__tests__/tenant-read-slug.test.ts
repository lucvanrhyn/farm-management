/**
 * @vitest-environment node
 *
 * Wave G1 (#165) — `tenantReadSlug` adapter tests.
 *
 * Mirrors `tenant-read.test.ts` but exercises the slug-aware resolver
 * (`getFarmContextForSlug(slug, req)`) and verifies the binary
 * passthrough invariant — the adapter must NOT wrap whatever Response
 * the handler returns. The PDF route under Wave G1 emits
 * `application/pdf`; an adapter that JSON-stringified would corrupt the
 * download.
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

import { tenantReadSlug } from "@/lib/server/route/tenant-read-slug";

function makeReq(url = "http://localhost/api/test/farm-a/nvd"): NextRequest {
  return new NextRequest(url);
}

const fakeCtx = {
  session: { user: { id: "u1", email: "u@x", role: "ADMIN" } },
  prisma: {} as never,
  slug: "farm-a",
  role: "ADMIN",
};

describe("tenantReadSlug adapter", () => {
  beforeEach(() => {
    hoisted.getFarmContextForSlug.mockReset();
    hoisted.mapApiDomainError.mockReset();
    hoisted.mapApiDomainError.mockReturnValue(null);
  });

  it("calls getFarmContextForSlug with the params.farmSlug + req", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(fakeCtx);
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = tenantReadSlug<{ farmSlug: string }>({ handle });
    const req = makeReq();

    await route(req, { params: Promise.resolve({ farmSlug: "farm-a" }) });

    expect(hoisted.getFarmContextForSlug).toHaveBeenCalledWith("farm-a", req);
  });

  it("returns 401 AUTH_REQUIRED when getFarmContextForSlug returns null", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(null);
    const handle = vi.fn();
    const route = tenantReadSlug<{ farmSlug: string }>({ handle });

    const res = await route(makeReq(), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "AUTH_REQUIRED",
      message: "Unauthorized",
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it("invokes handle with FarmContext + resolved params + req on success", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(fakeCtx);
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = tenantReadSlug<{ farmSlug: string; id: string }>({ handle });
    const req = makeReq();

    const res = await route(req, {
      params: Promise.resolve({ farmSlug: "farm-a", id: "abc" }),
    });

    expect(res.status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
    const args = handle.mock.calls[0];
    expect(args[0]).toBe(fakeCtx);
    expect(args[1]).toBe(req);
    expect(args[2]).toEqual({ farmSlug: "farm-a", id: "abc" });
  });

  it("passes the handler's Response through unchanged (binary PDF passthrough)", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(fakeCtx);
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const handle = vi.fn().mockResolvedValue(
      new Response(pdfBytes, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="NVD-2026-0001.pdf"',
        },
      }),
    );
    const route = tenantReadSlug<{ farmSlug: string; id: string }>({ handle });

    const res = await route(makeReq(), {
      params: Promise.resolve({ farmSlug: "farm-a", id: "x" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /attachment; filename="NVD-2026-0001.pdf"/,
    );
    const out = new Uint8Array(await res.arrayBuffer());
    expect(out).toEqual(pdfBytes);
  });

  it("returns 500 DB_QUERY_FAILED with message when handle throws", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(fakeCtx);
    const handle = vi
      .fn()
      .mockRejectedValueOnce(new Error("libsql_error: no such column"));
    const route = tenantReadSlug<{ farmSlug: string }>({ handle });

    const res = await route(makeReq(), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ error: "DB_QUERY_FAILED" });
    expect(body.message).toMatch(/no such column|libsql/i);
  });

  it("delegates to mapApiDomainError when it returns a response", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(fakeCtx);
    const domainResponse = NextResponse.json(
      { error: "NVD_NOT_FOUND" },
      { status: 404 },
    );
    hoisted.mapApiDomainError.mockReturnValueOnce(domainResponse);
    const handle = vi.fn().mockRejectedValueOnce(new Error("NvdNotFound"));
    const route = tenantReadSlug<{ farmSlug: string }>({ handle });

    const res = await route(makeReq(), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    expect(res).toBe(domainResponse);
    expect(res.status).toBe(404);
    expect(hoisted.mapApiDomainError).toHaveBeenCalledTimes(1);
  });

  it("attaches a Server-Timing header on success", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValueOnce(fakeCtx);
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = tenantReadSlug<{ farmSlug: string }>({ handle });

    const res = await route(makeReq(), {
      params: Promise.resolve({ farmSlug: "farm-a" }),
    });

    const header = res.headers.get("Server-Timing");
    expect(header).toBeTruthy();
    expect(header).toMatch(/total;dur=/);
  });
});
