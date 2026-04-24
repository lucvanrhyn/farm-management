import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateRotationWrite } from "@/lib/server/revalidate";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; planId: string }> },
) {
  const { farmSlug, planId } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await ctx.prisma.rotationPlan.findUnique({
    where: { id: planId },
    include: { steps: { orderBy: { sequence: "asc" } } },
  });
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  return NextResponse.json(plan);
}

export async function PATCH(
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

  const existing = await prisma.rotationPlan.findUnique({ where: { id: planId } });
  if (!existing) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const body = (await req.json()) as {
    name?: string;
    startDate?: string;
    status?: string;
    notes?: string;
  };

  const VALID_STATUSES = ["draft", "active", "completed", "archived"] as const;
  if (body.status && !VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const trimmed = body.name.trim();
    if (!trimmed) return NextResponse.json({ error: "name cannot be blank" }, { status: 400 });
    updateData.name = trimmed;
  }
  if (body.startDate !== undefined) {
    const d = new Date(body.startDate);
    if (isNaN(d.getTime())) return NextResponse.json({ error: "Invalid startDate" }, { status: 400 });
    updateData.startDate = d;
  }
  if (body.status !== undefined) updateData.status = body.status;
  if (body.notes !== undefined) updateData.notes = body.notes;

  const updated = await prisma.rotationPlan.update({
    where: { id: planId },
    data: updateData,
    include: { steps: { orderBy: { sequence: "asc" } } },
  });

  revalidateRotationWrite(farmSlug);
  return NextResponse.json(updated);
}

export async function DELETE(
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

  const existing = await prisma.rotationPlan.findUnique({ where: { id: planId } });
  if (!existing) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  // Explicitly delete steps first — libSQL does not enforce FK CASCADE by default
  await prisma.rotationPlanStep.deleteMany({ where: { planId } });
  await prisma.rotationPlan.delete({ where: { id: planId } });

  revalidateRotationWrite(farmSlug);
  return NextResponse.json({ success: true });
}
