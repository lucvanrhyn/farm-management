import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { randomUUID } from "crypto";
import type { SessionFarm } from "@/types/next-auth";

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
  _req: Request,
  { params }: { params: Promise<{ farmSlug: string; campId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug, campId } = await params;

  // Verify the authenticated user has access to the requested farm
  const accessible = (session.user?.farms as SessionFarm[] | undefined)?.some(
    (f) => f.slug === farmSlug,
  );
  if (!accessible) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return NextResponse.json({ error: "Farm not found" }, { status: 404 });

  const readings = await prisma.campCoverReading.findMany({
    where: { campId },
    orderBy: { recordedAt: "desc" },
    take: 30,
  });

  const camp = await prisma.camp.findUnique({
    where: { campId },
    select: { sizeHectares: true },
  });

  const animalCount = await prisma.animal.count({
    where: { currentCamp: campId, status: "Active" },
  });

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
  req: Request,
  { params }: { params: Promise<{ farmSlug: string; campId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug, campId } = await params;

  // Verify the authenticated user has access to the requested farm
  const accessiblePost = (session.user?.farms as SessionFarm[] | undefined)?.some(
    (f) => f.slug === farmSlug,
  );
  if (!accessiblePost) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return NextResponse.json({ error: "Farm not found" }, { status: 404 });

  const body = await req.json();
  const { coverCategory, kgDmPerHaOverride } = body;

  if (!coverCategory || !["Good", "Fair", "Poor"].includes(coverCategory)) {
    return NextResponse.json({ error: "coverCategory must be Good, Fair, or Poor" }, { status: 400 });
  }

  const kgDmPerHa = typeof kgDmPerHaOverride === "number" && kgDmPerHaOverride > 0
    ? kgDmPerHaOverride
    : CATEGORY_KG_DM[coverCategory];

  const camp = await prisma.camp.findUnique({
    where: { campId },
    select: { sizeHectares: true },
  });
  if (!camp) return NextResponse.json({ error: "Camp not found" }, { status: 404 });

  const animalCount = await prisma.animal.count({
    where: { currentCamp: campId, status: "Active" },
  });

  const reading = await prisma.campCoverReading.create({
    data: {
      id: randomUUID(),
      campId,
      coverCategory,
      kgDmPerHa,
      useFactor: DEFAULT_USE_FACTOR,
      recordedAt: new Date().toISOString(),
      recordedBy: session.user?.name ?? session.user?.email ?? "Unknown",
    },
  });

  const daysRemaining = camp.sizeHectares
    ? calcDaysRemaining(kgDmPerHa, camp.sizeHectares, animalCount, DEFAULT_USE_FACTOR)
    : null;

  return NextResponse.json({ reading, daysRemaining }, { status: 201 });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ farmSlug: string; campId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug } = await params;

  const farm = (session.user?.farms as SessionFarm[] | undefined)?.find(
    (f) => f.slug === farmSlug,
  );
  if (!farm) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (farm.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return NextResponse.json({ error: "Farm not found" }, { status: 404 });

  const body = await req.json();
  const { readingId } = body;
  if (!readingId || typeof readingId !== "string") {
    return NextResponse.json({ error: "readingId is required" }, { status: 400 });
  }

  await prisma.campCoverReading.delete({ where: { id: readingId } });
  return NextResponse.json({ ok: true });
}
