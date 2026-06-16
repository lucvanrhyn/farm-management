/**
 * @vitest-environment node
 *
 * __tests__/server/send-email-weekly-briefing.test.ts — the weekly-briefing
 * email renderer. Mirrors the alert-digest renderer's contract:
 *   - INLINE HEX colours only (CSS vars don't survive email clients).
 *   - escapes farmer/farm content (escapeHtml).
 *   - renders the three deterministic sections + the prose intro.
 *   - omits a section heading when that section is empty (graceful degradation).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockSend };
  },
}));

vi.mock("@/lib/server/app-url", () => ({
  getAppBaseUrl: () => "https://app.farmtrack.app",
}));

import { sendEmail } from "@/lib/server/send-email";

const SLUG = "trio-b-boerdery";

beforeEach(() => {
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "FarmTrack <noreply@farmtrack.app>";
  mockSend.mockReset();
  mockSend.mockResolvedValue({ data: { id: "wb1" }, error: null });
});

interface RenderArgs {
  whatChanged?: string[];
  whatToWatch?: string[];
  whatToDo?: string[];
  intro?: string;
  farmName?: string;
}

async function renderHtml(args: RenderArgs = {}): Promise<string> {
  const result = await sendEmail({
    to: "admin@example.com",
    template: "weekly-briefing",
    data: {
      farmSlug: SLUG,
      farmName: args.farmName ?? "Trio-B Boerdery",
      intro: args.intro ?? "Einstein here with your weekly briefing.",
      whatChanged: args.whatChanged ?? [],
      whatToWatch: args.whatToWatch ?? [],
      whatToDo: args.whatToDo ?? [],
    },
  });
  expect(result.sent).toBe(true);
  expect(mockSend).toHaveBeenCalledTimes(1);
  return mockSend.mock.calls[0][0].html as string;
}

describe("weekly-briefing email template", () => {
  it("is a registered template (send succeeds, no unknown-template error)", async () => {
    const result = await sendEmail({
      to: "admin@example.com",
      template: "weekly-briefing",
      data: { farmSlug: SLUG, farmName: "X", intro: "hi", whatChanged: [], whatToWatch: [], whatToDo: [] },
    });
    expect(result.sent).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("renders the prose intro and the three section lines", async () => {
    const html = await renderHtml({
      intro: "Quiet week on the farm.",
      whatChanged: ["14 weighings logged this week."],
      whatToWatch: ["COW-12 has low weight gain (poor doer)."],
      whatToDo: ["File provisional tax (due 2026-06-30)."],
    });
    expect(html).toContain("Quiet week on the farm.");
    expect(html).toContain("14 weighings logged this week.");
    expect(html).toContain("COW-12 has low weight gain");
    expect(html).toContain("File provisional tax");
  });

  it("uses inline hex colours, not CSS variables", async () => {
    const html = await renderHtml({ whatChanged: ["something"] });
    expect(html).toMatch(/#[0-9A-Fa-f]{6}/);
    expect(html).not.toContain("var(--");
  });

  it("escapes HTML in farmer-supplied content", async () => {
    const html = await renderHtml({ whatChanged: ["<script>alert(1)</script>"] });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("omits an empty section's heading (graceful degradation)", async () => {
    const html = await renderHtml({
      whatChanged: ["one change"],
      whatToWatch: [],
      whatToDo: [],
    });
    // The "what to watch" heading must not appear when that section is empty.
    expect(html.toLowerCase()).not.toContain("what to watch");
  });

  it("subject names the farm", async () => {
    await renderHtml({ farmName: "Trio-B Boerdery", whatChanged: ["x"] });
    const subject = mockSend.mock.calls[0][0].subject as string;
    expect(subject).toContain("Trio-B Boerdery");
  });
});
