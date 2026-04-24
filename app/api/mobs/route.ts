import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateMobWrite } from "@/lib/server/revalidate";

export async function GET(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma } = ctx;

  const [mobs, animalGroups] = await Promise.all([
    prisma.mob.findMany({ orderBy: { name: "asc" } }),
    prisma.animal.groupBy({
      by: ["mobId"],
      where: { status: "Active", mobId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const countByMob: Record<string, number> = {};
  for (const g of animalGroups) {
    if (g.mobId) countByMob[g.mobId] = g._count._all;
  }

  const result = mobs.map((mob) => ({
    id: mob.id,
    name: mob.name,
    current_camp: mob.currentCamp,
    animal_count: countByMob[mob.id] ?? 0,
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug, session } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { name, currentCamp } = body;

  if (!name || !currentCamp) {
    return NextResponse.json(
      { error: "name and currentCamp are required" },
      { status: 400 },
    );
  }

  const mob = await prisma.mob.create({
    data: { name, currentCamp },
  });

  revalidateMobWrite(slug);

  return NextResponse.json(
    { id: mob.id, name: mob.name, current_camp: mob.currentCamp, animal_count: 0 },
    { status: 201 },
  );
}
