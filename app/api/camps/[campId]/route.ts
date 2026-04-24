import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { revalidateCampWrite } from "@/lib/server/revalidate";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ campId: string }> }
) {
  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { campId } = await params;
  const camp = await prisma.camp.findUnique({ where: { campId } });
  if (!camp) return NextResponse.json({ error: "Camp not found" }, { status: 404 });

  const body = await req.json() as {
    campName?: string;
    sizeHectares?: number | null;
    waterSource?: string | null;
    geojson?: string | null;
    color?: string | null;
    veldType?: string | null;
    restDaysOverride?: number | null;
    maxGrazingDaysOverride?: number | null;
    rotationNotes?: string | null;
  };

  if (body.color !== undefined && body.color !== null && !/^#[0-9A-Fa-f]{6}$/.test(body.color)) {
    return NextResponse.json({ error: "color must be a valid hex color (e.g. #2563EB)" }, { status: 400 });
  }

  const VELD_TYPES = new Set(["sweetveld", "sourveld", "mixedveld", "cultivated"]);
  if (body.veldType !== undefined && body.veldType !== null && !VELD_TYPES.has(body.veldType)) {
    return NextResponse.json(
      { error: "veldType must be one of: sweetveld, sourveld, mixedveld, cultivated" },
      { status: 400 }
    );
  }

  for (const field of ["restDaysOverride", "maxGrazingDaysOverride"] as const) {
    const val = body[field];
    if (val !== undefined && val !== null) {
      if (typeof val !== "number" || !Number.isFinite(val) || val <= 0 || !Number.isInteger(val)) {
        return NextResponse.json(
          { error: `${field} must be a positive integer or null` },
          { status: 400 }
        );
      }
    }
  }

  await prisma.camp.update({
    where: { campId },
    data: {
      ...(body.campName !== undefined && { campName: body.campName }),
      ...(body.sizeHectares !== undefined && { sizeHectares: body.sizeHectares }),
      ...(body.waterSource !== undefined && { waterSource: body.waterSource }),
      ...(body.geojson !== undefined && { geojson: body.geojson }),
      ...(body.color !== undefined && { color: body.color }),
      ...(body.veldType !== undefined && { veldType: body.veldType }),
      ...(body.restDaysOverride !== undefined && { restDaysOverride: body.restDaysOverride }),
      ...(body.maxGrazingDaysOverride !== undefined && { maxGrazingDaysOverride: body.maxGrazingDaysOverride }),
      ...(body.rotationNotes !== undefined && { rotationNotes: body.rotationNotes }),
    },
  });

  revalidateCampWrite(slug);

  return NextResponse.json({ success: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ campId: string }> }
) {
  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  revalidateCampWrite(slug);

  return NextResponse.json({ success: true });
}
