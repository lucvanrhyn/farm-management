import { NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { ACTIVE_STATUS } from "@/lib/animals/active-species-filter";
import { withServerTiming, timeAsync } from "@/lib/server/server-timing";
import { logger } from "@/lib/logger";

/**
 * GET /api/farm — current farm summary (FARM-WIDE aggregate).
 *
 * Wave 320 (#320 / PRD #318): `animalCount` / `campCount` are true
 * farm-wide totals — every species — and are deliberately decoupled from
 * the ambient `farmtrack-mode-<slug>` cookie.
 *
 * History & root cause: Wave 226 (#222/#226) routed these headline counts
 * through the species-scoped `scoped(prisma, mode)` facade, reading the
 * per-farm FarmMode cookie. `/api/farm` is a farm-wide summary endpoint,
 * so any client surface that consumed it inherited the last species
 * context: a sheep-mode visit on a cattle-heavy farm yielded 0/0 (Trio:
 * 874 animals / 19 camps shown as 0/0 under the Sheep toggle). A global
 * UI species filter is not safe input for a farm-wide aggregate. The
 * counts now match the already-correct `getCachedFarmSummary` semantics
 * in `lib/server/cached.ts` (`animal.count({ status: ACTIVE_STATUS })`,
 * `camp.count()` — cross-species by design).
 *
 * Per-species head is surfaced by the per-species admin pages (admin
 * animals / camps / mobs) and the reconciliation total by the admin
 * animals page directly (issue #205), not here.
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
      const summary = await timeAsync("query", async () => {
        const [settings, animalCount, campCount] = await Promise.all([
          ctx.prisma.farmSettings.findFirst(),
          // Farm-wide, cross-species by design (#320): NOT scoped by the
          // `farmtrack-mode` cookie. `status: ACTIVE_STATUS` keeps this to
          // live head only.
          ctx.prisma.animal.count({ where: { status: ACTIVE_STATUS } }),
          ctx.prisma.camp.count(),
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
