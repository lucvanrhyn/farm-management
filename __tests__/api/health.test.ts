/**
 * @vitest-environment node
 *
 * __tests__/api/health.test.ts — Phase C bug C1
 *
 * Bug: GET /api/health was returning the full Next app shell (200 text/html).
 * Uptime monitors expecting JSON got a false-positive 200 with HTML, so an
 * outage that broke the route handler but still served the SPA shell would
 * not page anyone.
 *
 * Fix: dedicated route at app/api/health/route.ts that returns
 * { status, timestamp, version? } with `Content-Type: application/json`.
 *
 * This unit test covers the route handler in isolation. The middleware
 * (proxy.ts) matcher must also exclude /api/health so that an unauthenticated
 * uptime monitor never gets a 307 to /login — that exclusion is asserted in
 * __tests__/api/proxy-matcher.test.ts (KNOWN_PUBLIC_ROUTES).
 */

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/health/route";

// Wave H1 (#173) — health is now wrapped in `publicHandler`, so the export
// is `RouteHandler` shape (req, ctx) instead of the legacy bare `GET()`.
// These helpers keep the per-test intent unchanged while matching the new
// signature.
const REQ = () => new NextRequest("http://localhost/api/health");
const CTX = { params: Promise.resolve({}) };

describe("GET /api/health", () => {
  it("returns 200", async () => {
    const res = await GET(REQ(), CTX);
    expect(res.status).toBe(200);
  });

  it("returns Content-Type application/json", async () => {
    const res = await GET(REQ(), CTX);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  });

  it("returns { status: 'ok' }", async () => {
    const res = await GET(REQ(), CTX);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("returns an ISO 8601 timestamp", async () => {
    const res = await GET(REQ(), CTX);
    const body = await res.json();
    expect(typeof body.timestamp).toBe("string");
    // ISO 8601 e.g. 2026-04-26T13:45:00.000Z
    expect(body.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    );
    // Round-trip parse must equal the original string (rules out garbage)
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it("sets Cache-Control: no-store so monitors never see a cached OK", async () => {
    const res = await GET(REQ(), CTX);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("does not throw for repeated invocations (no shared mutable state)", async () => {
    const a = await GET(REQ(), CTX);
    const b = await GET(REQ(), CTX);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });
});
