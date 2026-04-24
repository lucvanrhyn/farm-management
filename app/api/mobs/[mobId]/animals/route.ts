import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateMobWrite } from "@/lib/server/revalidate";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ mobId: string }> },
) {
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

  const { mobId } = await params;
  const mob = await prisma.mob.findUnique({ where: { id: mobId } });
  if (!mob) {
    return NextResponse.json({ error: "Mob not found" }, { status: 404 });
  }

  const body = (await req.json()) as { animalIds: string[] };
  if (!Array.isArray(body.animalIds) || body.animalIds.length === 0) {
    return NextResponse.json(
      { error: "animalIds array is required" },
      { status: 400 },
    );
  }

  // Assign animals to mob and move them to the mob's current camp
  await prisma.animal.updateMany({
    where: { animalId: { in: body.animalIds }, status: "Active" },
    data: { mobId, currentCamp: mob.currentCamp },
  });

  revalidateMobWrite(db.slug);

  return NextResponse.json({ success: true, count: body.animalIds.length });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ mobId: string }> },
) {
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

  const { mobId } = await params;
  const mob = await prisma.mob.findUnique({ where: { id: mobId } });
  if (!mob) {
    return NextResponse.json({ error: "Mob not found" }, { status: 404 });
  }

  const body = (await req.json()) as { animalIds: string[] };
  if (!Array.isArray(body.animalIds) || body.animalIds.length === 0) {
    return NextResponse.json(
      { error: "animalIds array is required" },
      { status: 400 },
    );
  }

  await prisma.animal.updateMany({
    where: { animalId: { in: body.animalIds }, mobId },
    data: { mobId: null },
  });

  revalidateMobWrite(db.slug);

  return NextResponse.json({ success: true, count: body.animalIds.length });
}
