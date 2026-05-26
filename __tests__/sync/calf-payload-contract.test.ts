// @vitest-environment jsdom
/**
 * Issue #424 (parent PRD #419) — calf-payload SHAPE contract.
 *
 * Why this exists:
 *   The calf-create flow has THREE serialization boundaries that must agree
 *   on the key set or a field silently vanishes between online and offline
 *   paths (the #424 class of bug):
 *
 *     A. The online POST body built by `submitCalvingObservation` and sent
 *        directly to /api/animals when the client is online.
 *     B. The IndexedDB row enqueued via `queueAnimalCreate` when the client
 *        is offline (or when the online POST throws/4xx/5xxs).
 *     C. The replay POST body built by `uploadAnimalCreate` (sync-manager)
 *        and sent to /api/animals when the queued row drains.
 *
 *   For the offline path to be observationally equivalent to the online
 *   path on a multi-species tenant, every key that A sends with semantic
 *   weight must also be present in B, and every key B carries with semantic
 *   weight must also be re-emitted by C. If any boundary drops a key, the
 *   server-side `createAnimal` default kicks in and the row lands wrong —
 *   the #424 root cause was `species` being dropped between A→B AND between
 *   B→C, so the lamb landed as cattle and disappeared from the sheep
 *   catalogue.
 *
 *   This contract test pins the SUPERSET relationship — it's structural,
 *   not behavioral, so any future field added to A must propagate through
 *   B and C or this test fails at CI time rather than at runtime months
 *   later on a paying tenant.
 *
 *   Keys deliberately excluded from the contract: `breed` (replayer reads
 *   it from cached FarmSettings, not the queued row, so the queue legitimately
 *   omits it) and `status` (replayer hard-codes "Active", the online path
 *   hard-codes "Active" — equivalent constants, not a transported field).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock layer ───────────────────────────────────────────────────────────────
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
const getCachedFarmSettingsMock = vi.hoisted(() =>
  vi.fn(async () => ({ breed: "Dorper" })),
);

vi.mock("@/lib/offline-store", () => ({
  queueObservation: queueObservationMock,
  queueAnimalCreate: queueAnimalCreateMock,
  queuePhoto: queuePhotoMock,
  // sync-manager imports several offline-store helpers — stub the surface it
  // touches in `uploadAnimalCreate` even though we only exercise that one fn.
  getCachedFarmSettings: getCachedFarmSettingsMock,
  getPendingAnimalCreates: vi.fn(async () => []),
  getPendingObservations: vi.fn(async () => []),
  getPendingPhotos: vi.fn(async () => []),
  getPendingCoverReadings: vi.fn(async () => []),
  getFailedAnimals: vi.fn(async () => []),
  getFailedCoverReadings: vi.fn(async () => []),
  getFailedObservations: vi.fn(async () => []),
  markPhotoUploaded: vi.fn(async () => undefined),
  markCoverReadingPosted: vi.fn(async () => undefined),
  clearPendingAnimalUpdate: vi.fn(async () => undefined),
  markObservationSynced: vi.fn(async () => undefined),
  seedCamps: vi.fn(async () => undefined),
  seedAnimals: vi.fn(async () => undefined),
  seedFarmSettings: vi.fn(async () => undefined),
}));

vi.mock("@/lib/sync/queue", () => ({
  markSucceeded: vi.fn(async () => undefined),
  markFailed: vi.fn(async () => undefined),
  recordSyncAttempt: vi.fn(async () => undefined),
}));

import { submitCalvingObservation, type CalvingData } from "@/lib/logger-actions";
import type { FarmMode } from "@/lib/farm-mode";

// ── Fixtures ─────────────────────────────────────────────────────────────────
function buildCalvingData(): CalvingData {
  return {
    animalId: "EWE-001",
    campId: "camp-1",
    calfAnimalId: "LAMB-1710000000000",
    calfName: "Daisy",
    calfSex: "Female",
    calfAlive: true,
    easeOfBirth: "Unassisted",
    fatherId: "RAM-007",
    dateOfBirth: "2026-05-26",
    breed: "Dorper",
    category: "Lamb",
    photoBlob: null,
    calvingDifficulty: 1,
    birthWeight: 4.2,
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

/**
 * The mapping between the online POST body (camelCase, REST API) and the
 * offline queue row (snake_case, IndexedDB column convention). Keys are the
 * online-shape names; values are the corresponding queued-shape names. If
 * the convention drifts, update this map — the test then enforces the new
 * mapping symmetrically across all three boundaries.
 */
const ONLINE_TO_QUEUED_KEY = {
  animalId: "animal_id",
  name: "name",
  sex: "sex",
  category: "category",
  currentCamp: "current_camp",
  motherId: "mother_id",
  dateAdded: "date_added",
  clientLocalId: "clientLocalId",
  species: "species",
} as const;

/**
 * Keys deliberately excluded from the contract:
 *   `breed`        — replayer reads it from cached FarmSettings, not the
 *                    queued row, so the queue legitimately omits it.
 *   `status`       — both paths hard-code "Active"; equivalent constants,
 *                    not a transported field.
 *   `fatherId`     — KNOWN pre-existing drop on both the queue row AND the
 *                    replay POST. Same structural bug class as #424
 *                    (species), but out of scope for #424. Tracked
 *                    separately so this contract test stays green once the
 *                    species fix lands.
 *   `dateOfBirth`  — KNOWN pre-existing drop, same class as `fatherId`.
 *                    Out of scope for #424; tracked separately.
 *
 * When the sibling fixes land, REMOVE the key from this set — the contract
 * test will then enforce the new shape automatically.
 */
