// lib/server/has-multiple-species.ts
//
// Issue #235 — detect whether a tenant carries multiple species in its
// Animal table so the ModeSwitcher knows whether to render the dimmed
// "+ Add species" upsell pill.
//
// Cross-species by design: we explicitly groupBy across every species.
// The query goes through the `crossSpecies(prisma, reason)` door
// (ADR-0005) so the structural arch test recognises the intentional
// cross-species span — no allowlist or pragma needed.
//
// Cached wrapper lives in `lib/server/cached.ts`
// (`getCachedHasMultipleActiveSpecies`). Tagged on `farm-<slug>-animals`
// so any animal mutation revalidates the upsell-pill visibility
// alongside the per-species counts the dashboard already invalidates.

import { withFarmPrisma } from "@/lib/farm-prisma";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";

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
      // crossSpecies() forwards args verbatim; the facade returns Prisma's
      // broadest groupBy shape (documented trade-off) so re-narrow to what
      // this query's by selection produces — behaviour-identical. The
      // cross-species span is intentional (#235 upsell-pill visibility).
      const groups = (await crossSpecies(
        prisma,
        "species-registry-internal",
      ).animal.groupBy({
        by: ["species"],
        where: { status: "Active" },
      })) as unknown as Array<{ species: string | null }>;
      return groups.length >= 2;
    });
  } catch {
    // Fail-closed: surface the upsell rather than break the header.
    return false;
  }
}
