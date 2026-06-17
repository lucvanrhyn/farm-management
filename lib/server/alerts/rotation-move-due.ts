// lib/server/alerts/rotation-move-due.ts — ROTATION_MOVE_DUE.
//
// Proactive Nudges v1 (#nudges) — fires when a mob is overdue to move (its
// current camp is `overstayed` or `overdue_rest` while still occupied) AND a
// ready destination camp exists. A rested camp can take only ONE mob, so each
// overdue mob is assigned a DISTINCT destination drawn from the engine's
// `nextToGraze` ranking (best-rested first); the most urgent mob picks first.
// attachActions hangs a one-tap `camp_move` action off the candidate, pre-filling
// source + destination so the farmer confirms a move the engine already computed
// (targets are NEVER from the LLM).
//
// This joins the EXISTING alerts/ pipeline (ADR-0011: no third generator
// family). It reuses the canonical rotation read model `getRotationStatusByCamp`
// (lib/domain/rotation/get-status.ts via the rotation-engine shim) — the same
// source the dashboard rotation alerts and the rotation planner use, so "who is
// overdue / where to move them" is computed in exactly one place.

import type { PrismaClient, FarmSettings } from "@prisma/client";
import type { AlertCandidate } from "./types";
import { defaultExpiry, toIsoWeek } from "./helpers";
import { getRotationStatusByCamp } from "@/lib/server/rotation-engine";
import { logger } from "@/lib/logger";

/** Statuses where the mob has stayed too long and should move. */
const MOVE_DUE_STATUSES = new Set(["overstayed", "overdue_rest"]);

export async function evaluate(
  prisma: PrismaClient,
  _settings: FarmSettings,
  farmSlug: string,
): Promise<AlertCandidate[]> {
  let rotation: Awaited<ReturnType<typeof getRotationStatusByCamp>>;
  try {
    rotation = await getRotationStatusByCamp(prisma);
  } catch (err) {
    logger.warn("[alerts:ROTATION_MOVE_DUE] rotation read failed on tenant — skipping", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  // No rested camp ⇒ nowhere to send anyone, so emit nothing rather than a
  // move-to-an-occupied-camp nudge.
  if (rotation.nextToGraze.length === 0) return [];

  const now = new Date();
  const week = toIsoWeek(now);
  const expiresAt = defaultExpiry(now);

  // Destinations are a CONSUMABLE pool drawn best-rested-first (the engine's
  // ranking) — a rested camp can receive only one mob. The most urgent mob
  // (overstayed before overdue_rest) picks first; once the pool is empty the
  // remaining overdue mobs emit nothing. This is what stops every overdue mob
  // from being routed to the single best camp (double-booking).
  const moveDueRank = (status: string): number =>
    status === "overstayed" ? 0 : 1;
  const overdue = rotation.camps
    .filter((c) => MOVE_DUE_STATUSES.has(c.status) && c.currentMobs[0])
    .sort((a, b) => moveDueRank(a.status) - moveDueRank(b.status));

  const available = [...rotation.nextToGraze];
  const candidates: AlertCandidate[] = [];

  for (const camp of overdue) {
    const mob = camp.currentMobs[0];
    if (!mob) continue; // the filter guarantees this; narrows the type for TS
    // Claim the best still-available destination that isn't this camp itself
    // (never recommend moving a mob into the camp it's already in).
    const destIdx = available.findIndex((d) => d.campId !== camp.campId);
    if (destIdx === -1) continue; // no distinct rested camp left for this mob
    const [dest] = available.splice(destIdx, 1);
    const targetCamp = rotation.camps.find((c) => c.campId === dest.campId);
    const targetName = targetCamp?.campName ?? dest.campId;

    candidates.push({
      type: "ROTATION_MOVE_DUE",
      category: "veld",
      severity: camp.status === "overstayed" ? "red" : "amber",
      dedupKey: `ROTATION_MOVE_DUE:${camp.campId}:${week}`,
      collapseKey: "tenant",
      payload: {
        sourceCampId: camp.campId,
        sourceCampName: camp.campName,
        targetCampId: dest.campId,
        targetCampName: targetName,
        mobId: mob.mobId ?? null,
        mobName: mob.mobName ?? null,
        status: camp.status,
      },
      message: `${mob.mobName ?? "Mob"} in "${camp.campName}" is overdue to move — "${targetName}" is rested and ready`,
      href: `/${farmSlug}/admin/camps?tab=rotation`,
      expiresAt,
    });
  }

  return candidates;
}
