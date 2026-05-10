/**
 * __tests__/sw/telemetry-bypass.test.ts
 *
 * Locks in the predicate that decides which `/api/*` URLs the service
 * worker must NOT intercept (production triage P2.2).
 *
 * Why this test exists
 * ────────────────────
 * The original SW shipped a single catch-all `/\/api\//i` matcher with a
 * NetworkOnly handler. That matched `/api/telemetry/vitals` and routed
 * the request through the SW — which aborted the request whenever the
 * page navigated, dropping every web-vitals beacon in production.
 *
 * The fix is in `app/sw.ts` (its `/api/*` matcher now uses
 * `isTelemetryRequest` to return false for telemetry URLs so no Serwist
 * route matches and `event.respondWith` is never called). These tests
 * lock that predicate down so a future "tidy the regex" change can't
 * silently re-introduce the abort bug.
 */

import { describe, it, expect } from "vitest";
import { isTelemetryRequest } from "@/lib/sw/telemetry-bypass";

describe("isTelemetryRequest", () => {
  // ── Telemetry URLs MUST bypass the SW ───────────────────────────────────────

  it("returns true for /api/telemetry/vitals", () => {
    expect(isTelemetryRequest("/api/telemetry/vitals")).toBe(true);
  });

  it("returns true for /api/telemetry/client-errors", () => {
    expect(isTelemetryRequest("/api/telemetry/client-errors")).toBe(true);
  });

  it("returns true for any future /api/telemetry/* endpoint", () => {
    expect(isTelemetryRequest("/api/telemetry/perf")).toBe(true);
    expect(isTelemetryRequest("/api/telemetry/foo/bar")).toBe(true);
  });

  // ── Non-telemetry /api/* MUST still go through the SW ───────────────────────

  it("returns false for non-telemetry /api/* routes", () => {
    expect(isTelemetryRequest("/api/camps")).toBe(false);
    expect(isTelemetryRequest("/api/farm")).toBe(false);
    expect(isTelemetryRequest("/api/auth/session")).toBe(false);
    expect(isTelemetryRequest("/api/observations")).toBe(false);
  });

  // ── Edge cases: don't match adjacent paths ──────────────────────────────────

  it("returns false for the bare /api/telemetry path (no trailing slash)", () => {
    // Defensive: a 404 against /api/telemetry should still cache-pass-through
    // like any other /api/* — the prefix only matches when there is an
    // endpoint path segment after `telemetry/`.
    expect(isTelemetryRequest("/api/telemetry")).toBe(false);
  });

  it("returns false for paths that merely contain the substring", () => {
    expect(isTelemetryRequest("/api/foo/telemetry/bar")).toBe(false);
    expect(isTelemetryRequest("/telemetry/vitals")).toBe(false);
  });

  it("returns false for the root and unrelated pages", () => {
    expect(isTelemetryRequest("/")).toBe(false);
    expect(isTelemetryRequest("/farms/test")).toBe(false);
  });
});
