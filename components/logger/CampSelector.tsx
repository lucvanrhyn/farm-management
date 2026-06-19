"use client";

import { useRouter, useParams } from "next/navigation";
import { useOffline } from "./OfflineProvider";
import { relativeTime } from "@/lib/utils";
import { useFarmModeSafe } from "@/lib/farm-mode";
import { getSpeciesModule } from "@/lib/species/registry";
import { ModeSwitcher } from "@/components/ui/ModeSwitcher";
import { Card, StatusDot, Icon } from "@/components/ds";
import {
  grazingToStatus,
  waterToStatus,
  fenceToStatus,
  statusVar,
} from "./grazing-status";

// CampSelector sits on the logger's critical path. Previously it imported
// framer-motion (~90KB gzipped) for a stagger-in entrance + tap-scale
// feedback. The stagger actually *delays* the moment the user can tap
// their target camp, so dropping it is both a perf win and a UX win. Tap
// feedback is now `active:scale-95` via Tailwind — pure CSS, zero JS.

function CampSkeleton() {
  return (
    <div
      className="ft-card relative p-4 flex flex-col gap-2 min-h-[112px] animate-pulse"
    >
      <div className="h-4 w-3/4 rounded-md" style={{ backgroundColor: 'var(--ft-surface2)' }} />
      <div className="h-3 w-1/2 rounded-md" style={{ backgroundColor: 'var(--ft-surface2)' }} />
      <div className="h-5 w-1/3 rounded-full mt-auto" style={{ backgroundColor: 'var(--ft-surface2)' }} />
    </div>
  );
}

/**
 * Issue #370 — species-aware empty state.
 *
 * Distinct from `CampSkeleton`: the skeleton is the LOADING state (IDB
 * cache not hydrated, `camps.length === 0`). This is the EMPTY state —
 * the farm HAS camps in IDB, but the FarmMode / `allowedCampIds` filter
 * leaves none visible for the active species. Pre-fix this rendered a
 * blank tile grid that looked like broken data on a sheep farm with no
 * sheep camps.
 *
 * `speciesLabel` is lower-cased so the copy reads naturally ("No sheep
 * camps yet"). Styled for the logger's dark-glass surface — the white
 * admin-themed `components/camps/CampsEmptyState.tsx` would clash here.
 */
function CampEmptyState({ speciesLabel }: { speciesLabel: string }) {
  return (
    <div className="flex justify-center p-4">
      <div
        data-testid="camp-selector-empty-state"
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
          {/* Inline paddock / fenced-area glyph, pure CSS — no new asset.
              Matches CampsEmptyState's camp glyph for visual consistency. */}
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
          {/* #382: pin the space with {" "} — a bare literal space after an
              {expression} is stripped by the build-time SWC transform. */}
          No {speciesLabel}{" "}camps yet
        </h2>
        <p className="text-sm" style={{ color: 'var(--ft-muted)', lineHeight: 1.5 }}>
          {/* #382: same {" "} pin — this is the line that glued in prod
              ("Add a sheepcamp to start logging."). */}
          Add a {speciesLabel}{" "}camp to start logging. Camps for other species
          are kept separate and won&apos;t show here.
        </p>
      </div>
    </div>
  );
}

/**
 * Issue #234 — Logger camp tiles filter by FarmMode.
 *
 * The IDB-backed `useOffline().camps` is not species-aware (the Camp
 * shape in `lib/types.ts` has no `species` field, and the cached
 * `/api/camps` response doesn't filter `camp.findMany` by species — only
 * `animal.groupBy` is mode-scoped). On a multi-species tenant this used
 * to leak sheep/game camps into a cattle operator's picker — a real
 * data-corruption risk because a cattle inspection logged against a
 * sheep camp downstream-feeds the wrong species' Einstein RAG slice.
 *
 * The fix: the server page (`app/[farmSlug]/logger/page.tsx`) pre-fetches
 * the camps for the active mode via the species-scoped Prisma facade
 * (`scoped(prisma, mode).camp.findMany(...)`, PRD #222 / #224) and
 * passes their IDs down as `allowedCampIds`. The picker filters the
 * IDB-backed list against the allowlist before rendering tiles.
 *
 * Why an allowlist prop and not "stop reading from IDB":
 *   - the IDB cache is the offline source of truth; we cannot ditch it
 *     without breaking the offline-first UX
 *   - the offline-queue boundary (ADR-0002, `lib/sync/queue.ts`) is
 *     untouched — queued observations for any camp keep flushing
 *     regardless of which tile the user sees today
 *   - back-compat path (allowedCampIds === undefined) preserves the
 *     pre-fix render for unit tests and any future offline-only paint
 *     where the server prop hasn't hydrated yet.
 */
