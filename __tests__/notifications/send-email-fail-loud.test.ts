/**
 * @vitest-environment node
 *
 * __tests__/notifications/send-email-fail-loud.test.ts — Phase G fail-loud
 * regression for `sendEmail`.
 *
 * The Phase J email digest used to silently no-op when `RESEND_API_KEY` was
 * unset. After Wave 4 it was already warning, but the warn payload was a
 * free-text string — operations had nothing typed to grep / alert on. Per
 * `memory/silent-failure-pattern.md`, every silent-skip branch must carry a
 * typed code. This suite locks in:
 *
 *   1. Missing key → exactly one `logger.warn` carrying
 *      `code: "NOTIFICATION_RESEND_KEY_MISSING"`.
 *   2. Cron must keep running — `sendEmail` MUST resolve, never throw.
 *   3. With the key present, no warn fires — behaviour unchanged.
 *   4. Empty recipient short-circuits (`skipped: "no-recipient"`) without
 *      touching Resend or warning.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NOTIFICATION_ERROR_CODES } from "@/lib/server/notifications/error-codes";

// Hold a handle to the Resend.send mock across resets. We declare it at
// module-scope so the `vi.mock("resend", ...)` factory closes over it without
// caring about hoist ordering.
const resendSendMock = vi.fn();

// Resend is `new`'d in send-email.ts (`return new Resend(apiKey)`), so the
// mock has to be constructable. Vitest's `vi.fn(() => ...)` is callable but
// not constructable — use a real class instead.
vi.mock("resend", () => {
  class MockResend {
    emails = { send: resendSendMock };
  }
  return { Resend: MockResend };
});

// `lib/logger` is a shared singleton — but we use vi.resetModules() between
// tests to force send-email to re-resolve `process.env.RESEND_API_KEY`, and
// that also re-imports the logger inside send-email. Mock the logger module
// itself so every fresh import sees the same warn mock.
const warnMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: warnMock,
    error: vi.fn(),
  },
}));

beforeEach(() => {
  warnMock.mockClear();
  resendSendMock.mockReset();
  resendSendMock.mockResolvedValue({ data: { id: "mock-id" }, error: null });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function importSendEmail() {
  return (await import("@/lib/server/send-email")).sendEmail;
}

describe("sendEmail — fail-loud on missing RESEND_API_KEY", () => {
  it("warns with NOTIFICATION_RESEND_KEY_MISSING when key is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const sendEmail = await importSendEmail();

    const result = await sendEmail({
      to: "ops@example.com",
      template: "alert-digest",
      data: { farmSlug: "tenant-a", farmName: "Test Farm", groups: [] },
    });

    expect(result.sent).toBe(false);
    expect(result.skipped).toBe("no-api-key");

    expect(warnMock).toHaveBeenCalledTimes(1);
    const [, payload] = warnMock.mock.calls[0];
    expect(payload).toMatchObject({
      code: NOTIFICATION_ERROR_CODES.RESEND_KEY_MISSING,
      template: "alert-digest",
    });
    // String constant value is part of the public contract — operations dashboards
    // grep on the literal code, not on the import.
    expect((payload as { code: string }).code).toBe(
      "NOTIFICATION_RESEND_KEY_MISSING",
    );
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("does not throw when RESEND_API_KEY is missing — cron must keep running", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const sendEmail = await importSendEmail();

    await expect(
      sendEmail({
        to: "ops@example.com",
        template: "alert-digest",
        data: { farmSlug: "tenant-a", farmName: "Test Farm", groups: [] },
      }),
    ).resolves.toBeDefined();
  });

  it("does NOT warn when RESEND_API_KEY is set — behaviour unchanged on the happy path", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_live_dummy");
    const sendEmail = await importSendEmail();

    const result = await sendEmail({
      to: "ops@example.com",
      template: "alert-digest",
      data: { farmSlug: "tenant-a", farmName: "Test Farm", groups: [] },
    });

    expect(result.sent).toBe(true);
    expect(result.id).toBe("mock-id");
    // Critically: no fail-loud noise on the happy path.
    expect(
      warnMock.mock.calls.some(([msg]) =>
        typeof msg === "string" && msg.includes("RESEND_API_KEY"),
      ),
    ).toBe(false);
    expect(resendSendMock).toHaveBeenCalledTimes(1);
  });

  it("short-circuits empty recipient with no-recipient and no warn", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_live_dummy");
    const sendEmail = await importSendEmail();

    const result = await sendEmail({
      to: "",
      template: "alert-digest",
      data: { farmSlug: "tenant-a", farmName: "Test Farm", groups: [] },
    });

    expect(result.sent).toBe(false);
    expect(result.skipped).toBe("no-recipient");
    expect(warnMock).not.toHaveBeenCalled();
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("warns with NOTIFICATION_RESEND_API_FAILED when Resend returns res.error", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_live_dummy");
    // Resend v4+ surfaces failures via `res.error` — typically an Error
    // subclass (e.g. ResendError). Use a real Error so the existing
    // `instanceof Error ? message : String(...)` branch picks up the message.
    resendSendMock.mockResolvedValueOnce({
      data: null,
      error: new Error("domain not verified"),
    });
    const sendEmail = await importSendEmail();

    const result = await sendEmail({
      to: "ops@example.com",
      template: "alert-digest",
      data: { farmSlug: "tenant-a", farmName: "Test Farm", groups: [] },
    });

    expect(result.sent).toBe(false);
    expect(result.error).toContain("domain not verified");
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0][1]).toMatchObject({
      code: NOTIFICATION_ERROR_CODES.RESEND_API_FAILED,
      template: "alert-digest",
    });
  });

  it("warns with NOTIFICATION_RESEND_API_FAILED when Resend.send throws", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_live_dummy");
    resendSendMock.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    const sendEmail = await importSendEmail();

    const result = await sendEmail({
      to: "ops@example.com",
      template: "alert-digest",
      data: { farmSlug: "tenant-a", farmName: "Test Farm", groups: [] },
    });

    expect(result.sent).toBe(false);
    expect(result.error).toContain("ETIMEDOUT");
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0][1]).toMatchObject({
      code: NOTIFICATION_ERROR_CODES.RESEND_API_FAILED,
      template: "alert-digest",
    });
  });

  it("warns with NOTIFICATION_UNKNOWN_TEMPLATE when template is not registered", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_live_dummy");
    const sendEmail = await importSendEmail();

    const result = await sendEmail({
      to: "ops@example.com",
      // Cast through unknown — runtime callers with weaker types could hit this.
      template: "totally-bogus-template" as unknown as
        Parameters<typeof sendEmail>[0]["template"],
      data: {},
    });

    expect(result.sent).toBe(false);
    expect(result.error).toContain("Unknown template");
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0][1]).toMatchObject({
      code: NOTIFICATION_ERROR_CODES.UNKNOWN_TEMPLATE,
      template: "totally-bogus-template",
    });
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});
