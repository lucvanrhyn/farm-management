import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForRequest } from "@/lib/farm-prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ campId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role?.toUpperCase() !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaForRequest();
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  const { campId } = await params;
  const camp = await prisma.camp.findUnique({ where: { campId } });
  if (!camp) return NextResponse.json({ error: "Camp not found" }, { status: 404 });

  const body = await req.json() as {
    campName?: string;
    sizeHectares?: number | null;
    waterSource?: string | null;
    notes?: string | null;
    geojson?: string | null;
  };

  await prisma.camp.update({
    where: { campId },
    data: {
      ...(body.campName !== undefined && { campName: body.campName }),
      ...(body.sizeHectares !== undefined && { sizeHectares: body.sizeHectares }),
      ...(body.waterSource !== undefined && { waterSource: body.waterSource }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.geojson !== undefined && { geojson: body.geojson }),
    },
  });

  revalidatePath("/admin/camps");
  revalidatePath("/admin");
  revalidatePath("/dashboard");

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ campId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role?.toUpperCase() !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaForRequest();
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  const { campId } = await params;

  const camp = await prisma.camp.findUnique({ where: { campId } });
  if (!camp) {
    return NextResponse.json({ error: "Camp not found" }, { status: 404 });
  }

  const activeAnimals = await prisma.animal.count({
    where: { currentCamp: campId, status: "Active" },
  });
  if (activeAnimals > 0) {
    return NextResponse.json(
      { error: `Cannot delete camp with ${activeAnimals} active animal(s). Move or remove them first.` },
      { status: 409 }
    );
  }

  await prisma.camp.delete({ where: { campId } });

  revalidatePath("/admin/camps");
  revalidatePath("/admin");
  revalidatePath("/dashboard");

  return NextResponse.json({ success: true });
}
