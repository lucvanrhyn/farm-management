// lib/server/alerts/rotation-move-due.ts — ROTATION_MOVE_DUE.
//
// Proactive Nudges v1 (#nudges) — fires when a mob is overdue to move (its
// current camp is `overstayed` or `overdue_rest` while still occupied) AND a
// ready destination camp exists. A rested camp can take only ONE mob, so each
// overdue mob is assigned a DISTINCT destination drawn from the engine's
// `nextToGraze` ranking (best-rested first); when ready camps are scarce the
// most-overdue mob (highest daysGrazed) picks first. attachActions hangs a
// one-tap `camp_move` action off the candidate, pre-filling source + destination
// so the farmer confirms a move the engine already computed (targets are NEVER
// from the LLM).
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
import { crossSpecies } from "@/lib/server/species-scoped-prisma";
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

  // Species is a hard partition (Camp is keyed on (species, campId)): a cattle
  // mob must never be routed into a sheep camp. nextToGraze carries only campId,
  // so resolve each camp's species here. Fail-OPEN when a species is unknown
  // (prod always has Camp.species NOT NULL; only test fixtures omit it) — a
  // destination is excluded ONLY when we positively know it is a different
  // species, so a legitimate move is never suppressed.
  let campSpecies = new Map<string, string>();
  try {
    const campRows = await crossSpecies(prisma, "analytics-rollup").camp.findMany({
      select: { campId: true, species: true },
    });
    campSpecies = new Map(campRows.map((c) => [c.campId, c.species]));
  } catch {
    // leave map empty → no species filtering (fail-open)
  }

  const now = new Date();
  const week = toIsoWeek(now);
  const expiresAt = defaultExpiry(now);

  // Destinations are a CONSUMABLE pool drawn best-rested-first (the engine's
  // ranking) — a rested camp can receive only one mob. This is what stops every
  // overdue mob from being routed to the single best camp (double-booking).
  //
  // When ready camps are scarcer than overdue mobs, the MOST overdue mob picks
  // first: sort by daysGrazed desc (longest past its grazing window), with
  // campId as a stable final tiebreak so the allocation is deterministic across
  // cron runs (a camp must not flip between "move now" and "nothing" on DB row
  // order — there is no orderBy upstream). MOVE_DUE_STATUSES keeps "overdue_rest"
  // defensively, but classifyCampStatus only marks an OCCUPIED camp "overstayed",
  // so every source that survives the currentMobs filter is overstayed in
  // practice — hence we rank by overdue-ness, not status severity.
  const overdue = rotation.camps
    .filter((c) => MOVE_DUE_STATUSES.has(c.status) && c.currentMobs[0])
    .sort((a, b) => {
      const da = a.daysGrazed ?? -1;
      const db = b.daysGrazed ?? -1;
      if (db !== da) return db - da; // most overdue first
      return a.campId < b.campId ? -1 : a.campId > b.campId ? 1 : 0; // stable
    });

  const available = [...rotation.nextToGraze];
  const candidates: AlertCandidate[] = [];

  for (const camp of overdue) {
    const mob = camp.currentMobs[0];
    if (!mob) continue; // the filter guarantees this; narrows the type for TS
    const mobSpecies = mob.species ?? campSpecies.get(camp.campId) ?? null;
    // Claim the best still-available destination that isn't this camp itself
    // (never recommend moving a mob into the camp it's already in) AND that is
    // the same species as the mob (hard partition; fail-open on unknown species).
    const destIdx = available.findIndex((d) => {
      if (d.campId === camp.campId) return false;
      const destSpecies = campSpecies.get(d.campId) ?? null;
      if (mobSpecies && destSpecies && destSpecies !== mobSpecies) return false;
      return true;
    });
    if (destIdx === -1) continue; // no distinct same-species rested camp for this mob
    const [dest] = available.splice(destIdx, 1);
    const targetCamp = rotation.camps.find((c) => c.campId === dest.campId);
    const targetName = targetCamp?.campName ?? dest.campId;

    candidates.push({
      type: "ROTATION_MOVE_DUE",
      category: "veld",
      severity: camp.status === "overstayed" ? "red" : "amber",
      dedupKey: `ROTATION_MOVE_DUE:${camp.campId}:${week}`,
      // Per-source-camp collapse key (NOT "tenant"): each overdue mob is a
      // DISTINCT physical move to a DISTINCT destination (#572). A tenant-wide
      // key let collapseCandidates fold ≥3 moves into one notification that kept
      // only the first mob's action, discarding the rest — undoing #572 at the
      // multi-mob case. A per-camp key keeps every move individually actionable.
      collapseKey: `rotation:${camp.campId}`,
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
