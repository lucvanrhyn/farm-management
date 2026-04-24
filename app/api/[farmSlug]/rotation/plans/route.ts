import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateRotationWrite } from "@/lib/server/revalidate";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const { farmSlug } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma } = ctx;

  const plans = await prisma.rotationPlan.findMany({
    include: { steps: { orderBy: { sequence: "asc" } } },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(plans);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const { farmSlug } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug, session } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json()) as {
    name?: string;
    startDate?: string;
    notes?: string;
    steps?: Array<{
      campId: string;
      mobId?: string;
      plannedStart: string;
      plannedDays: number;
      notes?: string;
    }>;
  };

  if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!body.startDate || typeof body.startDate !== "string") {
    return NextResponse.json({ error: "startDate is required" }, { status: 400 });
  }
  const startDate = new Date(body.startDate);
  if (isNaN(startDate.getTime())) {
    return NextResponse.json({ error: "startDate is invalid" }, { status: 400 });
  }

  const plan = await prisma.rotationPlan.create({
    data: {
      name: body.name.trim(),
      startDate,
      notes: body.notes ?? null,
      steps: body.steps?.length
        ? {
            create: body.steps.map((s, i) => ({
              sequence: i + 1,
              campId: s.campId,
              mobId: s.mobId ?? null,
              plannedStart: new Date(s.plannedStart),
              plannedDays: s.plannedDays,
              notes: s.notes ?? null,
            })),
          }
        : undefined,
    },
    include: { steps: { orderBy: { sequence: "asc" } } },
  });

  revalidateRotationWrite(farmSlug);
  return NextResponse.json(plan, { status: 201 });
}
