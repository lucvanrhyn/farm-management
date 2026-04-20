/**
 * @vitest-environment node
 *
 * Asserts lib/server/inngest/client.ts fails fast in production when signing or
 * event keys are missing. The previous behaviour (console.error but start) let
 * deploys silently accept unsigned webhooks, bypassing Inngest's signature
 * verification. Fail-fast forces a redeploy with the correct env.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.INNGEST_EVENT_KEY;
  delete process.env.INNGEST_SIGNING_KEY;
  delete process.env.SKIP_INNGEST_STARTUP_CHECK;
}

beforeEach(() => {
  resetEnv();
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("inngest client startup", () => {
  it("throws in production when INNGEST_EVENT_KEY is missing", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.INNGEST_SIGNING_KEY = "signkey_test";
    await expect(import("@/lib/server/inngest/client")).rejects.toThrow(
      /INNGEST_EVENT_KEY/,
    );
  });

  it("throws in production when INNGEST_SIGNING_KEY is missing", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.INNGEST_EVENT_KEY = "eventkey_test";
    await expect(import("@/lib/server/inngest/client")).rejects.toThrow(
      /INNGEST_SIGNING_KEY/,
    );
  });

  it("starts cleanly in production when both keys are set", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.INNGEST_EVENT_KEY = "eventkey_test";
    process.env.INNGEST_SIGNING_KEY = "signkey_test";
    const mod = await import("@/lib/server/inngest/client");
    expect(mod.inngest).toBeDefined();
  });

  it("starts without keys in non-production environments", async () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    const mod = await import("@/lib/server/inngest/client");
    expect(mod.inngest).toBeDefined();
  });

  it("SKIP_INNGEST_STARTUP_CHECK=1 bypasses the check in production (scripts)", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.SKIP_INNGEST_STARTUP_CHECK = "1";
    const mod = await import("@/lib/server/inngest/client");
    expect(mod.inngest).toBeDefined();
  });
});
