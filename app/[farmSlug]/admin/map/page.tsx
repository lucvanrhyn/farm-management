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
import { getLatestCampConditions } from "@/lib/server/camp-status";
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
  // Camp list, live grazing conditions, and active head-count per camp are
  // fetched together so the right-hand camps panel (desk_3.jpg) renders a real
  // status-dot ramp + head count per row instead of placeholder zeros. The
  // head-count groupBy keys on `Animal.currentCamp` (= the camp_id, per the
  // CampsTable idiom) and counts only `status: "Active"` animals — both are
  // the established truthful patterns from components/admin/CampsTable.tsx.
  const [settings, camps, liveConditions] = await Promise.all([
    prisma.farmSettings.findFirst({
      select: { latitude: true, longitude: true },
    }),
    crossSpecies(prisma, "farm-wide-audit").camp.findMany({
      orderBy: { campName: "asc" },
    }),
    // Fail-open: per-camp grazing status is decorative enrichment for the camps
    // panel — a tenant-DB blip must NOT stop the map (#364: every camp renders
    // regardless of mode/condition availability).
    getLatestCampConditions(prisma).catch(() => new Map()),
  ]);

  // cross-species by design: the map totals every species per camp (camps are
  // cross-species infrastructure, ADR-0005). Facade returns Prisma's broadest
  // groupBy shape — re-narrow to this query's by/_count selection.
  // Fail-open: head counts are decorative for the camps panel — if the rollup
  // query errors (or a mock lacks it), every camp must still render (#364).
  const animalGroups = (await crossSpecies(prisma, "analytics-rollup").animal.groupBy({
    by: ["currentCamp"],
    where: { currentCamp: { in: camps.map((c) => c.campId) }, status: "Active" },
    _count: { _all: true },
  }).catch(() => [])) as unknown as Array<{ currentCamp: string | null; _count: { _all: number } }>;
  const countByCamp = new Map(animalGroups.map((g) => [g.currentCamp, g._count._all]));

  const campData: CampData[] = camps.map((c) => {
    const headCount = countByCamp.get(c.campId) ?? 0;
    return {
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
      stats: { total: headCount, byCategory: {} },
      // Real latest grazing condition per camp; "Fair" mirrors the CampsTable
      // fallback when a camp has no logged camp_condition yet.
      grazing: liveConditions.get(c.campId)?.grazing_quality ?? "Fair",
    };
  });

  // Mono sub-line for the dark map header (matches desk_3.jpg:
  // "19 camps · 16 with boundary geometry · 875 head"). The "Route today →"
  // link + serif title render inside FarmMap's dark header bar via AdminMapClient.
  const campsWithBoundary = campData.filter((d) => !!d.camp.geojson).length;
  const totalHead = campData.reduce((sum, d) => sum + d.stats.total, 0);
  const headerSubtext = `${camps.length} camp${camps.length === 1 ? "" : "s"} · ${campsWithBoundary} with boundary geometry · ${totalHead} head`;

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
