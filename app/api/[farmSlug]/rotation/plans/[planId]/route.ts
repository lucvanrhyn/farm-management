/**
 * GET    /api/[farmSlug]/rotation/plans/[planId] — fetch a plan + steps.
 * PATCH  /api/[farmSlug]/rotation/plans/[planId] — update plan (ADMIN).
 * DELETE /api/[farmSlug]/rotation/plans/[planId] — delete plan + steps (ADMIN).
 *
 * Wave G2 (#166) — migrated onto `tenantReadSlug` / `adminWriteSlug`.
 *
 * Wire-shape preservation:
 *   - 200 / 201 shapes unchanged.
 *   - 404 "Plan not found" → `PLAN_NOT_FOUND` (typed).
 *   - 400 paths migrate to typed codes:
 *       * "Invalid status" → INVALID_STATUS `field=status, allowed=[...]`
 *       * "name cannot be blank" → BLANK_NAME
 *       * "Invalid startDate" → INVALID_DATE `field=startDate`
 *   - DELETE 200 `{ success: true }` shape unchanged.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug, adminWriteSlug } from "@/lib/server/route";
import { revalidateRotationWrite } from "@/lib/server/revalidate";
import {
  deleteRotationPlan,
  getRotationPlanOrThrow,
  updateRotationPlan,
  type UpdateRotationPlanInput,
} from "@/lib/domain/rotation";

export const dynamic = "force-dynamic";

type PlanParams = { farmSlug: string; planId: string };

export const GET = tenantReadSlug<PlanParams>({
  handle: async (ctx, _req, params) => {
    const plan = await getRotationPlanOrThrow(ctx.prisma, params.planId);
    return NextResponse.json(plan);
  },
});

export const PATCH = adminWriteSlug<UpdateRotationPlanInput, PlanParams>({
  revalidate: revalidateRotationWrite,
  handle: async (ctx, body, _req, params) => {
    const updated = await updateRotationPlan(ctx.prisma, params.planId, body);
    return NextResponse.json(updated);
  },
});

export const DELETE = adminWriteSlug<unknown, PlanParams>({
  revalidate: revalidateRotationWrite,
  handle: async (ctx, _body, _req, params) => {
    const result = await deleteRotationPlan(ctx.prisma, params.planId);
    return NextResponse.json(result);
  },
});
