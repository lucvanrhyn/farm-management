/**
 * GET /api/[farmSlug]/camps/[campId]/stats — per-camp dashboard stats.
 *
 * Wave G7 (#171) — migrated onto `tenantReadSlug`.
 *
 * Wire-shape preservation (hybrid per ADR-0001 / Wave G7 spec):
 *   - 401 envelope migrates to the adapter's canonical
 *     `{ error: "AUTH_REQUIRED", message: "Unauthorized" }`.
 *   - 404 (camp not found) keeps its bare-string `{ error: "Camp not found" }`
 *     envelope.
 *   - 200 success shape unchanged (camp / animals / health / calvings /
 *     visits / inspection / condition).
 *
 * Pre-existing gap (out of scope for this wave): no `camp.farmId === ctx.slug`
 * belongs-to-farm check. Same gap flagged in Wave G6 — wave is transport-only.
 */
import { NextResponse } from "next/server";
import { tenantReadSlug } from "@/lib/server/route";
import type { AnimalCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = tenantReadSlug<{ farmSlug: string; campId: string }>({
  handle: async (ctx, _req, { campId }) => {
    const { prisma } = ctx;

    // Phase A of #28: campId is no longer globally unique (composite UNIQUE on
    // species+campId). findFirst is single-species-safe; Phase B will tighten.
    const camp = await prisma.camp.findFirst({ where: { campId } });
    if (!camp) {
      return NextResponse.json({ error: "Camp not found" }, { status: 404 });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const thisMonthStart = new Date();
    thisMonthStart.setDate(1);
    thisMonthStart.setHours(0, 0, 0, 0);

    // Fire all independent DB queries in parallel (~5 Turso round-trips → 1)
    const [
      activeAnimals,
      healthCount,
      calvingCount,
      visitCount,
      latestInspection,
      latestCondition,
    ] = await Promise.all([
      // Active animals in this camp.
      // cross-species by design: physical camp stats roll up every species.
      prisma.animal.findMany({
        where: { currentCamp: campId, status: "Active" },
        select: { category: true },
      }),
      // Health events (last 30 days)
      prisma.observation.count({
        where: { campId, type: "health_issue", observedAt: { gte: thirtyDaysAgo } },
      }),
      // Calving / reproduction events (this month)
      prisma.observation.count({
        where: {
          campId,
          type: { in: ["reproduction", "calving"] as string[] },
          observedAt: { gte: thisMonthStart },
        },
      }),
      // Camp visits (last 30 days) — both check-ins and condition records
      prisma.observation.count({
        where: {
          campId,
          type: { in: ["camp_check", "camp_condition"] },
          observedAt: { gte: thirtyDaysAgo },
        },
      }),
      // Latest inspection (any camp_check or camp_condition)
      prisma.observation.findFirst({
        where: { campId, type: { in: ["camp_check", "camp_condition"] } },
        orderBy: { observedAt: "desc" },
        select: { observedAt: true, loggedBy: true },
      }),
      // Latest camp condition record (grazing/water/fence)
      prisma.observation.findFirst({
        where: { campId, type: "camp_condition" },
        orderBy: { observedAt: "desc" },
        select: { details: true, observedAt: true },
      }),
    ]);

    const byCategory: Partial<Record<AnimalCategory, number>> = {};
    for (const a of activeAnimals) {
      const cat = a.category as AnimalCategory;
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }

    let conditionDetails: Record<string, string> = {};
    if (latestCondition) {
      try {
        conditionDetails = JSON.parse(latestCondition.details);
      } catch {
        // malformed — ignore
      }
    }

    // Days since last inspection
    const daysSinceInspection = latestInspection
      ? Math.floor(
          (Date.now() - new Date(latestInspection.observedAt).getTime()) / 86_400_000
        )
      : null;

    // Health event rate per 100 animal-days (30-day window)
    const animalCount = activeAnimals.length;
    const animalDays = animalCount * 30;
    const healthRate =
      animalCount > 0 && healthCount > 0
        ? ((healthCount / animalDays) * 100).toFixed(2)
        : "0.00";

    return NextResponse.json({
      camp: {
        campId: camp.campId,
        campName: camp.campName,
        sizeHectares: camp.sizeHectares,
        waterSource: camp.waterSource,
      },
      animals: {
        total: animalCount,
        byCategory,
      },
      health: {
        eventsLast30d: healthCount,
        ratePer100AnimalDays: parseFloat(healthRate),
      },
      calvings: {
        thisMonth: calvingCount,
      },
      visits: {
        last30d: visitCount,
      },
      inspection: {
        daysSince: daysSinceInspection,
        lastBy: latestInspection?.loggedBy ?? null,
        lastAt: latestInspection
          ? new Date(latestInspection.observedAt).toISOString()
          : null,
      },
      condition: latestCondition
        ? {
            grazingQuality: conditionDetails.grazing ?? null,
            waterStatus: conditionDetails.water ?? null,
            fenceStatus: conditionDetails.fence ?? null,
            recordedAt: new Date(latestCondition.observedAt).toISOString(),
          }
        : null,
    });
  },
});
