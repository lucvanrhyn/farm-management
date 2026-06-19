/**
 * @vitest-environment node
 *
 * sendWeeklyBriefing — idempotency under Inngest step retry (stress-test wave
 * 2026-06-19).
 *
 * Inngest `step.run` is at-least-once: a retry after sendEmail succeeded but
 * before the step result checkpointed would RESEND the weekly briefing email.
 * The send must claim a per-(tenant, week) marker BEFORE narrating + sending,
 * so a retry (same tenant, same ISO week) short-circuits with no second email.
 * Mirrors the alerts dispatch at-most-once stamp-before-send contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSendEmail, mockBuildPayload, mockNarrate, mockAssertBudget, mockStamp, mockReconcile } = vi.hoisted(() => ({
  mockSendEmail: vi.fn(),
  mockBuildPayload: vi.fn(),
  mockNarrate: vi.fn(),
  mockAssertBudget: vi.fn(),
  mockStamp: vi.fn(),
  mockReconcile: vi.fn(),
}));

vi.mock("@/lib/server/send-email", () => ({ sendEmail: mockSendEmail }));
vi.mock("../narrator", () => ({
  narrateBriefing: mockNarrate,
  templatedBriefingNarration: () => "fallback intro",
}));
vi.mock("@/lib/einstein/budget", () => ({
  assertWithinBudget: mockAssertBudget,
  stampCostBeforeSend: mockStamp,
  reconcileCostAfterSend: mockReconcile,
  EinsteinBudgetError: class EinsteinBudgetError extends Error {},
}));
vi.mock("../collect", () => ({ collectBriefingSources: mockBuildPayload }));

import { sendWeeklyBriefing } from "../send-weekly-briefing";

const SETTINGS = { farmName: "Trio-B Boerdery" } as never;
const PAYLOAD = { farmName: "Trio-B Boerdery", whatChanged: ["x"], whatToWatch: [], whatToDo: [], isEmpty: false };
const FIXED_NOW = new Date("2026-06-17T05:00:00Z"); // a Wednesday in some ISO week

/** Prisma mock that enforces the real Notification @@unique(type, dedupKey). */
function fakePrisma() {
  const seen = new Set<string>();
  const create = vi.fn(({ data }: { data: { type: string; dedupKey?: string | null; expiresAt: Date; [k: string]: unknown } }) => {
    const key = `${data.type}::${data.dedupKey ?? ""}`;
    if (seen.has(key)) {
      return Promise.reject(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    }
    seen.add(key);
    return Promise.resolve({ id: `n-${seen.size}`, ...data });
  });
  return {
    prisma: {
      alertPreference: { count: vi.fn().mockResolvedValue(1) },
      user: { findFirst: vi.fn().mockResolvedValue({ email: "a@b.com" }) },
      notification: { create },
    } as never,
    create,
  };
}

beforeEach(() => {
  mockSendEmail.mockReset().mockResolvedValue({ sent: true, id: "wb1" });
  mockNarrate.mockReset().mockResolvedValue("AI intro");
  mockBuildPayload.mockReset().mockResolvedValue({ payload: PAYLOAD, sources: {} });
  mockAssertBudget.mockReset().mockResolvedValue({ tier: "advanced", remainingZar: 50 });
  mockStamp.mockReset().mockResolvedValue(undefined);
  mockReconcile.mockReset().mockResolvedValue(undefined);
});

describe("sendWeeklyBriefing — at-most-once per (tenant, week)", () => {
  it("sends once and claims a week marker", async () => {
    const { prisma, create } = fakePrisma();
    const result = await sendWeeklyBriefing(prisma, SETTINGS, "trio-b-boerdery", FIXED_NOW);
    expect(result.sent).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    // A week-marker notification was written (idempotency claim).
    expect(create).toHaveBeenCalledTimes(1);
    const marker = create.mock.calls[0][0].data;
    expect(marker.dedupKey).toContain("2026-W25"); // ISO week of 2026-06-17
    // Invisible to the in-app feed (filters expiresAt > now): already-past expiresAt.
    expect(new Date(marker.expiresAt).getTime()).toBeLessThan(FIXED_NOW.getTime());
    // Invisible to the daily alert-digest email (filters isRead:false, NOT expiresAt).
    expect(marker.isRead).toBe(true);
  });

  it("does NOT resend on a retry in the same ISO week (step retry safety)", async () => {
    const { prisma } = fakePrisma();
    const first = await sendWeeklyBriefing(prisma, SETTINGS, "trio-b-boerdery", FIXED_NOW);
    const second = await sendWeeklyBriefing(prisma, SETTINGS, "trio-b-boerdery", FIXED_NOW);

    expect(first.sent).toBe(true);
    expect(second.sent).toBe(false);
    expect(second.reason).toBe("already-sent-this-week");
    // Exactly ONE email despite two invocations (the retry).
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    // The retry short-circuits BEFORE narration (no AI budget re-debit).
    expect(mockNarrate).toHaveBeenCalledTimes(1);
  });
});
