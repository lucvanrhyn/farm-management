import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { getFarmCreds } from "@/lib/meta-db";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> }
) {
  const { farmSlug } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Tier read live from meta DB — session JWT is cached at login.
  const creds = await getFarmCreds(farmSlug);
  if (!creds) return NextResponse.json({ error: "Farm not found" }, { status: 404 });
  if (creds.tier === "basic") {
    return NextResponse.json({ error: "Advanced plan required" }, { status: 403 });
  }

  const { prisma } = ctx;

  // Step 1: fetch camp list (needed to scope IN-queries)
  const camps = await prisma.camp.findMany({ orderBy: { campId: "asc" } });
  const campIds = camps.map((c) => c.campId);

  if (campIds.length === 0) return NextResponse.json([]);

  // Step 2: fire all bulk queries in parallel — 4 queries regardless of camp count
  // (was N+1: 1 camp list + 3 queries per camp = 3N+1)
  const [animalGroups, allConditions, allCovers] = await Promise.all([
    // cross-species by design: per-camp performance rollup spans species.
    prisma.animal.groupBy({
      by: ["currentCamp"],
      where: { currentCamp: { in: campIds }, status: "Active" },
      _count: { _all: true },
    }),
    // Fetch all camp_condition records for these camps, newest first.
    // We pick the first occurrence per campId below (= latest) so ordering matters.
    prisma.observation.findMany({
      where: { campId: { in: campIds }, type: "camp_condition" },
      orderBy: { observedAt: "desc" },
      select: { campId: true, details: true, observedAt: true },
    }),
    prisma.campCoverReading.findMany({
      where: { campId: { in: campIds } },
      orderBy: { recordedAt: "desc" },
      select: { campId: true, coverCategory: true, recordedAt: true },
    }),
  ]);

  // Step 3: build lookup maps in memory (O(N) each, negligible vs. DB round-trips)
  const animalCountByCamp: Record<string, number> = {};
  for (const g of animalGroups) {
    if (g.currentCamp) animalCountByCamp[g.currentCamp] = g._count._all;
  }

  const latestConditionByCamp: Record<string, typeof allConditions[number]> = {};
  for (const c of allConditions) {
    if (!latestConditionByCamp[c.campId]) latestConditionByCamp[c.campId] = c;
  }

  const latestCoverByCamp: Record<string, typeof allCovers[number]> = {};
  for (const c of allCovers) {
    if (!latestCoverByCamp[c.campId]) latestCoverByCamp[c.campId] = c;
  }

  const rows = camps.map((camp) => {
    const animalCount = animalCountByCamp[camp.campId] ?? 0;
    const latestCondition = latestConditionByCamp[camp.campId] ?? null;
    const latestCover = latestCoverByCamp[camp.campId] ?? null;
    const density = camp.sizeHectares && camp.sizeHectares > 0
      ? (animalCount / camp.sizeHectares).toFixed(1)
      : null;
    const details = (latestCondition?.details as unknown) as Record<string, string> | null;
    return {
      campId: camp.campId,
      campName: camp.campName,
      sizeHectares: camp.sizeHectares,
      animalCount,
      stockingDensity: density,
      grazingQuality: details?.grazing ?? null,
      fenceStatus: details?.fence ?? null,
      lastInspection: latestCondition?.observedAt ? new Date(latestCondition.observedAt).toISOString().split("T")[0] : null,
      coverCategory: latestCover?.coverCategory ?? null,
      coverReadingDate: latestCover?.recordedAt ? new Date(latestCover.recordedAt).toISOString().split("T")[0] : null,
    };
  });

  return NextResponse.json(rows);
}
