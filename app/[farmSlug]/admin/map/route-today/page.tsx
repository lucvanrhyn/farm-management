
/**
 * Route Today — Wave 3E
 *
 * Shows today's pending TaskOccurrences as a nearest-neighbour tour through
 * the farm's camp polygons. Advanced-tier gated.
 *
 * Data flow:
 *   1. Resolve session + farm credentials.
 *   2. Gate on tier (basic → UpgradePrompt).
 *   3. Load today's pending occurrences + compute NN tour via
 *      `buildRouteToday` (pure, unit-tested).
 *   4. Hand { pins, tour, campData } to the RouteTodayMap client.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import RouteTodayMap from "@/components/map/RouteTodayMap";
import { buildRouteToday, type CampRef, type RouteTodayInput } from "@/lib/tasks/route-today";
import type { CampData } from "@/components/map/layers/CampLayer";

export default async function RouteTodayPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  const session = await getSession();
  if (!session) redirect(`/${farmSlug}/login`);

  const creds = await getFarmCreds(farmSlug);
  if (!creds || creds.tier === "basic") {
    return (
      <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
        <UpgradePrompt
          feature="Route Today"
          description="Optimised field-day routing through your camps' pending tasks."
          farmSlug={farmSlug}
        />
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

  // Farm centre comes from FarmSettings; safe fallback is null (buildRouteToday
  // starts at the first pin when centre is unknown).
  const [settings, prismaCamps] = await Promise.all([
    prisma.farmSettings.findFirst({
      select: { latitude: true, longitude: true },
    }),
    prisma.camp.findMany({ orderBy: { campName: "asc" } }),
  ]);

  const farmLat = settings?.latitude ?? null;
  const farmLng = settings?.longitude ?? null;
  const farmCentre =
    typeof farmLat === "number" && typeof farmLng === "number"
      ? { lng: farmLng, lat: farmLat }
      : null;

  const campsById: Record<string, CampRef> = {};
  for (const c of prismaCamps) {
    campsById[c.campId] = {
      campId: c.campId,
      campName: c.campName,
      geojson: c.geojson,
    };
  }

  const { pins, tour } = await buildRouteToday({
    // PrismaClient's generic find-many return type is too rich for a tiny
    // structural surface; the structural surface guarantees the only shape
    // we actually depend on.
    prisma: prisma as unknown as RouteTodayInput["prisma"],
    date: new Date(),
    farmCentre,
    campsById,
  });

  const campData: CampData[] = prismaCamps.map((c) => ({
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

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1815]">Route today</h1>
          <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
            {pins.length === 0
              ? "Nothing scheduled for today."
              : `${pins.length} stop${pins.length === 1 ? "" : "s"} · shortest-first tour`}
          </p>
        </div>
        <Link
          href={`/${farmSlug}/admin/map`}
          className="text-xs font-medium underline"
          style={{ color: "#5C3D2E" }}
        >
          Back to map
        </Link>
      </div>

      {pins.length === 0 ? (
        <div
          className="rounded-2xl p-10 text-center max-w-md mx-auto mt-8"
          style={{ background: "#F5F2EE", border: "1px solid rgba(0,0,0,0.06)" }}
        >
          <p className="text-lg font-semibold" style={{ color: "#1C1815" }}>
            No tasks due today
          </p>
          <p className="text-sm mt-2" style={{ color: "#9C8E7A" }}>
            Install a template pack to auto-generate recurring occurrences.
          </p>
          <Link
            href={`/${farmSlug}/admin/settings/tasks`}
            className="mt-6 inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-medium"
            style={{ background: "#1C1815", color: "#F5EBD4" }}
          >
            Install a template pack
          </Link>
        </div>
      ) : (
        <RouteTodayMap
          farmSlug={farmSlug}
          campData={campData}
          pins={pins}
          tour={tour}
          farmLat={farmLat}
          farmLng={farmLng}
        />
      )}
    </div>
  );
}
