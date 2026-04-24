import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForFarm, getPrismaForSlugWithAuth } from "@/lib/farm-prisma";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateRotationWrite } from "@/lib/server/revalidate";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; planId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug, planId } = await params;
  if (!session.user.farms.some((f) => f.slug === farmSlug)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return NextResponse.json({ error: "Farm not found" }, { status: 404 });

  const plan = await prisma.rotationPlan.findUnique({
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
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug, planId } = await params;
  const _auth = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in _auth) return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  if (_auth.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, _auth.slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const prisma = _auth.prisma;

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
  _req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; planId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug, planId } = await params;
  const _auth = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in _auth) return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  if (_auth.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, _auth.slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const prisma = _auth.prisma;

  const existing = await prisma.rotationPlan.findUnique({ where: { id: planId } });
  if (!existing) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  // Explicitly delete steps first — libSQL does not enforce FK CASCADE by default
  await prisma.rotationPlanStep.deleteMany({ where: { planId } });
  await prisma.rotationPlan.delete({ where: { id: planId } });

  revalidateRotationWrite(farmSlug);
  return NextResponse.json({ success: true });
}
