import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { verifyFreshAdminRole } from "@/lib/auth";
import { performMobMove, MobNotFoundError } from "@/lib/server/mob-move";
import { revalidateMobWrite } from "@/lib/server/revalidate";

export async function PATCH(
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

  const body = (await req.json()) as { name?: string; currentCamp?: string };

  const loggedBy = session.user?.email ?? null;

  // Handle camp change via shared performMobMove helper (updates mob + animals + observations)
  if (body.currentCamp && body.currentCamp !== mob.currentCamp) {
    try {
      await performMobMove(prisma, { mobId, toCampId: body.currentCamp, loggedBy });
    } catch (err) {
      if (err instanceof MobNotFoundError) {
        return NextResponse.json({ error: "Mob not found" }, { status: 404 });
      }
      throw err;
    }
  }

  // Handle name change (or any other field besides currentCamp)
  const nameUpdate: Record<string, unknown> = {};
  if (body.name !== undefined) nameUpdate.name = body.name;
  const updatedMob = Object.keys(nameUpdate).length > 0
    ? await prisma.mob.update({ where: { id: mobId }, data: nameUpdate })
    : await prisma.mob.findUniqueOrThrow({ where: { id: mobId } });

  revalidateMobWrite(db.slug);

  return NextResponse.json({
    id: updatedMob.id,
    name: updatedMob.name,
    current_camp: updatedMob.currentCamp,
  });
}

export async function DELETE(
  _req: NextRequest,
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

  const assignedCount = await prisma.animal.count({
    where: { mobId, status: "Active" },
  });
  if (assignedCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete mob with ${assignedCount} assigned animal(s). Remove them first.` },
      { status: 409 },
    );
  }

  await prisma.mob.delete({ where: { id: mobId } });

  revalidateMobWrite(db.slug);

  return NextResponse.json({ success: true });
}
