// lib/server/has-multiple-species.ts
//
// Issue #235 — detect whether a tenant carries multiple species in its
// Animal table so the ModeSwitcher knows whether to render the dimmed
// "+ Add species" upsell pill.
//
// Cross-species by design: we explicitly groupBy across every species.
// This file is added to the `audit-species-where` allowlist in the
// audit script (see `lib/server/cached.ts` precedent) so the static
// check does not flag the intentional un-scoped query.
//
// Cached wrapper lives in `lib/server/cached.ts`
// (`getCachedHasMultipleActiveSpecies`). Tagged on `farm-<slug>-animals`
// so any animal mutation revalidates the upsell-pill visibility
// alongside the per-species counts the dashboard already invalidates.

import { withFarmPrisma } from "@/lib/farm-prisma";

/**
 * Returns `true` iff `prisma.animal.groupBy({ by: ['species'] })`
 * against status:"Active" rows yields 2 or more distinct species
 * groups. Zero or one distinct species → `false` (the upsell shows).
 *
 * Fails closed: on Prisma/Turso outage, returns `false` so the upsell
 * pill renders (preferable to crashing the page header).
 */
export async function hasMultipleActiveSpecies(
  farmSlug: string,
): Promise<boolean> {
  try {
    return await withFarmPrisma(farmSlug, async (prisma) => {
      // audit-allow-species-where: intentional cross-species count for #235 upsell-pill visibility
      const groups = await prisma.animal.groupBy({
        by: ["species"],
        where: { status: "Active" },
      });
      return groups.length >= 2;
    });
  } catch {
    // Fail-closed: surface the upsell rather than break the header.
    return false;
  }
}
