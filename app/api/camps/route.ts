import { NextRequest, NextResponse } from "next/server";
import { revalidateCampWrite } from "@/lib/server/revalidate";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import { getCachedCampList } from "@/lib/server/cached";
import { CAMP_COLOR_PALETTE } from "@/lib/camp-colors";
import { withServerTiming, timeAsync } from "@/lib/server/server-timing";

export async function GET(req: NextRequest) {
  return withServerTiming(async () => {
    // Phase D (P6): proxy.ts already authenticated this request and stamped
    // the signed identity triplet onto it, so `getFarmContext` replaces the
    // two serial awaits (getServerSession + getPrismaWithAuth) with a single
    // verify-and-resolve. Falls back to the legacy path on unsigned requests.
    const ctx = await timeAsync("session", () => getFarmContext(req));
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const species = searchParams.get("species") ?? undefined;

    const result = await timeAsync("query", () => getCachedCampList(ctx.slug, species));
    return NextResponse.json(result);
  });
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

  revalidateCampWrite(slug);

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
