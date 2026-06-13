import type { AnimalSex, EaseOfBirth } from "@/lib/types";
import type { FarmMode } from "@/lib/farm-mode";
import { queueObservation, queueAnimalCreate, queuePhoto } from "@/lib/offline-store";

// ── Mob move ──────────────────────────────────────────────────────────────────

export interface MobMoveData {
  readonly mobId: string;
  readonly mobName: string;
  readonly animalCount: number;
  readonly fromCampId: string;
  readonly toCampId: string;
}

interface MobMoveContext {
  readonly isOnline: boolean;
  readonly refreshPendingCount: () => void;
  readonly syncNow: () => void;
}

export interface MobMoveResult {
  readonly success: boolean;
}

/**
 * Executes a mob move.
 *
 * S8 / OS-2 — the queued `mob_movement` observation is the SOLE durable
 * carrier of the camp change: it is queued REGARDLESS of the PATCH outcome,
 * and the `POST /api/observations` route's `mob_movement` branch applies the
 * move server-side on replay (via `performMobMove`, mirroring the #100
 * `animal_movement` contract). Pre-S8 the observation was queued ONLY after a
 * successful `PATCH /api/mobs/{id}` — offline the fetch threw and NOTHING was
 * queued, so the move was silently dropped.
 *
 * The PATCH stays as the online fast path (instant camp change, no drain
 * wait). When both apply, the replayed observation hits `performMobMove`'s
 * same-camp guard and degrades to a plain audit row — idempotent. A
 * terminally-invalid move (e.g. cross-species) re-rejects on replay with a
 * typed 422 and dead-letters with feedback; the server enforces the block
 * either way.
 *
 * Result contract: `success: true` means "applied or queued for replay" (the
 * offline-first meaning every other logger submit uses). Only a failed
 * ENQUEUE — the move has no carrier at all — reports `success: false`.
 */
export async function submitMobMove(
  data: MobMoveData,
  ctx: MobMoveContext,
): Promise<MobMoveResult> {
  // Online fast path. A throw (offline/network) or a non-ok status is NOT
  // fatal — the queued observation below is the durable carrier and the
  // observations route applies the move on replay.
  try {
    await fetch(`/api/mobs/${data.mobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentCamp: data.toCampId }),
    });
  } catch {
    // Offline — deliberately ignored; the queue carries the move (OS-2).
  }

  try {
    await queueObservation({
      type: "mob_movement",
      camp_id: data.fromCampId,
      details: JSON.stringify({
        mobId: data.mobId,
        mobName: data.mobName,
        sourceCamp: data.fromCampId,
        destCamp: data.toCampId,
        animalCount: data.animalCount,
      }),
      created_at: new Date().toISOString(),
      synced_at: null,
      sync_status: "pending",
    });
  } catch {
    // The enqueue itself failed (IDB unavailable) — the move has NO carrier,
    // which is the one genuinely-failed outcome the caller must surface.
    return { success: false };
  }

  ctx.refreshPendingCount();
  if (ctx.isOnline) ctx.syncNow();
  return { success: true };
}

export interface CalvingData {
  readonly animalId: string;
  readonly campId: string;
  readonly calfAnimalId: string;
  readonly calfName: string;
  readonly calfSex: AnimalSex;
  readonly calfAlive: boolean;
  readonly easeOfBirth: EaseOfBirth;
  readonly fatherId: string | null;
  readonly dateOfBirth: string;
  readonly breed: string;
  readonly category: string;
  readonly photoBlob: Blob | null;
  readonly calvingDifficulty: number;
  readonly birthWeight: number | null;
}

interface CalvingContext {
  readonly mode: FarmMode;
  readonly campId: string;
  readonly isOnline: boolean;
  readonly markAnimalFlagged: (animalId: string) => void;
  readonly refreshPendingCount: () => void;
  readonly syncNow: () => void;
}

export async function submitCalvingObservation(
  data: CalvingData,
  ctx: CalvingContext,
): Promise<void> {
  const { photoBlob, ...obsData } = data;
  const now = new Date().toISOString();

  // Queue the calving observation (offline-safe)
  const localId = await queueObservation({
    type: "calving",
    camp_id: ctx.campId,
    animal_id: data.animalId,
    details: JSON.stringify(obsData),
    created_at: now,
    synced_at: null,
    sync_status: "pending",
  });
  if (photoBlob) await queuePhoto(localId, photoBlob).catch(() => {/* non-fatal */});

  // Create the new calf animal record if alive
  if (data.calfAlive) {
    const calfPayload = {
      animalId: data.calfAnimalId,
      name: data.calfName || null,
      sex: data.calfSex,
      category: data.category || "Calf",
      currentCamp: ctx.campId,
      motherId: data.animalId,
      fatherId: data.fatherId || null,
      dateOfBirth: data.dateOfBirth,
      dateAdded: data.dateOfBirth,
      breed: data.breed || "",
      status: "Active",
      species: ctx.mode,
    };

    // Issue #207 — mount-stable idempotency key for the calf create. Generated
    // once per calving submit; carried by both the in-flight POST and the
    // offline queue fallback so a retry (network blip mid-POST, browser close
    // before queue drain) collapses to a single Animal row via the server-side
    // `Animal.clientLocalId` upsert.
    const calfClientLocalId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : undefined;

    const queuedCalf = {
      animal_id: data.calfAnimalId,
      name: data.calfName || undefined,
      sex: data.calfSex,
      category: data.category || "Calf",
      current_camp: ctx.campId,
      mother_id: data.animalId,
      date_added: data.dateOfBirth,
      // Issue #424 — active FarmMode MUST ride along through the queue. The
      // server-side `createAnimal` op defaults missing `species` to "cattle";
      // on a sheep/game tenant that makes the offline-queued lamb invisible
      // because `animal-search.ts` filters `species: mode`. Pair edit lives
      // in `lib/sync-manager.ts` (`uploadAnimalCreate`) — both sides covered
      // by the contract test at `__tests__/sync/calf-payload-contract.test.ts`.
      species: ctx.mode,
      sync_status: "pending" as const,
      clientLocalId: calfClientLocalId,
    };

    if (ctx.isOnline) {
      // Attempt immediate POST — fall back to queue on failure
      try {
        const res = await fetch("/api/animals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...calfPayload,
            clientLocalId: calfClientLocalId,
          }),
        });
        if (!res.ok) throw new Error("POST failed");
      } catch {
        await queueAnimalCreate(queuedCalf);
      }
    } else {
      await queueAnimalCreate(queuedCalf);
    }
  }

  ctx.markAnimalFlagged(data.animalId);
  ctx.refreshPendingCount();
  if (ctx.isOnline) ctx.syncNow();
}
