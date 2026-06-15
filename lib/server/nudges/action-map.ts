// lib/server/nudges/action-map.ts — Proactive Nudges v1 deterministic action map.
//
// Maps an AlertCandidate `type` to a one-tap RecommendedAction. The table is
// FIXED and DETERMINISTIC: the action's taskType is hard-coded per type, and its
// `target` + `prefill` are pulled out of the alert-engine `payload` — NEVER the
// LLM. The LLM (Einstein) only ever narrates "why now" (decision 9); it never
// chooses what the action does or which animal/camp it points at.
//
// Six types map to actions (decision 3); every other signal is info-only and
// returns null (LSU_OVERSTOCK, PREDATOR_SPIKE, SPI_DROUGHT, RAINFALL_NOT_LOGGED,
// COVER_READING_STALE_21D, COG_EXCEEDS_BREAKEVEN, LAMBING_DUE_7D, FAWNING_DUE).
//
// New module under lib/server/nudges/ on purpose — adding exports to the
// heavily-mocked hot modules (cached / farm-prisma / dashboard-alerts /
// rotation-engine) would break every vi.mock factory (feedback-vi-mock-mass-patch).

import type { AlertCandidate, RecommendedAction } from "@/lib/server/alerts";

/** Context the action map needs that isn't on the candidate itself. */
export interface ActionMapContext {
  farmSlug: string;
  /** Farm subscription tier — gates the IT3 action (Advanced-only preview). */
  tier: string;
}

interface NudgePayload {
  animalId?: string;
  animalInternalId?: string;
  campId?: string;
  campName?: string;
  waterPointId?: string;
  name?: string;
  sourceCampId?: string;
  sourceCampName?: string;
  targetCampId?: string;
  targetCampName?: string;
  mobId?: string | null;
  mobName?: string | null;
  deadline?: string;
  dueDate?: string;
  [key: string]: unknown;
}

/** SA farming IT3 tax year = the calendar year of the Feb-28 year-end. */
function taxYearFromDeadline(deadline: string | undefined, now: Date): number {
  if (deadline) {
    const y = Number(deadline.slice(0, 4));
    if (Number.isFinite(y)) return y;
  }
  // Fallback: if before Mar 1, the current tax year ends this Feb; else next.
  const year = now.getUTCFullYear();
  return now.getUTCMonth() <= 1 ? year : year + 1;
}

/**
 * The deterministic mapping. Returns the action for a mapped candidate type, or
 * `null` for info-only signals / unknown types.
 */
export function mapAction(
  candidate: AlertCandidate,
  ctx: ActionMapContext,
  now: Date = new Date(),
): RecommendedAction | null {
  const p = candidate.payload as NudgePayload;

  switch (candidate.type) {
    case "NO_WEIGHING_90D": {
      const target = p.animalInternalId ?? p.animalId;
      if (!target) return null;
      return {
        taskType: "weighing",
        target: { animalId: target },
        prefill: { animalId: p.animalId ?? target },
        label: `Weigh ${p.animalId ?? "animal"}`,
      };
    }

    case "SHEARING_DUE":
    case "CRUTCHING_DUE": {
      const target = p.animalInternalId ?? p.animalId;
      if (!target) return null;
      return {
        taskType: "shearing",
        target: { animalId: target },
        prefill: { animalId: p.animalId ?? target },
        label: `Shear ${p.animalId ?? "ewe"}`,
      };
    }

    case "WATER_SERVICE_OVERDUE_30D": {
      // Covers both WATER_SERVICE_OVERDUE_30D and the WATER_SERVICE_NON_OP
      // variant (same generator, same `type`).
      if (!p.waterPointId) return null;
      return {
        taskType: "water_point_service",
        target: { waterPointId: p.waterPointId, ...(p.campId ? { campId: p.campId } : {}) },
        prefill: { waterPointId: p.waterPointId, name: p.name ?? null },
        label: `Service ${p.name ?? "water point"}`,
      };
    }

    case "NEEDS_INSPECTION_DUE": {
      if (!p.campId) return null;
      return {
        taskType: "camp_inspection",
        target: { campId: p.campId },
        prefill: { campId: p.campId },
        label: `Inspect ${p.campName ?? "camp"}`,
      };
    }

    case "ROTATION_MOVE_DUE": {
      // Target = the destination camp the rotation engine recommended.
      if (!p.targetCampId) return null;
      return {
        taskType: "camp_move",
        target: { campId: p.targetCampId },
        prefill: {
          sourceCampId: p.sourceCampId ?? null,
          targetCampId: p.targetCampId,
          mobId: p.mobId ?? null,
        },
        label: `Move ${p.mobName ?? "mob"} to ${p.targetCampName ?? "camp"}`,
      };
    }

    case "TAX_DEADLINE_IT3": {
      // IT3 preview is Advanced-tier gated (the route returns 403 for
      // non-advanced). Strict "advanced" check matches the preview route's
      // `creds.tier !== "advanced"` gate exactly.
      const taxYear = taxYearFromDeadline(p.deadline, now);
      const upgradeGated = ctx.tier !== "advanced";
      return {
        taskType: "it3",
        target: {},
        prefill: { taxYear },
        label: upgradeGated
          ? "Upgrade to file IT3"
          : `Prepare IT3 for ${taxYear}`,
        ...(upgradeGated ? { upgradeGated: true } : {}),
      };
    }

    default:
      return null;
  }
}

/**
 * Enrich each candidate with its action (where one maps), merged into BOTH the
 * typed `action` field and `payload.action` (so it survives the
 * Notification.payload round-trip + dedup collapse). PURE — returns new
 * candidate objects, never mutates the inputs (immutability rule).
 */
export function attachActions(
  candidates: AlertCandidate[],
  ctx: ActionMapContext,
  now: Date = new Date(),
): AlertCandidate[] {
  return candidates.map((c) => {
    const action = mapAction(c, ctx, now);
    if (!action) return c;
    // Stamp `category` (and a `dueDate` for deadline-bearing nudges) into the
    // payload alongside the action so the do-next feed (lib/server/nudges/feed.ts)
    // can rank by category weight + due-date proximity off the persisted row
    // (the Notification has no category/dueDate column — only payload JSON).
    const p = c.payload as NudgePayload;
    const dueDate = p.deadline ?? (typeof p.dueDate === "string" ? p.dueDate : undefined);
    return {
      ...c,
      action,
      payload: {
        ...c.payload,
        action,
        category: c.category,
        ...(dueDate ? { dueDate } : {}),
      },
    };
  });
}
