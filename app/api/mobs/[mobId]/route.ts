import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ mobId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role?.toUpperCase() !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  const { mobId } = await params;
  const mob = await prisma.mob.findUnique({ where: { id: mobId } });
  if (!mob) {
    return NextResponse.json({ error: "Mob not found" }, { status: 404 });
  }

  const body = (await req.json()) as { name?: string; currentCamp?: string };

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.currentCamp !== undefined) updateData.currentCamp = body.currentCamp;

  const updatedMob = await prisma.mob.update({
    where: { id: mobId },
    data: updateData,
  });

  // When the camp changes, batch-update all animals in this mob
  if (body.currentCamp && body.currentCamp !== mob.currentCamp) {
    const affectedAnimals = await prisma.animal.findMany({
      where: { mobId, status: "Active" },
      select: { id: true, animalId: true },
    });

    if (affectedAnimals.length > 0) {
      await prisma.animal.updateMany({
        where: { mobId, status: "Active" },
        data: { currentCamp: body.currentCamp },
      });

      // Log a single mob_movement observation
      await prisma.observation.create({
        data: {
          type: "mob_movement",
          campId: body.currentCamp,
          details: JSON.stringify({
            mobId,
            mobName: updatedMob.name,
            sourceCamp: mob.currentCamp,
            destCamp: body.currentCamp,
            animalCount: affectedAnimals.length,
            animalIds: affectedAnimals.map((a) => a.animalId),
          }),
          observedAt: new Date(),
          loggedBy: session.user?.email ?? null,
        },
      });
    }
  }

  revalidatePath("/admin/mobs");
  revalidatePath("/admin/animals");
  revalidatePath("/admin");
  revalidatePath("/dashboard");

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
  if (!session || session.user?.role?.toUpperCase() !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

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

  revalidatePath("/admin/mobs");
  revalidatePath("/admin");

  return NextResponse.json({ success: true });
}
