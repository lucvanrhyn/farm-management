// lib/server/alerts/rotation-move-due.ts — ROTATION_MOVE_DUE.
//
// Proactive Nudges v1 (#nudges) — fires when a mob is overdue to move (its
// current camp is `overstayed` or `overdue_rest` while still occupied) AND a
// ready destination camp exists. The destination = the rotation engine's top
// recommendation, `nextToGraze[0]`. attachActions hangs a one-tap `camp_move`
// action off the candidate, pre-filling source + destination so the farmer
// confirms a move the engine already computed (targets are NEVER from the LLM).
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

  // The engine's top destination recommendation. No ready camp ⇒ nothing to
  // recommend, so we emit nothing rather than a move-to-nowhere nudge.
  const target = rotation.nextToGraze[0];
  if (!target) return [];

  const targetCamp = rotation.camps.find((c) => c.campId === target.campId);
  const targetName = targetCamp?.campName ?? target.campId;

  const now = new Date();
  const week = toIsoWeek(now);
  const expiresAt = defaultExpiry(now);
  const candidates: AlertCandidate[] = [];

  for (const camp of rotation.camps) {
    if (!MOVE_DUE_STATUSES.has(camp.status)) continue;
    // Only an OCCUPIED camp can have a mob that's overdue to move.
    const mob = camp.currentMobs[0];
    if (!mob) continue;
    // Don't recommend moving a mob into the camp it's already in.
    if (camp.campId === target.campId) continue;

    candidates.push({
      type: "ROTATION_MOVE_DUE",
      category: "veld",
      severity: camp.status === "overstayed" ? "red" : "amber",
      dedupKey: `ROTATION_MOVE_DUE:${camp.campId}:${week}`,
      collapseKey: "tenant",
      payload: {
        sourceCampId: camp.campId,
        sourceCampName: camp.campName,
        targetCampId: target.campId,
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
