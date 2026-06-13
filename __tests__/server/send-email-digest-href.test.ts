/**
 * @vitest-environment node
 *
 * __tests__/server/send-email-digest-href.test.ts — the alert-digest email
 * renderer must farm-scope each deep-link to exactly ONE slug.
 *
 * Regression guard for the source↔consumer coupling: generators now emit a
 * complete `/${farmSlug}/...` href, and the renderer routes it through the
 * idempotent `scopeHref`, so an already-scoped href must NOT become
 * `/slug/slug/...`. A bare legacy href (≤24h TTL) must still be self-healed.
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

const BASE = "https://app.farmtrack.app";
const SLUG = "basson-boerdery";

beforeEach(() => {
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "FarmTrack <noreply@farmtrack.app>";
  mockSend.mockReset();
  mockSend.mockResolvedValue({ data: { id: "e1" }, error: null });
});

async function renderDigestHtml(
  items: Array<{ message: string; href: string; severity: string }>,
): Promise<string> {
  await sendEmail({
    to: "admin@example.com",
    template: "alert-digest",
    data: {
      farmSlug: SLUG,
      farmName: "Basson Boerdery",
      groups: [{ category: "Veld & Grazing", items }],
    },
  });
  expect(mockSend).toHaveBeenCalledTimes(1);
  return mockSend.mock.calls[0][0].html as string;
}

describe("alert-digest renderer farm-scopes deep-links", () => {
  it("scopes a bare legacy href to a single-slug absolute URL", async () => {
    const html = await renderDigestHtml([
      { message: "C-1 cover stale", href: "/admin/camps/C-1", severity: "amber" },
    ]);
    expect(html).toContain(`href="${BASE}/${SLUG}/admin/camps/C-1"`);
  });

  it("does NOT double-prefix an already farm-scoped href", async () => {
    const html = await renderDigestHtml([
      {
        message: "C-1 cover stale",
        href: `/${SLUG}/admin/camps/C-1`,
        severity: "amber",
      },
    ]);
    expect(html).toContain(`href="${BASE}/${SLUG}/admin/camps/C-1"`);
    expect(html).not.toContain(`/${SLUG}/${SLUG}/`);
  });

  it("preserves the ?focus= query string on a scoped href", async () => {
    const html = await renderDigestHtml([
      {
        message: "Ewe A lambing",
        href: `/${SLUG}/admin/animals?focus=EWE-1`,
        severity: "red",
      },
    ]);
    expect(html).toContain(
      `href="${BASE}/${SLUG}/admin/animals?focus=EWE-1"`,
    );
  });
});
