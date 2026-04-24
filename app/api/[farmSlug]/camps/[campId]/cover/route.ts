import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { verifyFreshAdminRole } from "@/lib/auth";
import { randomUUID } from "crypto";
import { revalidateCampWrite } from "@/lib/server/revalidate";

export const dynamic = "force-dynamic";

// kg DM/ha midpoints for each category (SA bushveld/Highveld ranges)
const CATEGORY_KG_DM: Record<string, number> = {
  Good: 2000,  // 1,500–2,500 kg DM/ha
  Fair: 1100,  // 700–1,500 kg DM/ha
  Poor: 450,   // 200–700 kg DM/ha
};

// Default SA use factor: 35% of standing biomass consumed before animals move
const DEFAULT_USE_FACTOR = 0.35;

// Daily DMI per animal: 10 kg DM/LSU/day (SA DALRRD official standard)
const DAILY_DMI_PER_HEAD = 10;

function calcDaysRemaining(
  kgDmPerHa: number,
  sizeHectares: number,
  animalCount: number,
  useFactor: number
): number | null {
  if (animalCount <= 0 || sizeHectares <= 0 || kgDmPerHa <= 0) return null;
  return Math.round((kgDmPerHa * sizeHectares * useFactor) / (animalCount * DAILY_DMI_PER_HEAD));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; campId: string }> }
) {
  const { farmSlug, campId } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma } = ctx;

  // Fire all three independent queries in parallel (~3 Turso round-trips → 1)
  const [readings, camp, animalCount] = await Promise.all([
    prisma.campCoverReading.findMany({
      where: { campId },
      orderBy: { recordedAt: "desc" },
      take: 30,
    }),
    prisma.camp.findUnique({
      where: { campId },
      select: { sizeHectares: true },
    }),
    prisma.animal.count({
      where: { currentCamp: campId, status: "Active" },
    }),
  ]);

  const latest = readings[0] ?? null;
  const daysRemaining = latest && camp?.sizeHectares
    ? calcDaysRemaining(latest.kgDmPerHa, camp.sizeHectares, animalCount, latest.useFactor)
    : null;

  return NextResponse.json({
    readings,
    latest,
    daysRemaining,
    animalCount,
    sizeHectares: camp?.sizeHectares ?? null,
    meta: { categoryKgDm: CATEGORY_KG_DM, useFactor: DEFAULT_USE_FACTOR, dailyDmiPerHead: DAILY_DMI_PER_HEAD },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; campId: string }> }
) {
  const { farmSlug, campId } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug, session } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { coverCategory, kgDmPerHaOverride } = body;

  if (!coverCategory || !["Good", "Fair", "Poor"].includes(coverCategory)) {
    return NextResponse.json({ error: "coverCategory must be Good, Fair, or Poor" }, { status: 400 });
  }

  const kgDmPerHa = typeof kgDmPerHaOverride === "number" && kgDmPerHaOverride > 0
    ? kgDmPerHaOverride
    : CATEGORY_KG_DM[coverCategory];

  // Fetch camp and animal count in parallel (both needed before the create)
  const [camp, animalCount] = await Promise.all([
    prisma.camp.findUnique({
      where: { campId },
      select: { sizeHectares: true },
    }),
    prisma.animal.count({
      where: { currentCamp: campId, status: "Active" },
    }),
  ]);
  if (!camp) return NextResponse.json({ error: "Camp not found" }, { status: 404 });

  const reading = await prisma.campCoverReading.create({
    data: {
      id: randomUUID(),
      campId,
      coverCategory,
      kgDmPerHa,
      useFactor: DEFAULT_USE_FACTOR,
      recordedAt: new Date().toISOString(),
      recordedBy: session.user?.email ?? "Unknown",
    },
  });

  const daysRemaining = camp.sizeHectares
    ? calcDaysRemaining(kgDmPerHa, camp.sizeHectares, animalCount, DEFAULT_USE_FACTOR)
    : null;

  revalidateCampWrite(farmSlug);
  return NextResponse.json({ reading, daysRemaining }, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string; campId: string }> }
) {
  const { farmSlug } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug, session } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { readingId } = body;
  if (!readingId || typeof readingId !== "string") {
    return NextResponse.json({ error: "readingId is required" }, { status: 400 });
  }

  await prisma.campCoverReading.delete({ where: { id: readingId } });
  revalidateCampWrite(farmSlug);
  return NextResponse.json({ ok: true });
}
