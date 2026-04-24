import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateRotationWrite } from "@/lib/server/revalidate";

export const dynamic = "force-dynamic";

/** POST — append a new step at max(sequence)+1 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; planId: string }> },
) {
  const { farmSlug, planId } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug, session } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const plan = await prisma.rotationPlan.findUnique({ where: { id: planId } });
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const body = (await req.json()) as {
    campId?: string;
    mobId?: string;
    plannedStart?: string;
    plannedDays?: number;
    notes?: string;
  };

  if (!body.campId || typeof body.campId !== "string") {
    return NextResponse.json({ error: "campId is required" }, { status: 400 });
  }
  if (!body.plannedStart || typeof body.plannedStart !== "string") {
    return NextResponse.json({ error: "plannedStart is required" }, { status: 400 });
  }
  const plannedStart = new Date(body.plannedStart);
  if (isNaN(plannedStart.getTime())) {
    return NextResponse.json({ error: "plannedStart is invalid" }, { status: 400 });
  }
  if (typeof body.plannedDays !== "number" || body.plannedDays < 1) {
    return NextResponse.json({ error: "plannedDays must be a positive integer" }, { status: 400 });
  }

  // Find the current max sequence for this plan
  const lastStep = await prisma.rotationPlanStep.findFirst({
    where: { planId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const nextSequence = (lastStep?.sequence ?? 0) + 1;

  const step = await prisma.rotationPlanStep.create({
    data: {
      planId,
      sequence: nextSequence,
      campId: body.campId,
      mobId: body.mobId ?? null,
      plannedStart,
      plannedDays: body.plannedDays,
      notes: body.notes ?? null,
    },
  });

  revalidateRotationWrite(farmSlug);
  return NextResponse.json(step, { status: 201 });
}

/** PUT — reorder steps by providing a new array of step IDs in desired order */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; planId: string }> },
) {
  const { farmSlug, planId } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug, session } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const plan = await prisma.rotationPlan.findUnique({ where: { id: planId } });
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const body = (await req.json()) as { order?: string[] };
  if (!Array.isArray(body.order) || body.order.length === 0) {
    return NextResponse.json({ error: "order must be a non-empty array of step IDs" }, { status: 400 });
  }

  // Validate order is a permutation of the current pending steps for this plan
  const currentSteps = await prisma.rotationPlanStep.findMany({
    where: { planId, status: "pending" },
    select: { id: true },
  });
  const currentIds = new Set(currentSteps.map((s) => s.id));
  const orderSet = new Set(body.order);
  if (
    body.order.length !== currentSteps.length ||
    body.order.some((id) => !currentIds.has(id)) ||
    currentSteps.some((s) => !orderSet.has(s.id))
  ) {
    return NextResponse.json(
      { error: "order must be a permutation of the plan's pending step IDs" },
      { status: 400 },
    );
  }

  // Update sequence for each step in provided order
  await Promise.all(
    body.order.map((stepId, idx) =>
      prisma.rotationPlanStep.update({
        where: { id: stepId },
        data: { sequence: idx + 1 },
      }),
    ),
  );

  const steps = await prisma.rotationPlanStep.findMany({
    where: { planId },
    orderBy: { sequence: "asc" },
  });

  revalidateRotationWrite(farmSlug);
  return NextResponse.json(steps);
}
