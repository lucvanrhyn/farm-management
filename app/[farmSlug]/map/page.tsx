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
import { scoped } from "@/lib/server/species-scoped-prisma";
import type { CampData } from "@/components/map/layers/CampLayer";
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

  // Camp markers honour the active species (PRD #222 / #224). The species-
  // scoped facade enforces the `where: { species: mode }` predicate at
  // compile time — `audit-species-where` would fail CI without it.
  const mode = await getFarmMode(farmSlug);
  const [settings, camps] = await Promise.all([
    prisma.farmSettings.findFirst({
      select: { latitude: true, longitude: true },
    }),
    scoped(prisma, mode).camp.findMany({ orderBy: { campName: "asc" } }),
  ]);

  // CampData shape matches what FarmMap / CampLayer consume. Camps without
  // a `geojson` boundary are skipped by CampLayer (the GeoJSON builder
  // returns no features for them) — this is the documented v1 marker-
  // fallback behaviour. Backfilling boundaries is tracked separately.
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

  const campsWithoutBoundary = campData.filter((d) => !d.camp.geojson).length;

  return (
    <div className="min-w-0 p-3 md:p-6 bg-[#FAFAF8]">
      <div className="mb-3 md:mb-4">
        <h1 className="text-xl md:text-2xl font-bold text-[#1C1815]">Farm map</h1>
        <p className="text-xs md:text-sm mt-1" style={{ color: "#9C8E7A" }}>
          {camps.length} camp{camps.length === 1 ? "" : "s"}
          {campsWithoutBoundary > 0
            ? ` · ${campsWithoutBoundary} without boundary geometry yet`
            : ""}
        </p>
      </div>

      <TenantMapClient
        campData={campData}
        farmLat={settings?.latitude ?? null}
        farmLng={settings?.longitude ?? null}
      />
    </div>
  );
}
