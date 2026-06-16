export const dynamic = "force-dynamic";

/**
 * Admin Map — Wave 3E scaffold.
 *
 * Hosts FarmMap and wires long-press → Log-at-Spot sheet (Advanced tier)
 * or a small upgrade prompt (Basic tier). The full layer palette lives in
 * FarmMap's LayerToggle.
 */

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";
import type { CampData } from "@/components/map/layers/CampLayer";
import { normaliseCampColor } from "@/components/map/layers/_camp-colors";
import AdminMapClient from "./AdminMapClient";

export default async function AdminMapPage({
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
      <div className="min-w-0 p-4 md:p-8 bg-[var(--ft-bg)]">
        <p className="text-sm text-[var(--ft-crit)]">Farm not found.</p>
      </div>
    );
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return (
      <div className="min-w-0 p-4 md:p-8 bg-[var(--ft-bg)]">
        <p className="text-sm text-[var(--ft-crit)]">Farm not found.</p>
      </div>
    );
  }

  // A physical camp grazes whatever species is on it — camps are NOT a
  // per-species concept (issue #364). The admin map must show every camp
  // in every FarmMode, so the camp list is read through the cross-species
  // door. (Wave 233 originally routed this through `scoped(prisma, mode)`,
  // which made a sheep-mode tenant see "0 camps" on a cattle-tagged farm.)
  const [settings, camps] = await Promise.all([
    prisma.farmSettings.findFirst({
      select: { latitude: true, longitude: true },
    }),
    crossSpecies(prisma, "farm-wide-audit").camp.findMany({
      orderBy: { campName: "asc" },
    }),
  ]);

  const campData: CampData[] = camps.map((c) => ({
    camp: {
      camp_id: c.campId,
      camp_name: c.campName,
      size_hectares: c.sizeHectares ?? undefined,
      water_source: c.waterSource ?? undefined,
      geojson: c.geojson ?? undefined,
      // Normalise empty/blank/invalid stored colours to the shared default so
      // a legacy `color = ''` row never reaches the `to-color` paint
      // expression on the camp-outline layer (#466). `?? undefined` alone let
      // `""` slip through and fire a "could not parse color" style error.
      color: normaliseCampColor(c.color),
    },
    stats: { total: 0, byCategory: {} },
    grazing: "Good",
  }));

  // Mono sub-line for the dark map header (replaces the light page header that
  // lived here). The "Route today →" link + serif title now render inside
  // FarmMap's dark header bar via AdminMapClient.
  const campsWithBoundary = campData.filter((d) => !!d.camp.geojson).length;
  const headerSubtext = `${camps.length} camp${camps.length === 1 ? "" : "s"} · ${campsWithBoundary} with boundary geometry · long-press to log at a spot`;

  return (
    <div className="ft-scope min-w-0 p-4 md:p-8 bg-[var(--ft-bg)]">
      <AdminMapClient
        farmSlug={farmSlug}
        tier={creds.tier}
        campData={campData}
        farmLat={settings?.latitude ?? null}
        farmLng={settings?.longitude ?? null}
        headerSubtext={headerSubtext}
      />
    </div>
  );
}
