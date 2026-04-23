import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidateCampWrite } from "@/lib/server/revalidate";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { getCachedCampList } from "@/lib/server/cached";
import { CAMP_COLOR_PALETTE } from "@/lib/camp-colors";
import { withServerTiming, timeAsync } from "@/lib/server/server-timing";

export async function GET(req: NextRequest) {
  return withServerTiming(async () => {
    const session = await timeAsync("session", () => getServerSession(authOptions));
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getPrismaWithAuth(session);
    if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });

    const { searchParams } = new URL(req.url);
    const species = searchParams.get("species") ?? undefined;

    const result = await timeAsync("query", () => getCachedCampList(db.slug, species));
    return NextResponse.json(result);
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma, role } = db;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { campId, campName, sizeHectares, waterSource, geojson, color } = body;

  if (!campId || !campName) {
    return NextResponse.json({ error: "campId and campName are required" }, { status: 400 });
  }

  if (color !== undefined && color !== null && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    return NextResponse.json({ error: "color must be a valid hex color (e.g. #2563EB)" }, { status: 400 });
  }

  const existing = await prisma.camp.findUnique({ where: { campId } });
  if (existing) {
    return NextResponse.json({ error: "A camp with this ID already exists" }, { status: 409 });
  }

  // Auto-assign a color from the palette if not provided
  let assignedColor = color as string | undefined;
  if (!assignedColor) {
    const campCount = await prisma.camp.count();
    assignedColor = CAMP_COLOR_PALETTE[campCount % CAMP_COLOR_PALETTE.length];
  }

  const camp = await prisma.camp.create({
    data: {
      campId,
      campName,
      sizeHectares: sizeHectares ? Number(sizeHectares) : null,
      waterSource: waterSource || null,
      geojson: geojson || null,
      color: assignedColor,
    },
  });

  revalidateCampWrite(db.slug);

  // Return snake_case to match the GET /api/camps response shape
  return NextResponse.json({
    camp_id: camp.campId,
    camp_name: camp.campName,
    size_hectares: camp.sizeHectares,
    water_source: camp.waterSource,
    geojson: camp.geojson,
    color: camp.color,
    animal_count: 0,
  }, { status: 201 });
}
