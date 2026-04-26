/**
 * __tests__/lib/client-logger.test.ts
 *
 * TDD — RED phase. Written BEFORE the production module exists.
 * Expected failure: "Cannot find module '@/lib/client-logger'"
 *
 * Contract under test:
 *   clientLogger.info/warn/error/debug(message, payload?)
 *   - POSTs structured JSON to /api/telemetry/client-errors
 *   - Serialises Error objects (name, message, stack) in payload
 *   - Falls back to console.<level> on network/HTTP failure
 *   - Is a no-op when window is undefined (SSR guard)
 *   - Passes keepalive: true on the fetch
 *
 * Environment: jsdom (for window / navigator availability)
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── fetch mock ────────────────────────────────────────────────────────────────
// globalThis.fetch is available in jsdom but we replace it so we can assert
// what was called without making real network requests.

const mockFetch = vi.fn();

beforeEach(() => {
  globalThis.fetch = mockFetch.mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 202 })
  );
  // Ensure window exists (jsdom provides it)
  Object.defineProperty(globalThis, "window", {
    value: globalThis,
    writable: true,
    configurable: true,
  });
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

async function getLogger() {
  const mod = await import("@/lib/client-logger");
  return mod.clientLogger;
}

describe("clientLogger — basic POST shape", () => {
  it("POSTs to /api/telemetry/client-errors with correct method and Content-Type", async () => {
    const logger = await getLogger();
    await logger.info("test message");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/telemetry/client-errors");
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
  });

  it("includes level, message, ts, url, userAgent in the body", async () => {
    const logger = await getLogger();
    await logger.warn("boundary caught", { component: "ErrorBoundary" });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;

    expect(body.level).toBe("warn");
    expect(body.message).toBe("boundary caught");
    expect(typeof body.ts).toBe("number");
    expect(typeof body.url).toBe("string");
    expect(typeof body.userAgent).toBe("string");
  });

  it("includes the structured payload in the body", async () => {
    const logger = await getLogger();
    await logger.error("fetch failed", { code: 503 });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as {
      payload: Record<string, unknown>;
    };

    expect(body.payload).toEqual({ code: 503 });
  });

  it("sets keepalive: true on the fetch options", async () => {
    const logger = await getLogger();
    await logger.error("unload error");

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.keepalive).toBe(true);
  });

  it("passes debug level correctly", async () => {
    const logger = await getLogger();
    await logger.debug("debugging value", { x: 1 });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { level: string };
    expect(body.level).toBe("debug");
  });
});

describe("clientLogger — Error serialisation in payload", () => {
  it("serialises an Error in the payload with name, message, stack", async () => {
    const logger = await getLogger();
    const err = new Error("boom");
    await logger.error("ctx", { err });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as {
      payload: { err: { name: string; message: string; stack: string } };
    };

    expect(body.payload.err.name).toBe("Error");
    expect(body.payload.err.message).toBe("boom");
    expect(typeof body.payload.err.stack).toBe("string");
  });

  it("does NOT serialise Error as {} (JSON.stringify blind spot)", async () => {
    const logger = await getLogger();
    const err = new Error("silent death");
    await logger.error("ctx", { err });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    // If JSON.stringify was called naively, err would be serialized as {}
    // Verify the raw body string doesn't contain empty object for the err field
    const rawBody = opts.body as string;
    // The err field should NOT be "{}" — it should have message content
    expect(rawBody).not.toContain('"err":{}');
    expect(rawBody).toContain('"message":"silent death"');
  });

  it("handles a top-level Error argument (no key)", async () => {
    const logger = await getLogger();
    const err = new Error("top level");
    await logger.error("ctx", err as unknown as Record<string, unknown>);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as {
      payload: { name: string; message: string; stack: string };
    };

    // top-level Error should be serialised in payload directly
    expect(body.payload.message).toBe("top level");
    expect(body.payload.name).toBe("Error");
  });
});

describe("clientLogger — failure fallback to console", () => {
  it("falls back to console.error on network failure (fetch throws)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = await getLogger();
    // Should not throw
    await expect(logger.error("fetch failed", { code: 0 })).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });

  it("falls back to console.warn on 5xx response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "server error" }), { status: 500 })
    );
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const logger = await getLogger();
    await expect(logger.warn("something", {})).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });

  it("falls back to console.info on 4xx response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "bad request" }), { status: 400 })
    );
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const logger = await getLogger();
    await expect(logger.info("something")).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });
});

describe("clientLogger — SSR guard", () => {
  it("is a no-op when window is undefined (SSR context)", async () => {
    // Simulate SSR: temporarily undefine window
    const originalWindow = globalThis.window;
    // @ts-expect-error intentionally deleting window to simulate SSR
    delete globalThis.window;

    vi.resetModules();
    const { clientLogger } = await import("@/lib/client-logger");

    // Should not throw, should not call fetch
    await expect(clientLogger.error("ssr call", { x: 1 })).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();

    // Restore window
    globalThis.window = originalWindow;
  });

  it("does not throw in SSR even without a payload", async () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error intentionally deleting window to simulate SSR
    delete globalThis.window;

    vi.resetModules();
    const { clientLogger } = await import("@/lib/client-logger");

    await expect(clientLogger.warn("no payload in ssr")).resolves.toBeUndefined();

    globalThis.window = originalWindow;
  });
});
