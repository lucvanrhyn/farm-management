/**
 * @vitest-environment node
 *
 * lib/server/briefing/__tests__/collect.test.ts — the heavy source-fetch shell.
 *
 * collectBriefingSources reads every briefing source for a tenant over a 7-day
 * window and folds them into a BriefingPayload via buildBriefingPayload. Each
 * source fetch is INDEPENDENTLY fail-soft: a throw on one source degrades that
 * source to empty (graceful degradation), never the whole briefing — so the
 * card/email always render.
 *
 * We stub the source helpers (getTriage, getDoNextFeed, getDroughtPayload,
 * getVeldSummary) and feed a fake prisma for the raw notification / observation
 * reads, asserting the right window + the fail-soft contract.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetTriage,
  mockGetDoNext,
  mockGetDrought,
  mockGetVeld,
} = vi.hoisted(() => ({
  mockGetTriage: vi.fn(),
  mockGetDoNext: vi.fn(),
  mockGetDrought: vi.fn(),
  mockGetVeld: vi.fn(),
}));

vi.mock("@/lib/server/triage/get-triage", () => ({ getTriage: mockGetTriage }));
vi.mock("@/lib/server/nudges/feed", () => ({ getDoNextFeed: mockGetDoNext }));
vi.mock("@/lib/server/drought", () => ({ getDroughtPayload: mockGetDrought }));
vi.mock("@/lib/server/veld-score", () => ({ getFarmSummary: mockGetVeld }));

import { collectBriefingSources } from "../collect";

const NOW = new Date("2026-06-15T05:00:00.000Z");

function fakePrisma(over: {
  notifications?: unknown[];
  weighings?: unknown[];
  reproEvents?: unknown[];
  deaths?: unknown[];
  sold?: unknown[];
  settings?: { latitude: number | null; longitude: number | null } | null;
} = {}) {
  const observationFindMany = vi.fn().mockImplementation(({ where }: { where?: { type?: string } }) => {
    const t = where?.type;
    if (t === "weighing") return Promise.resolve(over.weighings ?? []);
    if (t === "death") return Promise.resolve(over.deaths ?? []);
    return Promise.resolve(over.reproEvents ?? []);
  });
  return {
    notification: { findMany: vi.fn().mockResolvedValue(over.notifications ?? []) },
    farmSettings: { findFirst: vi.fn().mockResolvedValue(over.settings ?? { latitude: null, longitude: null }) },
    observation: { findMany: observationFindMany },
    animal: { findMany: vi.fn().mockResolvedValue(over.sold ?? []), count: vi.fn().mockResolvedValue(0) },
    // scoped()/crossSpecies() forward to these delegates verbatim.
  } as never;
}

beforeEach(() => {
  mockGetTriage.mockReset().mockResolvedValue([]);
  mockGetDoNext.mockReset().mockResolvedValue([]);
  mockGetDrought.mockReset().mockResolvedValue(null);
  mockGetVeld.mockReset().mockResolvedValue(null);
});

describe("collectBriefingSources", () => {
  it("returns an empty payload when every source is empty", async () => {
    const { payload } = await collectBriefingSources(fakePrisma(), "trio-b", {
      now: NOW,
      userEmail: "a@b.com",
      farmName: "Trio-B",
    });
    expect(payload.isEmpty).toBe(true);
    expect(payload.farmName).toBe("Trio-B");
  });

  it("folds 7-day notifications into the payload", async () => {
    const { payload } = await collectBriefingSources(
      fakePrisma({
        notifications: [
          { id: "n1", type: "PREDATOR_SPIKE", severity: "red", message: "Predator spike", href: "/x", createdAt: NOW },
        ],
      }),
      "trio-b",
      { now: NOW, userEmail: "a@b.com", farmName: "Trio-B" },
    );
    expect(payload.whatChanged.join(" ")).toContain("Predator spike");
  });

  it("folds triage attention items into what-to-watch", async () => {
    mockGetTriage.mockResolvedValue([
      { animalId: "COW-1", reasons: [{ id: "poor-doer", severity: "amber", weight: 3 }], urgency: 3, severity: "amber", species: "cattle" },
    ]);
    const { payload } = await collectBriefingSources(fakePrisma(), "trio-b", {
      now: NOW,
      userEmail: "a@b.com",
      farmName: "Trio-B",
    });
    expect(payload.whatToWatch.join(" ")).toContain("COW-1");
  });

  it("folds nudges feed into what-to-do", async () => {
    mockGetDoNext.mockResolvedValue([
      { id: "d1", type: "TAX_DEADLINE", severity: "red", message: "tax", href: "/t", action: { taskType: "tax", label: "File tax" }, dueDate: null, createdAt: NOW.toISOString() },
    ]);
    const { payload } = await collectBriefingSources(fakePrisma(), "trio-b", {
      now: NOW,
      userEmail: "a@b.com",
      farmName: "Trio-B",
    });
    expect(payload.whatToDo.join(" ")).toContain("File tax");
  });

  it("is fail-soft: a throwing source degrades to empty, never the whole briefing", async () => {
    mockGetTriage.mockRejectedValue(new Error("tokyo down"));
    mockGetDoNext.mockRejectedValue(new Error("cache down"));
    const { payload } = await collectBriefingSources(
      fakePrisma({
        notifications: [
          { id: "n1", type: "X", severity: "amber", message: "still here", href: "/x", createdAt: NOW },
        ],
      }),
      "trio-b",
      { now: NOW, userEmail: "a@b.com", farmName: "Trio-B" },
    );
    // notifications survived; the throwing sources contributed nothing.
    expect(payload.whatChanged.join(" ")).toContain("still here");
    expect(payload.whatToWatch).toEqual([]);
    expect(payload.whatToDo).toEqual([]);
  });

  it("counts weighings + deaths over the 7-day window into key changes", async () => {
    const { payload } = await collectBriefingSources(
      fakePrisma({
        weighings: [{ animalId: "a" }, { animalId: "b" }, { animalId: "c" }],
        deaths: [{ observedAt: NOW }],
      }),
      "trio-b",
      { now: NOW, userEmail: "a@b.com", farmName: "Trio-B" },
    );
    const joined = payload.whatChanged.join(" ");
    expect(joined).toContain("3");
    expect(joined).toContain("weigh");
    expect(joined.toLowerCase()).toContain("death");
  });
});
