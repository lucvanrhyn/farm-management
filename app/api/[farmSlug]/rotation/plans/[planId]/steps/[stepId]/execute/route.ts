import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForSlugWithAuth } from "@/lib/farm-prisma";
import { verifyFreshAdminRole } from "@/lib/auth";
import { performMobMove, MobNotFoundError } from "@/lib/server/mob-move";
import { revalidateRotationWrite } from "@/lib/server/revalidate";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; planId: string; stepId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug, planId, stepId } = await params;
  const _auth = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in _auth) return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  if (_auth.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, _auth.slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const prisma = _auth.prisma;

  // Load step and verify it belongs to the plan
  const step = await prisma.rotationPlanStep.findUnique({ where: { id: stepId } });
  if (!step || step.planId !== planId) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }
  if (step.status !== "pending") {
    return NextResponse.json(
      { error: `Step is already ${step.status} and cannot be executed again` },
      { status: 409 },
    );
  }

  // Resolve mobId: prefer body.mobId, fall back to step.mobId
  const body = (await req.json()) as { mobId?: string };
  const mobId = body.mobId ?? step.mobId;
  if (!mobId || typeof mobId !== "string") {
    return NextResponse.json(
      { error: "mobId is required (step has no default mob; provide one in the request body)" },
      { status: 400 },
    );
  }

  const loggedBy = session.user?.email ?? null;

  // Perform the actual mob move
  let moveResult;
  try {
    moveResult = await performMobMove(prisma, {
      mobId,
      toCampId: step.campId,
      loggedBy,
    });
  } catch (err) {
    if (err instanceof MobNotFoundError) {
      return NextResponse.json({ error: `Mob not found: ${mobId}` }, { status: 404 });
    }
    if (err instanceof Error && err.message.includes("already in camp")) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  // Mark step as executed — use a separate update after the move transaction completes.
  // If this update fails, the mob has moved but the step stays "pending", which is safe
  // to retry (re-executing will fail with "mob already in camp" guard in performMobMove).
  const now = new Date();
  const updatedStep = await prisma.rotationPlanStep.update({
    where: { id: stepId },
    data: {
      status: "executed",
      actualStart: now,
      // Link to the destination observation row (index 1)
      executedObservationId: moveResult.observationIds[1],
    },
  });

  revalidateRotationWrite(farmSlug);
  return NextResponse.json({
    step: updatedStep,
    move: {
      mobId: moveResult.mobId,
      mobName: moveResult.mobName,
      sourceCamp: moveResult.sourceCamp,
      destCamp: moveResult.destCamp,
      animalCount: moveResult.animalIds.length,
      observedAt: moveResult.observedAt,
    },
  });
}
