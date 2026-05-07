/**
 * @vitest-environment node
 *
 * Wave A — public-handler adapter tests.
 *
 * Used by routes outside the proxy.ts matcher (webhooks, telemetry beacon,
 * auth catch-all). No auth, no body parse — the adapter only owns
 * envelope-on-throw + Server-Timing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const hoisted = vi.hoisted(() => ({
  mapApiDomainError: vi.fn(),
}));

vi.mock("@/lib/server/api-errors", () => ({
  mapApiDomainError: hoisted.mapApiDomainError,
}));

import { publicHandler } from "@/lib/server/route/public-handler";

beforeEach(() => {
  hoisted.mapApiDomainError.mockReset();
  hoisted.mapApiDomainError.mockReturnValue(null);
});

describe("publicHandler — envelope on throw only", () => {
  it("invokes handle without auth", async () => {
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = publicHandler({ handle });

    const res = await route(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("returns 500 DB_QUERY_FAILED when handle throws", async () => {
    const handle = vi.fn().mockRejectedValueOnce(new Error("oops"));
    const route = publicHandler({ handle });

    const res = await route(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: "DB_QUERY_FAILED",
      message: "oops",
    });
  });

  it("delegates to mapApiDomainError when it returns a response", async () => {
    const domain = NextResponse.json({ error: "Mob not found" }, { status: 404 });
    hoisted.mapApiDomainError.mockReturnValueOnce(domain);
    const handle = vi.fn().mockRejectedValueOnce(new Error("MobNotFound"));
    const route = publicHandler({ handle });

    const res = await route(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({}),
    });

    expect(res).toBe(domain);
  });

  it("forwards resolved params to handle", async () => {
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = publicHandler<{ slug: string }>({ handle });
    const req = new NextRequest("http://localhost/x");

    await route(req, { params: Promise.resolve({ slug: "alpha" }) });

    expect(handle).toHaveBeenCalledWith(req, { slug: "alpha" });
  });

  it("attaches Server-Timing header on success", async () => {
    const handle = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const route = publicHandler({ handle });

    const res = await route(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({}),
    });

    expect(res.headers.get("Server-Timing")).toMatch(/total;dur=/);
  });
});
