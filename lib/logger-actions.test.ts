// @vitest-environment jsdom
/**
 * Issue #424 (parent PRD #419) — offline-queued calf must carry `species`.
 *
 * Root cause: `submitCalvingObservation` builds an online `calfPayload` that
 * includes `species: ctx.mode` (sent verbatim to POST /api/animals), but the
 * sibling `queuedCalf` object — used when the immediate POST fails or the
 * client is offline — silently omits `species`. The sync-manager replay
 * (`uploadAnimalCreate`) then constructs a POST body that defaults to no
 * species, server-side `createAnimal` falls back to `"cattle"`, and on a
 * multi-species tenant in non-cattle mode the lamb/kid is silently invisible
 * because `animal-search.ts` filters `species: mode`.
 *
 * These tests pin that the offline-queue payload carries `species` matching
 * the active FarmMode in both fallback branches (online-POST-throws and
 * client-offline). They are the unit-level half of the regression lockout —
 * the structural superset contract lives in
 * `__tests__/sync/calf-payload-contract.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type AnyArgs = readonly unknown[];
const queueObservationMock = vi.hoisted(() =>
  vi.fn<(...args: AnyArgs) => Promise<number>>(async () => 1),
);
const queueAnimalCreateMock = vi.hoisted(() =>
  vi.fn<(...args: AnyArgs) => Promise<number>>(async () => 2),
);
const queuePhotoMock = vi.hoisted(() =>
  vi.fn<(...args: AnyArgs) => Promise<number>>(async () => 3),
);

vi.mock("@/lib/offline-store", () => ({
  queueObservation: queueObservationMock,
  queueAnimalCreate: queueAnimalCreateMock,
  queuePhoto: queuePhotoMock,
}));

import { submitCalvingObservation, type CalvingData } from "@/lib/logger-actions";
import type { FarmMode } from "@/lib/farm-mode";

function buildCalvingData(overrides: Partial<CalvingData> = {}): CalvingData {
  return {
    animalId: "EWE-001",
    campId: "camp-1",
    calfAnimalId: "LAMB-1710000000000",
    calfName: "",
    calfSex: "Female",
    calfAlive: true,
    easeOfBirth: "Unassisted",
    fatherId: null,
    dateOfBirth: "2026-05-26",
    breed: "Dorper",
    category: "Lamb",
    photoBlob: null,
    calvingDifficulty: 1,
    birthWeight: 4.2,
    ...overrides,
  };
}

function buildContext(mode: FarmMode, isOnline: boolean) {
  return {
    mode,
    campId: "camp-1",
    isOnline,
    markAnimalFlagged: vi.fn(),
    refreshPendingCount: vi.fn(),
    syncNow: vi.fn(),
  };
}

beforeEach(() => {
  queueObservationMock.mockClear();
  queueAnimalCreateMock.mockClear();
  queuePhotoMock.mockClear();
  vi.unstubAllGlobals();
});

describe("submitCalvingObservation — offline-queued calf species (#424)", () => {
  it("offline path: queued calf carries species matching FarmMode (sheep)", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await submitCalvingObservation(buildCalvingData(), buildContext("sheep", false));

    expect(queueAnimalCreateMock).toHaveBeenCalledTimes(1);
    const queued = queueAnimalCreateMock.mock.calls[0][0];
    expect(queued).toMatchObject({ species: "sheep" });
  });

  it("online-failure fallback: queued calf carries species matching FarmMode (sheep)", async () => {
    // Online POST fails — should fall back to the queue with `species` intact.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    await submitCalvingObservation(buildCalvingData(), buildContext("sheep", true));

    expect(queueAnimalCreateMock).toHaveBeenCalledTimes(1);
    const queued = queueAnimalCreateMock.mock.calls[0][0];
    expect(queued).toMatchObject({ species: "sheep" });
  });

  it("offline path: queued calf carries species for cattle mode (regression-safe default)", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await submitCalvingObservation(buildCalvingData(), buildContext("cattle", false));

    expect(queueAnimalCreateMock).toHaveBeenCalledTimes(1);
    const queued = queueAnimalCreateMock.mock.calls[0][0];
    expect(queued).toMatchObject({ species: "cattle" });
  });

  it("offline path: queued calf carries species for game mode", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await submitCalvingObservation(buildCalvingData(), buildContext("game", false));

    expect(queueAnimalCreateMock).toHaveBeenCalledTimes(1);
    const queued = queueAnimalCreateMock.mock.calls[0][0];
    expect(queued).toMatchObject({ species: "game" });
  });
});
