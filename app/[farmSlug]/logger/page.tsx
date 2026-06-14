export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import CampSelector from "@/components/logger/CampSelector";
import { LoggerStatusBar } from "@/components/logger/LoggerStatusBar";
import { SignOutButton } from "@/components/logger/SignOutButton";
import { TodaysTasks } from "@/components/logger/TodaysTasks";
import { getSession } from "@/lib/auth";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { logger } from "@/lib/logger";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";
import { getCachedCampList } from "@/lib/server/cached";
import { shouldRenderSheepEmptyState } from "@/lib/domain/camp/inspection-freshness";
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

export const metadata: Metadata = {
  title: "Logger — FarmTrack",
};

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
  const [farmName, allowedCampIds, sheepEmpty] = await Promise.all([
    resolveFarmName(farmSlug),
    resolveAllowedCampIds(farmSlug, mode),
    // Issue #437 — server-side check whether to render the sheep empty-state
    // banner in place of the misleading "19 × 0 animals · Just now" grid.
    // Failure-isolated: if the cached camp list throws we fall back to
    // false and the picker renders as usual (existing behaviour).
    getCachedCampList(farmSlug, mode)
      .then((camps) => shouldRenderSheepEmptyState(mode, camps))
      .catch((err) => {
        logger.error("[logger/page] sheep empty-state check failed — falling back to picker render", {
          farmSlug,
          mode,
          error: err,
        });
        return false;
      }),
  ]);

  // Weekday for the editorial mono subtitle ("{user} · {weekday}").
  const weekday = new Intl.DateTimeFormat("en-ZA", { weekday: "long" }).format(new Date());

  return (
    <div className="dark-surface ft-scope min-h-screen">
      {/* Header — dark editorial chrome */}
      <div
        className="sticky top-0 z-10"
        style={{
          backgroundColor: 'color-mix(in oklab, var(--ft-bg) 92%, transparent)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          borderBottom: '1px solid var(--ft-border)',
        }}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <div
              className="ft-mono"
              style={{ fontSize: 10, letterSpacing: '.16em', color: 'var(--ft-subtle)', textTransform: 'uppercase' }}
            >
              Logger · {farmName}
            </div>
            <h1
              className="ft-serif truncate"
              style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.05, marginTop: 4, color: 'var(--ft-text)' }}
            >
              Camp Rounds
            </h1>
            <div className="ft-mono" style={{ fontSize: 11, color: 'var(--ft-muted)', marginTop: 5 }}>
              {loggerName} · {weekday}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <SignOutButton />
          </div>
        </div>

        {/* Date bar */}
        <div
          className="ft-mono text-center"
          style={{
            fontSize: 11,
            letterSpacing: '.04em',
            padding: '6px 16px',
            backgroundColor: 'var(--ft-surface)',
            borderTop: '1px solid var(--ft-border)',
            color: 'var(--ft-subtle)',
          }}
        >
          {todayLabel}
        </div>

        {/* Offline status bar — logic preserved, chrome restyled to tokens */}
        <LoggerStatusBar />
      </div>

      <TodaysTasks />

      {/* Issue #437 — sheep empty-state banner. Trio (cattle-only data)
          on Sheep mode used to render 19 misleading "0 animals · Just now"
          camp tiles. The server-side `shouldRenderSheepEmptyState`
          predicate gates on `mode === 'sheep'` AND every camp's
          species-scoped `animal_count === 0` (powered by the new
          /api/camps?species=sheep payload). When the gate is true we
          render this banner INSTEAD of the camp grid, so the field
          worker sees one clear "no sheep structure yet" message rather
          than a misleading 19-tile grid.

          The Cattle / Game paths are untouched — CampSelector renders
          its existing grid + #370 empty state for those modes. */}
      {sheepEmpty ? (
        <div className="flex justify-center p-4">
          <div
            data-testid="logger-sheep-empty-state-banner"
            className="ft-card flex flex-col items-center gap-3 px-8 py-12 text-center w-full max-w-sm"
          >
            <div
              aria-hidden="true"
              className="flex size-14 items-center justify-center rounded-full"
              style={{
                backgroundColor: 'var(--ft-surface2)',
                border: '1px solid var(--ft-border2)',
                color: 'var(--ft-accent)',
              }}
            >
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 10h18" />
                <path d="M9 5v14" />
                <path d="M15 5v14" />
              </svg>
            </div>
            <h2
              className="ft-serif text-lg font-semibold"
              style={{ color: 'var(--ft-text)' }}
            >
              No sheep mob structure yet
            </h2>
            <p className="text-sm" style={{ color: 'var(--ft-muted)', lineHeight: 1.5 }}>
              {/* #382 spacing pin — `{" "}` literal preserved after the
                  inline {expression} so the SWC space-strip transform does
                  not glue the next word ("Mobs" / "Cattle"). */}
              Set up mobs in Admin{" "}&rarr;{" "}Mobs, or switch to Cattle
              to start logging.
            </p>
          </div>
        </div>
      ) : (
        <CampSelector allowedCampIds={allowedCampIds} />
      )}

      <div className="h-8" />
    </div>
  );
}