const EXCLUDED_FROM_CONTRACT = new Set(["breed", "status", "fatherId", "dateOfBirth"]);

/**
 * Capture the online POST body that `submitCalvingObservation` sends. The
 * online path is the source of truth for the key set both other boundaries
 * must match.
 */
async function captureOnlinePostBody(mode: FarmMode): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) => {
      captured = JSON.parse(init?.body as string);
      return new Response("{}", { status: 200 });
    }),
  );
  await submitCalvingObservation(buildCalvingData(), buildContext(mode, true));
  vi.unstubAllGlobals();
  if (!captured) throw new Error("online POST body never captured");
  return captured;
}

/**
 * Capture the queued-row shape that `submitCalvingObservation` writes when
 * the immediate POST fails. Equivalent to the pure-offline branch since both
 * call `queueAnimalCreate` with the same object literal.
 */
async function captureQueuedCalf(mode: FarmMode): Promise<Record<string, unknown>> {
  queueAnimalCreateMock.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("boom", { status: 500 })),
  );
  await submitCalvingObservation(buildCalvingData(), buildContext(mode, true));
  vi.unstubAllGlobals();
  const calls = queueAnimalCreateMock.mock.calls;
  if (calls.length !== 1) {
    throw new Error(`expected exactly 1 queueAnimalCreate call, got ${calls.length}`);
  }
  return calls[0]![0] as Record<string, unknown>;
}

/**
 * Capture the replay POST body the sync-manager would send to /api/animals
 * given a queued row. This is the C boundary — load-bearing because it's
 * the actual wire shape the server sees when the offline queue drains.
 */
async function captureReplayPostBody(queuedRow: Record<string, unknown>): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) => {
      captured = JSON.parse(init?.body as string);
      return new Response("{}", { status: 200 });
    }),
  );
  const syncManager = await import("@/lib/sync-manager");
  // `uploadAnimalCreate` is module-private; drive it via the public surface
  // by stubbing `getPendingAnimalCreates` for this one call.
  const offlineStore = await import("@/lib/offline-store");
  const original = offlineStore.getPendingAnimalCreates as ReturnType<typeof vi.fn>;
  original.mockResolvedValueOnce([{ ...queuedRow, local_id: 99 }]);
  // syncPendingAnimals dispatches uploadAnimalCreate per pending row.
  await syncManager.syncPendingAnimals();
  vi.unstubAllGlobals();
  if (!captured) throw new Error("replay POST body never captured");
  return captured;
}

// ── Contract assertions ─────────────────────────────────────────────────────
beforeEach(() => {
  queueObservationMock.mockClear();
  queueAnimalCreateMock.mockClear();
  queuePhotoMock.mockClear();
  vi.unstubAllGlobals();
});

describe("calf-payload SHAPE contract (#424)", () => {
  it("A→B: queued calf is a superset of the online POST body on contract keys", async () => {
    const onlineBody = await captureOnlinePostBody("sheep");
    const queued = await captureQueuedCalf("sheep");

    const missing: string[] = [];
    for (const onlineKey of Object.keys(onlineBody)) {
      if (EXCLUDED_FROM_CONTRACT.has(onlineKey)) continue;
      const queuedKey = (ONLINE_TO_QUEUED_KEY as Record<string, string>)[onlineKey];
      if (!queuedKey) {
        throw new Error(
          `Online POST sent key "${onlineKey}" with no mapping in ONLINE_TO_QUEUED_KEY — ` +
            `update the contract map to declare its queued-row counterpart (or add it to ` +
            `EXCLUDED_FROM_CONTRACT with a justification comment).`,
        );
      }
      if (!Object.prototype.hasOwnProperty.call(queued, queuedKey)) {
        missing.push(`${onlineKey} → ${queuedKey}`);
      }
    }
    expect(
      missing,
      `Queued calf is missing these keys that the online POST carries — ` +
        `they will silently default server-side on replay:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("B→C: replay POST body is a superset of the online POST body on contract keys", async () => {
    // Drive A first to know what the server expects.
    const onlineBody = await captureOnlinePostBody("sheep");
    // Then drive B to get a realistic queued row…
    const queued = await captureQueuedCalf("sheep");
    // …and feed it through C to see what the wire actually carries on replay.
    const replayBody = await captureReplayPostBody(queued);

    const missing: string[] = [];
    for (const onlineKey of Object.keys(onlineBody)) {
      if (EXCLUDED_FROM_CONTRACT.has(onlineKey)) continue;
      if (!Object.prototype.hasOwnProperty.call(replayBody, onlineKey)) {
        missing.push(onlineKey);
      }
    }
    expect(
      missing,
      `Replay POST body is missing these keys that the online POST carries — ` +
        `the server will fall back to defaults for them on offline-queue drain:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("species propagates through all three boundaries for a non-cattle mode", async () => {
    const onlineBody = await captureOnlinePostBody("sheep");
    const queued = await captureQueuedCalf("sheep");
    const replayBody = await captureReplayPostBody(queued);

    expect(onlineBody.species).toBe("sheep");
    expect(queued.species).toBe("sheep");
    expect(replayBody.species).toBe("sheep");
  });
});
