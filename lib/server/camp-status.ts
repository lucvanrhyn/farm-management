import { type PrismaClient } from "@prisma/client";
import { GrazingQuality, WaterStatus, FenceStatus } from "@/lib/types";
import { calcDaysGrazingRemaining } from "@/lib/server/analytics";
import { getTenantDayStart } from "@/lib/server/tenant-day";
import type { SpeciesId } from "@/lib/species/types";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";

// ADR-0005 Wave 2: camp-status reads are farm-wide analytics roll-ups
// (latest camp conditions, recent health obs, LSU grazing math). The
// existing `...(mode ? { species: mode } : {})` spreads are KEPT verbatim
// — crossSpecies() injects nothing, so behaviour is bit-identical.

export interface LiveCampStatus {
  grazing_quality: GrazingQuality;
  water_status: WaterStatus;
  fence_status: FenceStatus;
  last_inspected_at: string; // ISO string
  last_inspected_by: string | null;
}

export interface HealthObservation {
  id: string;
  animalId: string | null;
  campId: string;
  details: { symptoms?: string[]; severity?: string };
  observedAt: string; // ISO string
}

export async function getLatestCampConditions(prisma: PrismaClient): Promise<Map<string, LiveCampStatus>> {
  // Use distinct on campId with descending observedAt to get only the latest
  // observation per camp — avoids fetching the entire historical table.
  const observations = await crossSpecies(prisma, "analytics-rollup").observation.findMany({
    where: { type: { in: ["camp_condition", "camp_check"] } },
    orderBy: { observedAt: "desc" },
    distinct: ["campId"],
  });

  const result = new Map<string, LiveCampStatus>();
  for (const obs of observations) {
    let details: Record<string, string> = {};
    try {
      details = JSON.parse(obs.details);
    } catch {
      // malformed details — skip
    }
    const inspectedAt = obs.observedAt instanceof Date ? obs.observedAt.toISOString() : obs.observedAt;
    if (obs.type === "camp_condition") {
      result.set(obs.campId, {
        grazing_quality: (details.grazing as GrazingQuality) ?? "Fair",
        water_status: (details.water as WaterStatus) ?? "Full",
        fence_status: (details.fence as FenceStatus) ?? "Intact",
        last_inspected_at: inspectedAt,
        last_inspected_by: details.logged_by ?? null,
      });
    } else {
      // camp_check — all-normal, no specific condition data
      result.set(obs.campId, {
        grazing_quality: "Good",
        water_status: "Full",
        fence_status: "Intact",
        last_inspected_at: inspectedAt,
        last_inspected_by: details.logged_by ?? null,
      });
    }
  }
  return result;
}

export async function getRecentHealthObservations(
  prisma: PrismaClient,
  limit = 8,
  mode?: SpeciesId,
): Promise<HealthObservation[]> {
  const rows = await crossSpecies(prisma, "analytics-rollup").observation.findMany({
    where: {
      type: "health_issue",
      // Per-species when `mode` is provided (admin dashboard #225); cross-species
      // when omitted (any legacy caller). The denormalised `species` column
      // (migration 0003) is the canonical scoping axis for observations.
      ...(mode ? { species: mode } : {}),
    },
    orderBy: { observedAt: "desc" },
    take: limit,
  });

  return rows.map((obs) => {
    let details: HealthObservation["details"] = {};
    try {
      details = JSON.parse(obs.details);
    } catch {
      // malformed details
    }
    return {
      id: obs.id,
      animalId: obs.animalId,
      campId: obs.campId,
      details,
      observedAt: obs.observedAt instanceof Date ? obs.observedAt.toISOString() : obs.observedAt,
    };
  });
}

export async function countHealthIssuesSince(
  prisma: PrismaClient,
  since: Date,
  mode?: SpeciesId,
): Promise<number> {
  return crossSpecies(prisma, "analytics-rollup").observation.count({
    where: {
      type: "health_issue",
      observedAt: { gte: since },
      ...(mode ? { species: mode } : {}),
    },
  });
}

/**
 * Returns the number of camps with <7 days of grazing remaining (LSU-based).
 * Uses 3 batched queries — safe to call on the admin home page.
 */
export async function getLowGrazingCampCount(prisma: PrismaClient, warningDays = 7): Promise<number> {
  const xs = crossSpecies(prisma, "analytics-rollup");
  const [camps, allCoverReadings, allAnimals] = await Promise.all([
    xs.camp.findMany({ select: { campId: true, sizeHectares: true } }),
    prisma.campCoverReading.findMany({ orderBy: { recordedAt: "desc" } }),
    // cross-species by design: low-grazing math sums LSU across all species.
    // Facade returns Prisma's broadest groupBy shape (documented
    // trade-off in species-scoped-prisma.ts); re-narrow to this query's
    // `by`/`_count` selection — behaviour-identical.
    xs.animal.groupBy({
      by: ["currentCamp", "species", "category"],
      where: { status: "Active" },
      _count: { id: true },
    }) as unknown as Promise<
      Array<{ currentCamp: string | null; category: string; _count: { id: number } }>
    >,
  ]);

  const latestCover = new Map<string, { kgDmPerHa: number; useFactor: number }>();
  for (const r of allCoverReadings) {
    if (!latestCover.has(r.campId)) {
      latestCover.set(r.campId, { kgDmPerHa: r.kgDmPerHa, useFactor: r.useFactor });
    }
  }

  const animalsByCamp = new Map<string, Array<{ category: string; count: number }>>();
  for (const r of allAnimals) {
    const campId = r.currentCamp ?? "";
    if (!animalsByCamp.has(campId)) animalsByCamp.set(campId, []);
    animalsByCamp.get(campId)!.push({ category: r.category, count: r._count.id });
  }

  let count = 0;
  for (const camp of camps) {
    if (!camp.sizeHectares) continue;
    const cover = latestCover.get(camp.campId);
    if (!cover) continue;
    const days = calcDaysGrazingRemaining(
      cover.kgDmPerHa,
      cover.useFactor,
      camp.sizeHectares,
      animalsByCamp.get(camp.campId) ?? []
    );
    if (days !== null && days < warningDays) count++;
  }
  return count;
}

export async function countInspectedToday(
  prisma: PrismaClient,
  tz?: string | null,
): Promise<number> {
  // Issue #258: bucket "today" against the tenant's stored TZ
  // (FarmSettings.timezone, default "Africa/Johannesburg") rather than the
  // server's local TZ. UTC bucketing undercounted SAST inspections done
  // between 00:00 and 02:00 SAST (= 22:00–00:00 UTC the previous day).
  // `tz` is optional so legacy call-sites keep compiling; when omitted we
  // fall back to "Africa/Johannesburg" — the FarmSettings.timezone default.
  const todayStart = getTenantDayStart(tz ?? "Africa/Johannesburg");

  // Issue #363: a camp inspection is a NULL-species `camp_condition` /
  // `camp_check` observation logged against a camp — it is NOT a per-species
  // concept. The previous `...(mode ? { species: mode } : {})` predicate
  // dropped every NULL-species row whenever a FarmMode was active, so the
  // "Inspections Today" tile read 0/N on every per-species dashboard. This
  // query is intentionally cross-species: it counts the distinct camps
  // inspected today regardless of which species the dashboard is filtered to.
  const rows = await crossSpecies(prisma, "analytics-rollup").observation.findMany({
    where: {
      type: { in: ["camp_condition", "camp_check"] },
      observedAt: { gte: todayStart },
    },
    select: { campId: true },
  });

  return new Set(rows.map((r) => r.campId)).size;
}
