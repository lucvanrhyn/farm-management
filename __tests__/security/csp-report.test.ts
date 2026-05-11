/**
 * @vitest-environment node
 *
 * Wave 4 A8 — CSP report sink.
 *
 * The 2026-05-11 enforce flip depends on 2 weeks of report-only telemetry.
 * Before this change the CSP had no `report-uri` / `report-to` directive
 * and we were collecting nothing — the flip would have been a guess.
 *
 * These tests pin three things:
 *
 *   1. `buildCsp()` carries both legacy `report-uri` and modern
 *      `report-to csp-endpoint` so every browser since Chrome 25 has a
 *      destination.
 *   2. `buildSecurityHeaders()` ships a `Reporting-Endpoints` header
 *      naming `csp-endpoint` → `/api/csp-report` (the Reporting API v1
 *      replacement for the deprecated `Report-To` header).
 *   3. The `/api/csp-report` route accepts both legacy
 *      `application/csp-report` objects and modern `application/reports+json`
 *      arrays, logs each violation under `[csp-violation]`, and always
 *      returns 204 (browsers can't retry usefully — no point surfacing 4xx).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { buildCsp, buildSecurityHeaders } from "@/lib/security/csp";

// Wave H1 (#173) — POST is now wrapped in `publicHandler`, so its signature
// is `(req, ctx)`. The adapter tolerates an empty params context (no dynamic
// segments) — every test below passes this `CTX` to satisfy the type.
const CTX = { params: Promise.resolve({}) };

// ── Logger spy — set up before the route module is imported ──────────────
// Per `feedback-vi-hoisted-shared-mocks.md`: when a vi.mock factory needs
// to reference shared mock state, that state must be created inside
// `vi.hoisted()` so it lands before the factory body runs (otherwise
// top-level consts hit TDZ when the factory invokes them).
const mocks = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({ logger: mocks.logger }));

describe("buildCsp — report sink directives", () => {
  const csp = buildCsp();
  const directives = new Map<string, string[]>(
    csp
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...sources] = d.split(/\s+/);
        return [name, sources];
      }),
  );

  it("emits report-uri pointing at /api/csp-report (legacy, universal support)", () => {
    expect(directives.get("report-uri")).toEqual(["/api/csp-report"]);
  });

  it("emits report-to csp-endpoint (modern, Reporting API v1)", () => {
    expect(directives.get("report-to")).toEqual(["csp-endpoint"]);
  });
});

describe("buildSecurityHeaders — Reporting-Endpoints", () => {
  const headers = buildSecurityHeaders();
  const map = new Map(headers.map((h) => [h.key, h.value]));

  it("emits Reporting-Endpoints binding csp-endpoint to /api/csp-report", () => {
    // Reporting API v1 syntax — structured-fields dictionary.
    // Spec: https://www.w3.org/TR/reporting-1/#header
    expect(map.get("Reporting-Endpoints")).toBe(
      'csp-endpoint="/api/csp-report"',
    );
  });

  it("keeps the prior six security headers (defense-in-depth contract)", () => {
    // Wave CSP-Enforce (2026-05-11): `Content-Security-Policy-Report-Only`
    // → `Content-Security-Policy` after a clean 2-week soak.
    for (const key of [
      "Strict-Transport-Security",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Content-Security-Policy",
    ]) {
      expect(map.has(key)).toBe(true);
    }
  });
});

describe("POST /api/csp-report", () => {
  const loggerMock = mocks.logger;

  beforeEach(() => {
    // Clear call history but keep the same vi.fn() instances so the route
    // module's cached import points at the same spies the tests assert on.
    loggerMock.debug.mockClear();
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeRequest(body: unknown, contentType: string): NextRequest {
    return new NextRequest("http://localhost/api/csp-report", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  // Sample shape per CSP3 §5.3 (Violation Reports).
  // https://www.w3.org/TR/CSP3/#deprecated-serialize-violation
  const legacyBody = {
    "csp-report": {
      "document-uri": "https://farm-management-lilac.vercel.app/dashboard",
      referrer: "",
      "violated-directive": "script-src-elem",
      "effective-directive": "script-src-elem",
      "original-policy": "default-src 'self'; report-uri /api/csp-report",
      "blocked-uri": "https://evil.example.com/inject.js",
      "status-code": 200,
      "source-file": "https://farm-management-lilac.vercel.app/dashboard",
      "line-number": 12,
      "column-number": 1,
    },
  };

  // Sample shape per Reporting API v1 §6.4.
  // https://www.w3.org/TR/reporting-1/#serialize-reports
  const modernBody = [
    {
      type: "csp-violation",
      age: 0,
      url: "https://farm-management-lilac.vercel.app/dashboard",
      user_agent: "Mozilla/5.0",
      body: {
        documentURL: "https://farm-management-lilac.vercel.app/dashboard",
        referrer: "",
        blockedURL: "https://evil.example.com/inject.js",
        effectiveDirective: "script-src-elem",
        originalPolicy: "default-src 'self'; report-to csp-endpoint",
        sourceFile: "https://farm-management-lilac.vercel.app/dashboard",
        sample: "",
        disposition: "report",
        statusCode: 200,
        lineNumber: 12,
        columnNumber: 1,
      },
    },
  ];

  it("returns 204 No Content for a legacy application/csp-report POST", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const req = makeRequest(legacyBody, "application/csp-report");
    const res = await POST(req, CTX);
    expect(res.status).toBe(204);
  });

  it("logs the legacy violation under [csp-violation] with the directive + blocked URI", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const req = makeRequest(legacyBody, "application/csp-report");
    await POST(req, CTX);

    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    const [tag, fields] = loggerMock.warn.mock.calls[0];
    expect(tag).toBe("[csp-violation]");
    expect(fields).toMatchObject({
      violatedDirective: "script-src-elem",
      blockedUri: "https://evil.example.com/inject.js",
      documentUri: "https://farm-management-lilac.vercel.app/dashboard",
    });
  });

  it("returns 204 for a modern application/reports+json POST", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const req = makeRequest(modernBody, "application/reports+json");
    const res = await POST(req, CTX);
    expect(res.status).toBe(204);
  });

  it("logs each violation in a modern reports+json batch", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const batch = [...modernBody, ...modernBody]; // two reports in one POST
    const req = makeRequest(batch, "application/reports+json");
    await POST(req, CTX);

    expect(loggerMock.warn).toHaveBeenCalledTimes(2);
    const [tag, fields] = loggerMock.warn.mock.calls[0];
    expect(tag).toBe("[csp-violation]");
    expect(fields).toMatchObject({
      effectiveDirective: "script-src-elem",
      blockedUri: "https://evil.example.com/inject.js",
    });
  });

  it("ignores non-csp-violation report types in a modern batch", async () => {
    // The Reporting API multiplexes — a single POST may include
    // network-error, deprecation, intervention etc. We only care about CSP.
    const { POST } = await import("@/app/api/csp-report/route");
    const req = makeRequest(
      [
        {
          type: "network-error",
          age: 0,
          url: "https://farm-management-lilac.vercel.app/x",
          user_agent: "Mozilla/5.0",
          body: { phase: "connection", method: "GET", status_code: 0 },
        },
      ],
      "application/reports+json",
    );
    const res = await POST(req, CTX);
    expect(res.status).toBe(204);
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it("returns 204 even on malformed JSON (browsers cannot retry usefully)", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const req = makeRequest("{not json", "application/csp-report");
    const res = await POST(req, CTX);
    expect(res.status).toBe(204);
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it("returns 204 on an empty body", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const req = makeRequest("", "application/csp-report");
    const res = await POST(req, CTX);
    expect(res.status).toBe(204);
  });
});
