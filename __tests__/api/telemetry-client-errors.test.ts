/**
 * __tests__/api/telemetry-client-errors.test.ts
 *
 * TDD — RED phase. Written BEFORE the production route exists.
 * Expected failure: "Cannot find module '@/app/api/telemetry/client-errors/route'"
 *
 * Contract under test:
 *   POST /api/telemetry/client-errors
 *   - 202 on valid payload
 *   - 400 on malformed payload (missing level, invalid level, missing message)
 *   - Forwards validated payload to server logger
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Wave H1 (#173) — POST is now wrapped in `publicHandler`, so its signature
// is `(req, ctx)`. The adapter tolerates an empty params context (no dynamic
// segments) — every test below passes this `CTX` to satisfy the type.
const CTX = { params: Promise.resolve({}) };

// ── Logger spy — must be set up before the route module is imported ───────────
// We spy on the server logger to verify the route forwards client errors to it.
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("POST /api/telemetry/client-errors", () => {
  let loggerMock: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    // Fresh import each test so mocks reset cleanly
    vi.resetModules();
    const { logger } = await import("@/lib/logger");
    loggerMock = logger as typeof loggerMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeRequest(body: unknown): NextRequest {
    return new NextRequest("http://localhost/api/telemetry/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // ── 202 happy path ────────────────────────────────────────────────────────

  it("returns 202 for a valid warn payload", async () => {
    const { POST } = await import(
      "@/app/api/telemetry/client-errors/route"
    );

    const req = makeRequest({
      level: "warn",
      message: "[onboarding] boundary caught",
      payload: { component: "ErrorBoundary" },
      ts: Date.now(),
      url: "https://farmtrack.app/farm/test/onboarding",
      userAgent: "Mozilla/5.0",
    });

    const res = await POST(req, CTX);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 202 for a valid error payload with no optional fields", async () => {
    const { POST } = await import(
      "@/app/api/telemetry/client-errors/route"
    );

    const req = makeRequest({
      level: "error",
      message: "[SW] Registration failed",
      ts: Date.now(),
    });

    const res = await POST(req, CTX);
    expect(res.status).toBe(202);
  });

  it("forwards valid payload to server logger at the correct level", async () => {
    const { POST } = await import(
      "@/app/api/telemetry/client-errors/route"
    );

    const req = makeRequest({
      level: "warn",
      message: "[ObservationsLog] Failed to load camps",
      payload: { farmSlug: "trio-b" },
      ts: 1714000000000,
    });

    await POST(req, CTX);

    // loggerMock.warn is the vi.fn() from the module-level vi.mock
    expect(loggerMock.warn).toHaveBeenCalled();
    // Last call should contain our payload
    const calls = loggerMock.warn.mock.calls;
    const lastCall = calls[calls.length - 1] as [string, Record<string, unknown>];
    const [tag, details] = lastCall;
    expect(tag).toContain("client");
    expect(details.message).toBe("[ObservationsLog] Failed to load camps");
    // The route uses logger[level] so the correct logger method is selected;
    // level is not duplicated in the structured details object
    expect(details.ts).toBe(1714000000000);
  });

  it("forwards error level payload to logger.error", async () => {
    const { POST } = await import(
      "@/app/api/telemetry/client-errors/route"
    );

    const req = makeRequest({
      level: "error",
      message: "[register] submit failed",
      ts: Date.now(),
    });

    await POST(req, CTX);

    expect(loggerMock.error).toHaveBeenCalled();
    const calls = loggerMock.error.mock.calls;
    const [tag] = calls[calls.length - 1] as [string];
    expect(tag).toContain("client");
  });

  // ── 400 validation failures ───────────────────────────────────────────────

  it("returns 400 when level is missing", async () => {
    const { POST } = await import(
      "@/app/api/telemetry/client-errors/route"
    );

    const req = makeRequest({
      message: "some message",
      ts: Date.now(),
    });

    const res = await POST(req, CTX);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.code).toBeDefined();
  });

  it("returns 400 when level is not a valid value", async () => {
    const { POST } = await import(
      "@/app/api/telemetry/client-errors/route"
    );

    const req = makeRequest({
      level: "verbose",
      message: "some message",
      ts: Date.now(),
    });

    const res = await POST(req, CTX);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_level");
  });

  it("returns 400 when message is missing", async () => {
    const { POST } = await import(
      "@/app/api/telemetry/client-errors/route"
    );

    const req = makeRequest({
      level: "error",
      ts: Date.now(),
    });

    const res = await POST(req, CTX);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_message");
  });

  it("returns 400 when message is empty string", async () => {
    const { POST } = await import(
      "@/app/api/telemetry/client-errors/route"
    );

    const req = makeRequest({
      level: "info",
      message: "",
      ts: Date.now(),
    });

    const res = await POST(req, CTX);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_message");
  });

  it("returns 400 when body is not valid JSON", async () => {
    const { POST } = await import(
      "@/app/api/telemetry/client-errors/route"
    );

    const req = new NextRequest("http://localhost/api/telemetry/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json {{{",
    });

    const res = await POST(req, CTX);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_json");
  });

  it("returns 400 when ts is missing", async () => {
    const { POST } = await import(
      "@/app/api/telemetry/client-errors/route"
    );

    const req = makeRequest({
      level: "info",
      message: "hello",
    });

    const res = await POST(req, CTX);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_ts");
  });
});
