/**
 * @vitest-environment node
 *
 * lib/server/briefing/__tests__/send-weekly-briefing.test.ts —
 * Weekly Farm Briefing v1 send path + audience gate.
 *
 * Contract:
 *   - AUDIENCE GATE (decision 7): the email is sent to a tenant ONLY if that
 *     tenant has at least one AlertPreference with digestMode='weekly'. No
 *     opt-in → no email (no spamming, no migration). The in-app card is
 *     always on regardless and is NOT exercised here.
 *   - the send mirrors sendDailyDigest: resolve recipient, build the 7-day
 *     payload, narrate, send the 'weekly-briefing' template.
 *   - graceful: when the payload is empty AND there's no opt-in, no email.
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

vi.mock("@/lib/server/send-email", () => ({
  sendEmail: mockSendEmail,
}));

vi.mock("../narrator", () => ({
  narrateBriefing: mockNarrate,
  templatedBriefingNarration: () => "fallback intro",
}));

vi.mock("@/lib/einstein/budget", () => ({
  assertWithinBudget: mockAssertBudget,
  stampCostBeforeSend: mockStamp,
  reconcileCostAfterSend: mockReconcile,
  EinsteinBudgetError: class EinsteinBudgetError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

// Keep the heavy source-fetch off the unit path: stub the payload builder shell
// so this test focuses on the audience gate + send wiring.
vi.mock("../collect", () => ({
  collectBriefingSources: mockBuildPayload,
}));

import { sendWeeklyBriefing } from "../send-weekly-briefing";
import type { BriefingPayload } from "../payload";

function fakePrisma(opts: {
  weeklyPrefCount: number;
  adminEmail?: string | null;
}) {
  return {
    alertPreference: {
      count: vi.fn().mockResolvedValue(opts.weeklyPrefCount),
    },
    user: {
      findFirst: vi.fn().mockImplementation(({ where }: { where?: { role?: string } }) => {
        if (where?.role === "admin") {
          return Promise.resolve(opts.adminEmail ? { email: opts.adminEmail } : null);
        }
        return Promise.resolve(opts.adminEmail ? { email: opts.adminEmail } : null);
      }),
    },
  } as never;
}

const SETTINGS = { farmName: "Trio-B Boerdery", latitude: null, longitude: null } as never;

function payload(over: Partial<BriefingPayload> = {}): BriefingPayload {
  return {
    farmName: "Trio-B Boerdery",
    whatChanged: ["x"],
    whatToWatch: [],
    whatToDo: [],
    isEmpty: false,
    ...over,
  };
}

beforeEach(() => {
  mockSendEmail.mockReset().mockResolvedValue({ sent: true, id: "wb1" });
  mockNarrate.mockReset().mockResolvedValue("AI intro");
  mockBuildPayload.mockReset();
  mockAssertBudget.mockReset().mockResolvedValue({ tier: "advanced", remainingZar: 50 });
  mockStamp.mockReset().mockResolvedValue(undefined);
  mockReconcile.mockReset().mockResolvedValue(undefined);
});

describe("sendWeeklyBriefing — audience gate", () => {
  it("does NOT send when no AlertPreference has digestMode='weekly'", async () => {
    mockBuildPayload.mockResolvedValue({ payload: payload(), sources: {} });
    const result = await sendWeeklyBriefing(
      fakePrisma({ weeklyPrefCount: 0, adminEmail: "a@b.com" }),
      SETTINGS,
      "trio-b-boerdery",
    );
    expect(result.sent).toBe(false);
    expect(result.reason).toBe("no-weekly-optin");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("sends when at least one AlertPreference opts into weekly", async () => {
    mockBuildPayload.mockResolvedValue({ payload: payload(), sources: {} });
    const result = await sendWeeklyBriefing(
      fakePrisma({ weeklyPrefCount: 1, adminEmail: "a@b.com" }),
      SETTINGS,
      "trio-b-boerdery",
    );
    expect(result.sent).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const call = mockSendEmail.mock.calls[0][0];
    expect(call.template).toBe("weekly-briefing");
    expect(call.to).toBe("a@b.com");
    expect(call.data.intro).toBe("AI intro");
  });

  it("does NOT send when opted-in but there is no recipient email", async () => {
    mockBuildPayload.mockResolvedValue({ payload: payload(), sources: {} });
    const result = await sendWeeklyBriefing(
      fakePrisma({ weeklyPrefCount: 1, adminEmail: null }),
      SETTINGS,
      "trio-b-boerdery",
    );
    expect(result.sent).toBe(false);
    expect(result.reason).toBe("no-admin-email");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("passes the deterministic payload sections to the email data", async () => {
    mockBuildPayload.mockResolvedValue({
      payload: payload({ whatChanged: ["c1"], whatToWatch: ["w1"], whatToDo: ["d1"] }),
      sources: {},
    });
    await sendWeeklyBriefing(
      fakePrisma({ weeklyPrefCount: 1, adminEmail: "a@b.com" }),
      SETTINGS,
      "trio-b-boerdery",
    );
    const data = mockSendEmail.mock.calls[0][0].data;
    expect(data.whatChanged).toEqual(["c1"]);
    expect(data.whatToWatch).toEqual(["w1"]);
    expect(data.whatToDo).toEqual(["d1"]);
    expect(data.farmName).toBe("Trio-B Boerdery");
  });
});

describe("sendWeeklyBriefing — AI budget guard (mark-before-send)", () => {
  it("checks budget then narrates online when within budget", async () => {
    mockBuildPayload.mockResolvedValue({ payload: payload(), sources: {} });
    await sendWeeklyBriefing(
      fakePrisma({ weeklyPrefCount: 1, adminEmail: "a@b.com" }),
      SETTINGS,
      "trio-b-boerdery",
    );
    expect(mockAssertBudget).toHaveBeenCalledWith("trio-b-boerdery");
    expect(mockStamp).toHaveBeenCalled();
    expect(mockNarrate).toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("still sends the email (template intro) when the tenant is over budget", async () => {
    const { EinsteinBudgetError } = await import("@/lib/einstein/budget");
    mockAssertBudget.mockRejectedValue(new EinsteinBudgetError("EINSTEIN_BUDGET_EXHAUSTED", "over"));
    mockBuildPayload.mockResolvedValue({ payload: payload(), sources: {} });
    const result = await sendWeeklyBriefing(
      fakePrisma({ weeklyPrefCount: 1, adminEmail: "a@b.com" }),
      SETTINGS,
      "trio-b-boerdery",
    );
    // Over-budget must NOT block the email — the deterministic template intro
    // is used instead of the LLM (graceful degradation).
    expect(result.sent).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].data.intro).toBe("fallback intro");
    // Online narrator must NOT be invoked when budget is exhausted.
    expect(mockNarrate).not.toHaveBeenCalled();
  });
});
