import { unstable_cache } from "next/cache";
import { withFarmPrisma } from "@/lib/farm-prisma";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";
import { farmTag } from "@/lib/server/cache-tags";
import { ACTIVE_STATUS } from "@/lib/animals/active-species-filter";

/**
 * lib/domain/farm/get-farm-identity.ts
 *
 * Deep module — server-side only, no "use client".
 *
 * Returns the branded identity data required to render the farm hero on
 * `/<farmSlug>/home` without a client-side fetch or a loading state.
 *
 * ADR-0005 compliance: farm identity is mode-independent (the same farm
 * name/breed/image is shown regardless of the active species view), so
 * we use the `crossSpecies()` named door rather than `scoped()`.
 *
 * Cache design (PRD #412 / #434):
 *   - Tagged `farm-<slug>-identity` for narrow invalidation.
 *   - `revalidateFarmIdentityWrite(slug)` in `lib/server/revalidate.ts`
 *     busts this tag whenever `FarmSettings` is written, so a farm-name
 *     or hero-image change is visible on next hard-refresh without waiting
 *     for the TTL.
 *   - 300s TTL (5 min) as a belt-and-suspenders fallback.
 */

export interface FarmIdentity {
  farmName: string;
  breed: string;
  heroImageUrl: string;
  animalCount: number;
  campCount: number;
}

const DEFAULT_FARM_NAME = "My Farm" as const;
const DEFAULT_BREED = "Mixed" as const;
const DEFAULT_HERO_IMAGE_URL = "/farm-hero.jpg" as const;

async function fetchFarmIdentity(slug: string): Promise<FarmIdentity> {
  return withFarmPrisma(slug, async (prisma) => {
    const db = crossSpecies(prisma, "farm-wide-audit");

    const [settings, animalCount, campCount] = await Promise.all([
      prisma.farmSettings.findFirst(),
      db.animal.count({ where: { status: ACTIVE_STATUS } }),
      db.camp.count(),
    ]);

    return {
      farmName: settings?.farmName ?? DEFAULT_FARM_NAME,
      breed: settings?.breed ?? DEFAULT_BREED,
      heroImageUrl: settings?.heroImageUrl ?? DEFAULT_HERO_IMAGE_URL,
      animalCount,
      campCount,
    };
  });
}

/**
 * Returns farm hero identity for the given slug.
 *
 * Wrapped in `unstable_cache` tagged `farm-<slug>-identity` so the RSC page
 * renders from cache on repeat visits without a live Prisma round-trip.
 * Cache is invalidated on any `FarmSettings` write via
 * `revalidateFarmIdentityWrite` in `lib/server/revalidate.ts`.
 *
 * @throws when `withFarmPrisma` cannot find or connect to the farm DB —
 *   callers should handle this at the page level (Next.js error boundary).
 */
export async function getFarmIdentity(slug: string): Promise<FarmIdentity> {
  const cached = unstable_cache(
    (s: string) => fetchFarmIdentity(s),
    [`farm-identity-${slug}`],
    {
      revalidate: 300,
      tags: [farmTag(slug, "identity")],
    },
  );
  return cached(slug);
}
