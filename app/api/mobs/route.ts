import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateMobWrite } from "@/lib/server/revalidate";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

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
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma, role } = db;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, db.slug))) {
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

  revalidateMobWrite(db.slug);

  return NextResponse.json(
    { id: mob.id, name: mob.name, current_camp: mob.currentCamp, animal_count: 0 },
    { status: 201 },
  );
}
