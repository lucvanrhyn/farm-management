/**
 * POST /api/[farmSlug]/rotation/plans/[planId]/steps — append step
 *                                                       (ADMIN).
 * PUT  /api/[farmSlug]/rotation/plans/[planId]/steps — reorder pending
 *                                                       steps (ADMIN).
 *
 * Wave G2 (#166) — migrated onto `adminWriteSlug`.
 *
 * Wire-shape preservation:
 *   - 201 step shape unchanged.
 *   - 200 reordered-steps shape unchanged.
 *   - 404 "Plan not found" → `PLAN_NOT_FOUND` (typed).
 *   - 400 validation paths migrate to typed codes:
 *       * "campId is required"     → MISSING_FIELD `field=campId`
 *       * "plannedStart is required" → MISSING_FIELD `field=plannedStart`
 *       * "plannedStart is invalid" → INVALID_DATE `field=plannedStart`
 *       * "plannedDays must be ..." → INVALID_PLANNED_DAYS
 *       * "order must be ..." (any) → INVALID_ORDER `expected, actual`
 */
import { NextResponse } from "next/server";

import { adminWriteSlug } from "@/lib/server/route";
import { revalidateRotationWrite } from "@/lib/server/revalidate";
import {
  addRotationPlanStep,
  reorderRotationPlanSteps,
  type AddRotationPlanStepInput,
  type ReorderRotationPlanStepsInput,
} from "@/lib/domain/rotation";

export const dynamic = "force-dynamic";

type StepsParams = { farmSlug: string; planId: string };

export const POST = adminWriteSlug<AddRotationPlanStepInput, StepsParams>({
  revalidate: revalidateRotationWrite,
  handle: async (ctx, body, _req, params) => {
    const step = await addRotationPlanStep(ctx.prisma, params.planId, body);
    return NextResponse.json(step, { status: 201 });
  },
});

export const PUT = adminWriteSlug<ReorderRotationPlanStepsInput, StepsParams>({
  revalidate: revalidateRotationWrite,
  handle: async (ctx, body, _req, params) => {
    const steps = await reorderRotationPlanSteps(
      ctx.prisma,
      params.planId,
      body,
    );
    return NextResponse.json(steps);
  },
});