interface CampSelectorProps {
  /**
   * Allowed camp IDs for the active FarmMode. When provided, the picker
   * filters its IDB-backed camp list against this set so cross-species
   * tiles can't be selected. When undefined, all IDB camps render
   * (back-compat / offline-first first paint).
   */
  allowedCampIds?: ReadonlySet<string>;
}

export default function CampSelector({ allowedCampIds }: CampSelectorProps = {}) {
  const router = useRouter();
  const params = useParams<{ farmSlug: string }>();
  const { camps } = useOffline();
  const { isMultiMode, mode } = useFarmModeSafe();

  const visibleCamps = allowedCampIds
    ? camps.filter((c) => allowedCampIds.has(c.camp_id))
    : camps;

  // State 1 — LOADING. The IDB cache has not hydrated yet, so we cannot
  // know whether the active species has zero camps. Unchanged by #370.
  if (camps.length === 0) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <CampSkeleton key={i} />
        ))}
      </div>
    );
  }

  // Species label for the active FarmMode, e.g. "sheep" / "cattle" / "game".
  const speciesLabel = getSpeciesModule(mode).config.label.toLowerCase();

  return (
    <div>
      {/* Mode switcher for logger — only shown when multi-species */}
      {isMultiMode && (
        <div className="flex justify-center pt-3 pb-1">
          <ModeSwitcher variant="glass" />
        </div>
      )}
      {/* State 2 — EMPTY. Camps exist in IDB but none are visible for the
          active species (filtered out by `allowedCampIds`). Issue #370:
          show an explicit species-aware empty state, not a blank grid. */}
      {visibleCamps.length === 0 ? (
        <CampEmptyState speciesLabel={speciesLabel} />
      ) : (
      <div className="grid grid-cols-2 gap-2.5 p-4">
      {visibleCamps.map((camp) => {
        const animalCount = camp.animal_count ?? 0;
        const lastTime = camp.last_inspected_at ? relativeTime(camp.last_inspected_at) : "Never";
        // Status dot maps the recorded grazing quality onto the warm token
        // scale. No condition recorded yet → neutral subtle dot (no default
        // to "Fair", matching the prior grey-dot behaviour).
        const grazingStatus = camp.grazing_quality ? grazingToStatus(camp.grazing_quality) : null;

        // Condition-icon row (grass/water/fence) tinted by recorded status.
        const conditionIcons: Array<{ key: string; Ico: typeof Icon.grass; color: string }> = [
          {
            key: "grass",
            Ico: Icon.grass,
            color: camp.grazing_quality ? statusVar(grazingToStatus(camp.grazing_quality)) : "var(--ft-subtle)",
          },
          {
            key: "water",
            Ico: Icon.water,
            color: camp.water_status ? statusVar(waterToStatus(camp.water_status)) : "var(--ft-subtle)",
          },
          {
            key: "fence",
            Ico: Icon.fence,
            color: camp.fence_status ? statusVar(fenceToStatus(camp.fence_status)) : "var(--ft-subtle)",
          },
        ];

        return (
          <Card
            key={camp.camp_id}
            as="button"
            interactive
            lift
            onClick={() => router.push(`/${params.farmSlug}/logger/${encodeURIComponent(camp.camp_id)}`)}
            className="relative p-4 text-left flex flex-col gap-2 min-h-[112px] active:scale-95 transition-transform duration-150 ease-out"
          >
            {/* Grazing status dot */}
            <div className="absolute top-3.5 right-3.5">
              {grazingStatus ? (
                <StatusDot status={grazingStatus} size={9} />
              ) : (
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ background: "var(--ft-subtle)" }}
                />
              )}
            </div>

            <div>
              <p
                className="ft-serif text-[22px] leading-none pr-6"
                style={{ fontWeight: 500, color: "var(--ft-text)" }}
              >
                {camp.camp_name}
              </p>
              <p className="ft-mono text-[10px] mt-2" style={{ color: "var(--ft-subtle)" }}>
                {lastTime}
              </p>
            </div>

            <div className="mt-auto flex items-center justify-between gap-2">
              <span
                className="ft-mono text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap"
                style={{
                  backgroundColor: "var(--ft-surface2)",
                  color: "var(--ft-muted)",
                }}
              >
                {animalCount} head
              </span>
              <div className="flex items-center gap-1.5">
                {conditionIcons.map(({ key, Ico, color }) => (
                  <Ico key={key} size={13} style={{ color }} />
                ))}
              </div>
            </div>
          </Card>
        );
      })}
      </div>
      )}
    </div>
  );
}
