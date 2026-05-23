export const dynamic = "force-dynamic";
import CampSelector from "@/components/logger/CampSelector";
import { LoggerStatusBar } from "@/components/logger/LoggerStatusBar";
import { SignOutButton } from "@/components/logger/SignOutButton";
import { TodaysTasks } from "@/components/logger/TodaysTasks";
import { getSession } from "@/lib/auth";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { logger } from "@/lib/logger";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";
import type { PrismaClient } from "@prisma/client";
import type { SpeciesId } from "@/lib/species/types";


function getTodayLabel(): string {
  return new Intl.DateTimeFormat("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date())
}

/**
 * Hotfix P0.2 (2026-05-03) — never let a `farmSettings` lookup take down
 * the entire logger surface. The page was returning a deterministic SSR
 * 500 (digest 3514534429) on prod for delta-livestock because any throw
 * in `prisma.farmSettings.findFirst()` (cached-client schema drift,
 * libSQL token expiry, network) propagated straight to Next.js's error
 * boundary. Field workers couldn't open the logger at all.
 *
 * Resolution: catch + log + fall back to the brand default. The camp
 * picker (the only thing field workers actually need) renders regardless.
 *
 * See memory/production-triage-2026-05-03.md (P0.2).
 */
async function resolveFarmName(farmSlug: string): Promise<string> {
  const FALLBACK = "FarmTrack";
  try {
    const prisma = await getPrismaForFarm(farmSlug);
    if (!prisma) return FALLBACK;
    const farmSettings = await prisma.farmSettings.findFirst();
    return farmSettings?.farmName ?? FALLBACK;
  } catch (err) {
    logger.error("[logger/page] farmSettings lookup failed — falling back to brand default", {
      farmSlug,
      error: err,
    });
    return FALLBACK;
  }
}

/**
 * Issue #234 introduced this lookup to fetch the camp IDs visible to the
 * client picker (`<CampSelector />`) so it could filter the IDB-backed
 * camp list before rendering tiles. The original implementation routed
 * through `scoped(prisma, mode).camp.findMany` — same pattern as
 * `admin/animals/page.tsx` (Wave 1 proof-of-pattern, #224).
 *
 * Issue #390 (PRD #389, Module 4) reclassifies this read to
 * `crossSpecies("farm-wide-audit")`. Camps are CROSS-species
 * infrastructure: a physical camp grazes whatever species is on it,
 * regardless of the user's active FarmMode. On Trio B (cattle-only farm
 * tagged `species='cattle'`) under sheep FarmMode the `scoped()` door
 * injected `where: { species: 'sheep' }` and returned zero rows, so the
 * `Set<string>` of allowed IDs was empty and the Sheep Logger picker
 * filtered every camp out of view. PR #373 (#364) fixed the same bug
 * class on the camp map by flipping to `crossSpecies("farm-wide-audit")`;
 * #390 finishes the ADR-0005 Wave-5 camp-scope reclassification this
 * page started.
 *
 * The `mode` parameter is kept on the signature so callers always pass
 * the active FarmMode (forward-compat for any future per-species filter
 * the picker may add — task-list overlay, recommended-camp banner, etc.).
 * The Prisma read itself is now FarmMode-invariant.
 *
 * Resilience: this lookup runs alongside the SSR-resilient farmName
 * fetch and follows the same pattern — never let a Prisma throw take
 * down the entire logger surface for field workers. If the facade
 * throws, we fall back to `undefined` so `<CampSelector />` renders all
 * IDB-cached camps (back-compat path) — same behaviour as before #234.
 *
 * Offline-queue boundary (ADR-0002): this fetch reads camp IDs only; it
 * does NOT touch `lib/sync/queue.ts`, `lib/sync-manager.ts`, or
 * `lib/offline-store.ts`. Observations queued before this fix keep
 * flushing through the existing queue.
 */
async function resolveAllowedCampIds(
  farmSlug: string,
  mode: SpeciesId,
): Promise<Set<string> | undefined> {
  try {
    const prisma = await getPrismaForFarm(farmSlug);
    if (!prisma) return undefined;
    const camps = await crossSpecies(prisma as PrismaClient, "farm-wide-audit").camp.findMany({
      select: { campId: true },
      orderBy: { campName: "asc" },
    });
    return new Set(camps.map((c) => c.campId));
  } catch (err) {
    logger.error("[logger/page] cross-species camp fetch failed — falling back to unfiltered picker", {
      farmSlug,
      mode,
      error: err,
    });
    return undefined;
  }
}

export default async function LoggerPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const todayLabel = getTodayLabel();
  const session = await getSession();
  const loggerName = session?.user?.name ?? "Logger";

  const mode = await getFarmMode(farmSlug);
  const [farmName, allowedCampIds] = await Promise.all([
    resolveFarmName(farmSlug),
    resolveAllowedCampIds(farmSlug, mode),
  ]);

  return (
    <div className="min-h-screen">
      {/* Header — white */}
      <div
        className="sticky top-0 z-10"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.97)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
        }}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <div>
            <h1
              className="text-2xl font-bold leading-tight"
              style={{ fontFamily: 'var(--font-display)', color: '#1A1510' }}
            >
              {farmName}
            </h1>
            <p className="text-xs" style={{ color: '#5C3D2E' }}>{loggerName} · Select a camp</p>
          </div>
          <div className="flex items-center gap-2">
            <SignOutButton />
          </div>
        </div>

        {/* Date bar */}
        <div
          className="text-xs px-4 py-2 text-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.03)', color: 'rgba(92,61,46,0.7)' }}
        >
          {todayLabel}
        </div>

        {/* Offline status bar */}
        <LoggerStatusBar />
      </div>

      <TodaysTasks />

      <CampSelector allowedCampIds={allowedCampIds} />

      <div className="h-8" />
    </div>
  );
}
