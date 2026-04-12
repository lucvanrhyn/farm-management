import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForFarm, getPrismaForSlugWithAuth } from "@/lib/farm-prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug } = await params;
  const accessible = session.user.farms.some((f) => f.slug === farmSlug);
  if (!accessible) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return NextResponse.json({ error: "Farm not found" }, { status: 404 });

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
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug } = await params;
  const _auth = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in _auth) return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  if (_auth.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const prisma = _auth.prisma;

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

  return NextResponse.json(plan, { status: 201 });
}
