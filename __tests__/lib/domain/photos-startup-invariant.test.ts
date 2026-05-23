/**
 * @vitest-environment node
 *
 * Wave 1 / Issue #251 — startup invariant: when the photos domain module
 * loads under `NODE_ENV=production`, a missing or empty `BLOB_READ_WRITE_TOKEN`
 * must produce a loud, structured error log entry on Vercel so an oncall
 * sees the misconfiguration before the first user upload fires.
 *
 * Pattern mirrors `lib/server/inngest/client.ts` — non-throwing in non-prod
 * (so tests + dev work even without the token), but `logger.error` in prod
 * which Vercel surfaces in the function logs and Sentry can pick up.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockLoggerError = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());

vi.mock("@/lib/logger", () => ({
  logger: {
    error: mockLoggerError,
    warn: mockLoggerWarn,
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const ORIGINAL_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  mockLoggerError.mockReset();
  mockLoggerWarn.mockReset();
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  } else {
    process.env.BLOB_READ_WRITE_TOKEN = ORIGINAL_TOKEN;
  }
  Object.defineProperty(process.env, "NODE_ENV", {
    configurable: true,
    enumerable: true,
    value: ORIGINAL_NODE_ENV,
    writable: true,
  });
});

describe("photos domain — startup invariant on BLOB_READ_WRITE_TOKEN", () => {
  it("logs an error at module load when NODE_ENV=production and token is missing", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    Object.defineProperty(process.env, "NODE_ENV", {
      configurable: true,
      enumerable: true,
      value: "production",
      writable: true,
    });

    await import("@/lib/domain/photos");

    const errorCalls = mockLoggerError.mock.calls.filter((call) =>
      String(call[0]).includes("BLOB_READ_WRITE_TOKEN"),
    );
    expect(errorCalls.length).toBeGreaterThan(0);
    expect(String(errorCalls[0][0])).toMatch(/missing|unset|not configured/i);
  });

  it("logs an error at module load when NODE_ENV=production and token is empty string", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "";
    Object.defineProperty(process.env, "NODE_ENV", {
      configurable: true,
      enumerable: true,
      value: "production",
      writable: true,
    });

    await import("@/lib/domain/photos");

    const errorCalls = mockLoggerError.mock.calls.filter((call) =>
      String(call[0]).includes("BLOB_READ_WRITE_TOKEN"),
    );
    expect(errorCalls.length).toBeGreaterThan(0);
  });

  it("does NOT log when NODE_ENV=production and the token is present and non-empty", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token";
    Object.defineProperty(process.env, "NODE_ENV", {
      configurable: true,
      enumerable: true,
      value: "production",
      writable: true,
    });

    await import("@/lib/domain/photos");

    const errorCalls = mockLoggerError.mock.calls.filter((call) =>
      String(call[0]).includes("BLOB_READ_WRITE_TOKEN"),
    );
    expect(errorCalls).toHaveLength(0);
  });

  it("does NOT log when NODE_ENV !== production (dev / test should not be noisy)", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    Object.defineProperty(process.env, "NODE_ENV", {
      configurable: true,
      enumerable: true,
      value: "test",
      writable: true,
    });

    await import("@/lib/domain/photos");

    const errorCalls = mockLoggerError.mock.calls.filter((call) =>
      String(call[0]).includes("BLOB_READ_WRITE_TOKEN"),
    );
    expect(errorCalls).toHaveLength(0);
  });
});
