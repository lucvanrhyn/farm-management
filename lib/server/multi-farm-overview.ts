import { getPrismaForFarm } from "@/lib/farm-prisma";
import type { SessionFarm } from "@/types/next-auth";

export interface FarmOverview {
  slug: string;
  activeAnimalCount: number | null; // null = unavailable
  campCount: number | null;
  lastObservationAt: Date | null;
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
          lastObservationAt: null,
          tier: farm.tier,
          subscriptionStatus: farm.subscriptionStatus,
        };
      }

      const [activeAnimalCount, campCount, latestObs] = await Promise.all([
        prisma.animal.count({ where: { status: "active" } }),
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
        lastObservationAt: latestObs?.createdAt ?? null,
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
      lastObservationAt: null,
      tier: capped[i].tier,
      subscriptionStatus: capped[i].subscriptionStatus,
    };
  });
}
