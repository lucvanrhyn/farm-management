import { getPrismaForFarm } from "@/lib/farm-prisma";
import type { SessionFarm } from "@/types/next-auth";

export interface FarmOverview {
  slug: string;
  activeAnimalCount: number | null; // null = unavailable
  campCount: number | null;
  /**
   * Epoch milliseconds of the most recent observation, or null if none.
   *
   * Intentionally `number` (not `Date`): this object crosses the
   * `unstable_cache` JSON boundary in `getCachedMultiFarmOverview`, and
   * `Date` instances don't survive `JSON.parse` — they come back as ISO
   * strings and silently break `.getTime()` in consumers. Using epoch-ms
   * keeps the type honest and requires zero parsing downstream.
   */
  lastObservationAtMs: number | null;
  tier: string;
  subscriptionStatus: string;
}

/**
 * Fetches lightweight aggregate stats for each farm in the user's session.
 *
 * Uses Promise.allSettled so a dead Turso shard for one farm does not block
 * the others. Failed farms get null counts (rendered as "Unavailable").
 *
 * Caps at 8 farms to keep page load time bounded.
 */
export async function getOverviewForUserFarms(
  farms: SessionFarm[],
): Promise<FarmOverview[]> {
  const capped = farms.slice(0, 8);

  const results = await Promise.allSettled(
    capped.map(async (farm): Promise<FarmOverview> => {
      const prisma = await getPrismaForFarm(farm.slug);
      if (!prisma) {
        return {
          slug: farm.slug,
          activeAnimalCount: null,
          campCount: null,
          lastObservationAtMs: null,
          tier: farm.tier,
          subscriptionStatus: farm.subscriptionStatus,
        };
      }

      // Animal.status is schema-default "Active" (capital A). Lowercase
      // "active" silently matches zero rows — this was the "0 animals on a
      // 874-animal farm" bug surfaced by the farm selector. Keep the casing
      // aligned with the schema default and every other server query in
      // lib/server/ (chart-data, data-health, breeding-analytics, analytics,
      // profitability-by-animal).
      const [activeAnimalCount, campCount, latestObs] = await Promise.all([
        prisma.animal.count({ where: { status: "Active" } }),
        prisma.camp.count(),
        prisma.observation.findFirst({
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);

      return {
        slug: farm.slug,
        activeAnimalCount,
        campCount,
        lastObservationAtMs: latestObs?.createdAt.getTime() ?? null,
        tier: farm.tier,
        subscriptionStatus: farm.subscriptionStatus,
      };
    }),
  );

  return results.map((result, i): FarmOverview => {
    if (result.status === "fulfilled") return result.value;
    console.error(`[multi-farm-overview] Failed to fetch overview for "${capped[i].slug}":`, result.reason);
    return {
      slug: capped[i].slug,
      activeAnimalCount: null,
      campCount: null,
      lastObservationAtMs: null,
      tier: capped[i].tier,
      subscriptionStatus: capped[i].subscriptionStatus,
    };
  });
}
