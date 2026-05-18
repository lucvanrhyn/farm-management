"use client";

/**
 * CampPresenceFallback — non-map list panel + setup-state CTA for camps that
 * lack a drawn boundary `geojson` (issue #322, PRD #318 Wave R5).
 *
 * Root cause this closes: `buildCampGeoJSON()` skips geometry-less camps
 * (`if (!camp.geojson) continue;`), so on real tenants the majority of camps
 * (Basson 8/9, Trio 16/19) never become map features and there is NO other
 * way to reach them. This is a data-modeling / UX gap, not a rendering bug —
 * camps WITH geometry still render on the map unchanged.
 *
 * Design (HITL-locked on #322): no fabricated coordinates, no approximate
 * point-markers. Instead:
 *   - A non-map LIST of the geometry-less camps, rendered as a sibling panel
 *     to <FarmMap> (NOT inside FarmMap.tsx — PR #305 owns that file). Each row
 *     links to the same camp destination a map polygon click reaches
 *     (`/<slug>/dashboard/camp/<id>`, matching CampPopupContent's primary
 *     action) and fires the existing `onCampClick(campId)` selection contract.
 *   - A persistent setup-state CTA showing the COUNT of camps missing
 *     boundaries, routing to the existing draw/edit boundary flow
 *     (`/<slug>/admin/map`).
 *
 * Renders nothing when every camp already has boundary geometry.
 */

import {
  selectCampsMissingGeometry,
  type CampData,
} from "@/components/map/layers/_camp-colors";

interface Props {
  campData: CampData[];
  farmSlug: string;
  /** Same selection contract a map polygon click uses (FarmMap onCampClick). */
  onCampClick: (campId: string) => void;
}

export default function CampPresenceFallback({
  campData,
  farmSlug,
  onCampClick,
}: Props) {
  const missing = selectCampsMissingGeometry(campData);
  if (missing.length === 0) return null;

  const slug = encodeURIComponent(farmSlug);

  return (
    <section
      data-testid="camp-presence-fallback"
      className="mt-3 md:mt-4 rounded-lg border border-[#E6DFD3] bg-white"
    >
      <div
        data-testid="camp-presence-cta"
        className="flex flex-col gap-2 border-b border-[#E6DFD3] p-3 md:flex-row md:items-center md:justify-between md:p-4"
      >
        <div>
          <p className="text-sm font-semibold text-[#1C1815]">
            {missing.length} camp{missing.length === 1 ? "" : "s"} without a map
            boundary
          </p>
          <p className="mt-0.5 text-xs" style={{ color: "#9C8E7A" }}>
            These camps can&apos;t show on the satellite map until you draw
            their boundary. They&apos;re still fully usable from the list below.
          </p>
        </div>
        <a
          href={`/${slug}/admin/map`}
          className="inline-flex shrink-0 items-center justify-center rounded-md bg-[#8B6914] px-3 py-2 text-xs font-semibold text-white hover:bg-[#735710]"
        >
          Draw boundaries &rarr;
        </a>
      </div>

      <ul className="divide-y divide-[#F0EBE1]">
        {missing.map(({ camp }) => (
          <li key={camp.camp_id}>
            <div
              data-testid={`camp-presence-row-${camp.camp_id}`}
              onClick={() => onCampClick(camp.camp_id)}
              className="flex cursor-pointer items-center justify-between gap-3 p-3 hover:bg-[#FAFAF8] md:px-4"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[#1C1815]">
                  {camp.camp_name}
                </p>
                {camp.size_hectares != null && (
                  <p className="text-xs" style={{ color: "#9C8E7A" }}>
                    {camp.size_hectares} ha
                  </p>
                )}
              </div>
              <a
                href={`/${slug}/dashboard/camp/${encodeURIComponent(
                  camp.camp_id,
                )}`}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 text-xs font-semibold text-[#8B6914] hover:underline"
              >
                Open &rarr;
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
