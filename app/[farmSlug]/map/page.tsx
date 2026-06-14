export const dynamic = "force-dynamic";

/**
 * Tenant map — `/[farmSlug]/map` (issue #256, parent PRD #250).
 *
 * v1 scope (HITL-locked 2026-05-13): render camps + animal positions on a
 * Mapbox tile layer, mobile-responsive, zero hydration errors. Defer
 * satellite-overlay polish and per-animal interaction polish.
 *
 * Why a separate page from `/[farmSlug]/admin/map`:
 *   - The admin map embeds long-press → Log-at-Spot (Advanced-tier feature)
 *     and a "Route today" link to a planning sub-route. That chrome is
 *     admin-only.
 *   - This page is the surface the home-tile pushes to (`/<slug>/map`),
 *     reachable for every tenant role including ones gated out of /admin.
 *   - Fixing the 404 inside `/admin/map/page.tsx` would change the admin
 *     page's URL surface and break existing links from issue #233 chrome.
 *
 * Pattern: mirror `/admin/map/page.tsx` (auth → meta-creds → per-farm Prisma
 * → species-scoped camp.findMany → settings lat/lng) but render a stripped-
 * down `TenantMapClient` that hosts FarmMap without the admin-only chrome.
 */

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import { getFarmMode } from "@/lib/server/get-farm-mode";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";
import type { CampData } from "@/components/map/layers/CampLayer";
import CampsEmptyState from "@/components/camps/CampsEmptyState";
import TenantMapClient from "./TenantMapClient";

export default async function TenantMapPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  const session = await getSession();
  if (!session) redirect(`/${farmSlug}/login`);

  const creds = await getFarmCreds(farmSlug);
  if (!creds) {
    return (
      <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
        <p className="text-sm text-red-600">Farm not found.</p>
      </div>
    );
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return (
      <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
        <p className="text-sm text-red-600">Farm not found.</p>
      </div>
    );
  }

  // A physical camp grazes whatever species is on it — camps are NOT a
  // per-species concept (issue #364). The map must show every camp in
  // every FarmMode, so the camp list is read through the cross-species
  // door, not the species-scoped one. `mode` is still read below to give
  // the zero-camps empty state species-correct onboarding copy.
  const mode = await getFarmMode(farmSlug);
  const [settings, camps] = await Promise.all([
    prisma.farmSettings.findFirst({
      select: { latitude: true, longitude: true },
    }),
    crossSpecies(prisma, "farm-wide-audit").camp.findMany({
      orderBy: { campName: "asc" },
    }),
  ]);

  // CampData shape matches what FarmMap / CampLayer consume. Camps without
  // a `geojson` boundary are skipped by the GeoJSON builder (no map feature)
  // — issue #322: they are now surfaced via the non-map CampPresenceFallback
  // list + setup-state CTA rendered as a sibling to <FarmMap> inside
  // TenantMapClient, so they are never silently unreachable.
  const campData: CampData[] = camps.map((c) => ({
    camp: {
      camp_id: c.campId,
      camp_name: c.campName,
      size_hectares: c.sizeHectares ?? undefined,
      water_source: c.waterSource ?? undefined,
      geojson: c.geojson ?? undefined,
      color: c.color ?? undefined,
    },
    stats: { total: 0, byCategory: {} },
    grazing: "Good",
  }));

  const campsWithBoundary = campData.filter((d) => !!d.camp.geojson).length;
  const totalHead = campData.reduce((sum, d) => sum + (d.stats?.total ?? 0), 0);

  return (
    <div className="ft-scope min-w-0 p-3 md:p-6" style={{ background: "var(--ft-bg)" }}>
      <div className="mb-3 md:mb-4">
        <h1
          className="ft-serif"
          style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.1, margin: 0, color: "var(--ft-text)" }}
        >
          Farm Map
        </h1>
        <p
          className="ft-mono"
          style={{ fontSize: 12, color: "var(--ft-muted)", marginTop: 6, letterSpacing: ".02em" }}
        >
          {camps.length} camp{camps.length === 1 ? "" : "s"} · {campsWithBoundary} with boundary geometry · {totalHead} head
        </p>
      </div>

      {campData.length === 0 ? (
        // The farm has no camps at all → onboarding empty state instead of a
        // blank map (#288). The camp read is cross-species (#364), so this
        // branch is reached only when the tenant has zero camps full stop;
        // `mode` is passed through purely for species-flavoured copy.
        <CampsEmptyState farmSlug={farmSlug} speciesLabel={mode} variant="overlay" />
      ) : (
        <TenantMapClient
          campData={campData}
          farmLat={settings?.latitude ?? null}
          farmLng={settings?.longitude ?? null}
          farmSlug={farmSlug}
        />
      )}
    </div>
  );
}
