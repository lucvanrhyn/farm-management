/**
 * @vitest-environment node
 *
 * __tests__/lib/logger-actions-mob-move.test.ts
 *
 * S8 / OS-2 — offline mob moves are queued and replayed, never dropped.
 *
 * Pre-S8 `submitMobMove` applied the camp change via an online-only
 * `PATCH /api/mobs/{id}` and queued the `mob_movement` observation ONLY after
 * a successful PATCH (`if (!res.ok) return { success: false }` / catch →
 * `{ success: false }`). Offline, the fetch throws and NOTHING is queued —
 * the move is silently lost (the UI shows "Move failed — try again" with no
 * carrier to replay).
 *
 * Post-S8 the queued observation is the SOLE durable carrier of the move:
 * it is queued REGARDLESS of the PATCH outcome, and the
 * `POST /api/observations` route's `mob_movement` branch applies the camp
 * change server-side on replay (see
 * `__tests__/api/observations-mob-movement.test.ts` — the route half).
 * The PATCH stays as the online fast path; its failure is no longer fatal.
 *
 * Result contract: `success: true` means "applied or queued for replay" —
 * the offline-first meaning every other logger submit uses. Only a failed
 * ENQUEUE (the move has no carrier at all) reports `success: false`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queueObservationMock } = vi.hoisted(() => ({
  queueObservationMock: vi.fn(async () => 1),
}));

vi.mock("@/lib/offline-store", () => ({
  queueObservation: queueObservationMock,
  queueAnimalCreate: vi.fn(async () => 1),
  queuePhoto: vi.fn(async () => {}),
}));

import { submitMobMove, type MobMoveData } from "@/lib/logger-actions";

const MOVE: MobMoveData = {
  mobId: "mob-1",
  mobName: "Heifer group",
  animalCount: 12,
  fromCampId: "camp-source",
  toCampId: "camp-dest",
};

function makeCtx(isOnline: boolean) {
  return {
    isOnline,
    refreshPendingCount: vi.fn(),
    syncNow: vi.fn(),
  };
}

/** The queued payload the route's replay branch derives the move from. */
function expectMobMovementQueued() {
  expect(queueObservationMock).toHaveBeenCalledTimes(1);
  const [queued] = queueObservationMock.mock.calls[0] as [
    {
      type: string;
      camp_id: string;
      details: string;
      sync_status: string;
    },
  ];
  expect(queued.type).toBe("mob_movement");
  expect(queued.camp_id).toBe("camp-source");
  expect(queued.sync_status).toBe("pending");
  expect(JSON.parse(queued.details)).toMatchObject({
    mobId: "mob-1",
    mobName: "Heifer group",
    sourceCamp: "camp-source",
    destCamp: "camp-dest",
    animalCount: 12,
  });
}

describe("submitMobMove (S8/OS-2)", () => {
  beforeEach(() => {
    queueObservationMock.mockClear();
    queueObservationMock.mockResolvedValue(1);
    vi.unstubAllGlobals();
  });

  it("queues the mob_movement when OFFLINE (fetch throws) and reports success — the move is never dropped", async () => {
    // The OS-2 repro: offline, the PATCH fetch rejects. Pre-S8 the catch
    // returned { success: false } without queueing anything — the move had
    // no carrier and was permanently lost.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const ctx = makeCtx(false);
    const result = await submitMobMove(MOVE, ctx);

    expect(result).toEqual({ success: true });
    expectMobMovementQueued();
    expect(ctx.refreshPendingCount).toHaveBeenCalledTimes(1);
    // Offline — no immediate drain attempt.
    expect(ctx.syncNow).not.toHaveBeenCalled();
  });

  it("still queues the observation when the PATCH succeeds (online fast path unchanged)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );

    const ctx = makeCtx(true);
    const result = await submitMobMove(MOVE, ctx);

    expect(result).toEqual({ success: true });
    expectMobMovementQueued();
    expect(ctx.syncNow).toHaveBeenCalledTimes(1);
  });

  it("queues the observation when the PATCH returns a non-ok status (transient server failure)", async () => {
    // A 500/throttle on the PATCH must not drop the move: the queued row is
    // the carrier, and the route's replay branch applies the camp change when
    // the drain next runs. (A terminally-invalid move — e.g. cross-species —
    // re-rejects on replay with a typed 422 and dead-letters with feedback,
    // which the server enforces either way.)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );

    const ctx = makeCtx(true);
    const result = await submitMobMove(MOVE, ctx);

    expect(result).toEqual({ success: true });
    expectMobMovementQueued();
  });

  it("reports failure ONLY when the enqueue itself fails (the move has no carrier)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    queueObservationMock.mockRejectedValueOnce(new Error("IDB unavailable"));

    const ctx = makeCtx(false);
    const result = await submitMobMove(MOVE, ctx);

    expect(result).toEqual({ success: false });
    expect(ctx.syncNow).not.toHaveBeenCalled();
  });
});
