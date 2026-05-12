import { NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import { scoped } from "@/lib/server/species-scoped-prisma";
import { ACTIVE_STATUS } from "@/lib/animals/active-species-filter";
import { withServerTiming, timeAsync } from "@/lib/server/server-timing";
import { logger } from "@/lib/logger";

/**
 * GET /api/farm — current farm summary (species-scoped).
 *
 * Wave 226 (#222): the headline `animalCount` / `campCount` are filtered by
 * the active FarmMode cookie (`farmtrack-mode-<slug>`). On a multi-species
 * tenant, switching from cattle → sheep returns sheep totals, matching what
 * every other per-species surface (admin animals, admin camps, admin mobs)
 * already shows. The previous farm-wide aggregate documented a known-wrong
 * behaviour per #28 AC — fixed by routing the counts through the
 * `scoped(prisma, mode)` facade from PRD #222 / issue #224.
 *
 * The cross-species reconciliation total (head across every species) is
 * surfaced by the admin animals page directly (issue #205), not here.
 */
export async function GET() {
  return withServerTiming(async () => {
    // Phase D (P6): `getFarmContext` reads proxy's signed header triplet
    // via next/headers when no `req` is passed, so a legacy zero-arg
    // handler gets the same fast-path. Falls back to getServerSession
    // transparently when the triplet is missing.
    const ctx = await timeAsync("session", () => getFarmContext());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const mode = await getFarmMode(ctx.slug);
      const sp = scoped(ctx.prisma, mode);
      const summary = await timeAsync("query", async () => {
        const [settings, animalCount, campCount] = await Promise.all([
          ctx.prisma.farmSettings.findFirst(),
          // Facade injects `{ species: mode }` automatically; caller adds
          // `status: ACTIVE_STATUS` to scope to live head.
          sp.animal.count({ where: { status: ACTIVE_STATUS } }),
          sp.camp.count(),
        ]);
        return {
          farmName: settings?.farmName ?? "My Farm",
          breed: settings?.breed ?? "Mixed",
          heroImageUrl: settings?.heroImageUrl ?? "/farm-hero.jpg",
          animalCount,
          campCount,
        };
      });
      return NextResponse.json(summary);
    } catch (err) {
      const e = err as Record<string, unknown>;
      logger.error('[GET /api/farm] query failed', {
        message: e?.message,
        code: e?.code,
      });
      return NextResponse.json({ error: "Failed to load farm data" }, { status: 500 });
    }
  });
}
