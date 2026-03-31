import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForRequest } from "@/lib/farm-prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaForRequest();
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  const [camps, animalGroups] = await Promise.all([
    prisma.camp.findMany({ orderBy: { campName: "asc" } }),
    prisma.animal.groupBy({
      by: ["currentCamp"],
      where: { status: "Active" },
      _count: { _all: true },
    }),
  ]);

  const countByCamp: Record<string, number> = {};
  for (const g of animalGroups) {
    countByCamp[g.currentCamp] = g._count._all;
  }

  const result = camps.map((camp) => ({
    camp_id: camp.campId,
    camp_name: camp.campName,
    size_hectares: camp.sizeHectares,
    water_source: camp.waterSource,
    geojson: camp.geojson,
    notes: camp.notes,
    animal_count: countByCamp[camp.campId] ?? 0,
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role?.toUpperCase() !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaForRequest();
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  const body = await req.json();
  const { campId, campName, sizeHectares, waterSource, notes, geojson } = body;

  if (!campId || !campName) {
    return NextResponse.json({ error: "campId and campName are required" }, { status: 400 });
  }

  const existing = await prisma.camp.findUnique({ where: { campId } });
  if (existing) {
    return NextResponse.json({ error: "A camp with this ID already exists" }, { status: 409 });
  }

  const camp = await prisma.camp.create({
    data: {
      campId,
      campName,
      sizeHectares: sizeHectares ? Number(sizeHectares) : null,
      waterSource: waterSource || null,
      notes: notes || null,
      geojson: geojson || null,
    },
  });

  revalidatePath("/admin/camps");
  revalidatePath("/admin");
  revalidatePath("/dashboard");

  return NextResponse.json(camp, { status: 201 });
}
