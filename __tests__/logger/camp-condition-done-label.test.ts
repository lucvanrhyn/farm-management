/**
 * @vitest-environment jsdom
 *
 * __tests__/logger/camp-condition-done-label.test.ts
 *
 * Wave C / U1 — Codex audit P2 polish (2026-05-10).
 *
 * The logger camp page renders a sticky "complete visit" button. When the
 * user has flagged zero animals, the button used to ALWAYS read
 * "All Normal — Camp Good", regardless of the camp's grazing condition.
 *
 * Codex audit flagged the copy as a lie on Fair / Poor / Overgrazed camps —
 * "no animals flagged" is still a legitimate outcome on a poor-condition
 * camp (the camp's veld can be bad without any sick animals), but the
 * button must not also claim "Camp Good" when the camp clearly isn't.
 *
 * Contract pinned here:
 *   - good / unknown / nullish → "All Normal — Camp Good" (unchanged)
 *   - Fair / Poor / Overgrazed (case-insensitive) → "Done — no animals flagged"
 *
 * Lives on the page.tsx surface so the helper stays inside the allow-listed
 * file. Heavy client deps (offline-store / next-auth / next/dynamic chunks)
 * are stub-mocked here so module load resolves under vitest without dragging
 * IndexedDB or the React component tree into the test.
 */

import { describe, it, expect, vi } from "vitest";

// Mocks must register before importing page.tsx — the page is a client
// component so all of these resolve eagerly.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));
vi.mock("@/components/logger/OfflineProvider", () => ({
  useOffline: () => ({
    isOnline: true,
    refreshPendingCount: vi.fn(),
    refreshCampsState: vi.fn(),
    camps: [],
    campsLoaded: true,
    syncNow: vi.fn(),
  }),
}));
vi.mock("@/components/logger/AnimalChecklist", () => ({ default: () => null }));
vi.mock("@/lib/offline-store", () => ({
  getAnimalsByCampCached: vi.fn().mockResolvedValue([]),
  queueObservation: vi.fn(),
  queuePhoto: vi.fn(),
  queueCoverReading: vi.fn(),
  updateCampCondition: vi.fn(),
  updateAnimalCamp: vi.fn(),
  updateAnimalStatus: vi.fn(),
}));
vi.mock("@/lib/logger-actions", () => ({
  submitCalvingObservation: vi.fn(),
  submitMobMove: vi.fn(),
}));
vi.mock("@/lib/farm-mode", () => ({ useFarmModeSafe: () => ({ mode: "cattle" }) }));

import { campConditionDoneLabel } from "@/app/[farmSlug]/logger/[campId]/page";

describe("campConditionDoneLabel — Wave C / U1", () => {
  it("returns 'All Normal — Camp Good' when grazing quality is null/undefined", () => {
    expect(campConditionDoneLabel(null)).toBe("All Normal — Camp Good");
    expect(campConditionDoneLabel(undefined)).toBe("All Normal — Camp Good");
  });

  it("returns 'All Normal — Camp Good' when grazing quality is Good", () => {
    expect(campConditionDoneLabel("Good")).toBe("All Normal — Camp Good");
  });

  it("returns 'All Normal — Camp Good' for unknown / unrecognised values (safety default)", () => {
    // If a future grazing tier is added we'd rather over-praise than under-praise.
    expect(campConditionDoneLabel("Excellent")).toBe("All Normal — Camp Good");
    expect(campConditionDoneLabel("")).toBe("All Normal — Camp Good");
  });

  it("returns 'Done — no animals flagged' for Fair (must not lie about camp condition)", () => {
    expect(campConditionDoneLabel("Fair")).toBe("Done — no animals flagged");
  });

  it("returns 'Done — no animals flagged' for Poor", () => {
    expect(campConditionDoneLabel("Poor")).toBe("Done — no animals flagged");
  });

  it("returns 'Done — no animals flagged' for Overgrazed", () => {
    expect(campConditionDoneLabel("Overgrazed")).toBe("Done — no animals flagged");
  });

  it("is case-insensitive (handles DB / IndexedDB casing drift)", () => {
    // IndexedDB merges may have lowercased values; SQL inserts may have
    // mixed-case. Either way the label must reflect the underlying state.
    expect(campConditionDoneLabel("fair")).toBe("Done — no animals flagged");
    expect(campConditionDoneLabel("POOR")).toBe("Done — no animals flagged");
    expect(campConditionDoneLabel("overgrazed")).toBe("Done — no animals flagged");
    expect(campConditionDoneLabel("good")).toBe("All Normal — Camp Good");
  });
});
