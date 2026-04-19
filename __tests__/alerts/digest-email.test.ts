/**
 * @vitest-environment node
 *
 * __tests__/alerts/digest-email.test.ts — sendDailyDigest end-to-end.
 *
 * We mock sendEmail to observe the rendered payload, and assert:
 *   - empty notification list → { sent: false, reason: "no-alerts" }
 *   - categories are grouped correctly
 *   - admin email resolution falls back to any user if no role=admin
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendDailyDigest } from "@/lib/server/alerts/digest-email";
import { makePrisma, makeSettings } from "./fixtures";

vi.mock("@/lib/server/send-email", () => ({
  sendEmail: vi.fn().mockResolvedValue({ sent: true, id: "mock-email-1" }),
}));

import { sendEmail } from "@/lib/server/send-email";

beforeEach(() => {
  vi.mocked(sendEmail).mockClear();
});

describe("sendDailyDigest", () => {
  it("skips with no-alerts when there are no unread notifications", async () => {
    const prisma = makePrisma({
      notification: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findFirst: vi.fn().mockResolvedValue({ email: "admin@example.com" }) },
    });
    const out = await sendDailyDigest(prisma, makeSettings(), "tenant-a");
    expect(out.sent).toBe(false);
    expect(out.reason).toBe("no-alerts");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("groups alerts by category and sends with alert-digest template", async () => {
    const prisma = makePrisma({
      notification: {
        findMany: vi.fn().mockResolvedValue([
          {
            type: "LAMBING_DUE_7D",
            message: "Ewe A lambing in 3d",
            href: "/admin/animals",
            severity: "amber",
            createdAt: new Date(),
          },
          {
            type: "PREDATOR_SPIKE",
            message: "5 losses today",
            href: "/admin/observations",
            severity: "red",
            createdAt: new Date(),
          },
          {
            type: "COG_EXCEEDS_BREAKEVEN",
            message: "B-1 cost of gain high",
            href: "/admin/animals",
            severity: "amber",
            createdAt: new Date(),
          },
        ]),
      },
      user: {
        findFirst: vi.fn().mockResolvedValue({ email: "admin@example.com" }),
      },
    });

    const out = await sendDailyDigest(prisma, makeSettings(), "tenant-a");
    expect(out.sent).toBe(true);
    expect(out.alertCount).toBe(3);
    expect(out.groupCount).toBe(3); // Reproduction, Predator, Finance
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.template).toBe("alert-digest");
    const groups = (call.data as { groups: { category: string }[] }).groups;
    const cats = groups.map((g) => g.category).sort();
    expect(cats).toEqual(["Finance", "Predator", "Reproduction"]);
  });

  it("returns no-admin-email if no user exists", async () => {
    const prisma = makePrisma({
      notification: {
        findMany: vi.fn().mockResolvedValue([
          { type: "LAMBING_DUE_7D", message: "x", href: "/x", severity: "amber", createdAt: new Date() },
        ]),
      },
      user: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const out = await sendDailyDigest(prisma, makeSettings(), "tenant-a");
    expect(out.sent).toBe(false);
    expect(out.reason).toBe("no-admin-email");
  });
});
