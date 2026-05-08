/**
 * POST /api/[farmSlug]/rotation/plans/[planId]/steps/[stepId]/execute —
 * execute a pending step (move the mob to the step's camp + mark
 * executed). ADMIN, fresh-admin re-verified.
 *
 * Wave G2 (#166) — migrated onto `adminWriteSlug`.
 *
 * Wire-shape preservation:
 *   - 200 `{ step, move: {...} }` shape unchanged.
 *   - 404 "Step not found" → `STEP_NOT_FOUND`.
 *   - 409 "Step is already <status>" → `STEP_ALREADY_EXECUTED`
 *     (with `details.currentStatus`).
 *   - 400 "mobId is required" → `MISSING_MOB_ID`.
 *   - 404 "Mob not found" passes through unchanged (mapped from
 *     `MobNotFoundError` by `mapApiDomainError` since Wave A).
 *   - 409 "already in camp" → `MOB_ALREADY_IN_CAMP` (typed).
 */
import { NextResponse } from "next/server";

import { adminWriteSlug } from "@/lib/server/route";
import { revalidateRotationWrite } from "@/lib/server/revalidate";
import { executeRotationPlanStep } from "@/lib/domain/rotation";

export const dynamic = "force-dynamic";

interface ExecuteBody {
  mobId?: string;
}

type ExecuteParams = { farmSlug: string; planId: string; stepId: string };

export const POST = adminWriteSlug<ExecuteBody, ExecuteParams>({
  revalidate: revalidateRotationWrite,
  handle: async (ctx, body, _req, params) => {
    const result = await executeRotationPlanStep(
      ctx.prisma,
      params.planId,
      params.stepId,
      {
        mobId: body.mobId,
        loggedBy: ctx.session.user?.email ?? null,
      },
    );
    return NextResponse.json(result);
  },
});
