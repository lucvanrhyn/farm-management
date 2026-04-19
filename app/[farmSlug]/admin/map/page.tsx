export const dynamic = "force-dynamic";

/**
 * Admin Map — Wave 3E scaffold.
 *
 * Hosts FarmMap and wires long-press → Log-at-Spot sheet (Advanced tier)
 * or a small upgrade prompt (Basic tier). The full layer palette lives in
 * FarmMap's LayerToggle.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import type { CampData } from "@/components/map/layers/CampLayer";
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

  const [settings, camps] = await Promise.all([
    prisma.farmSettings.findFirst({
      select: { latitude: true, longitude: true },
    }),
    prisma.camp.findMany({ orderBy: { campName: "asc" } }),
  ]);

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

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1815]">Farm map</h1>
          <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
            {camps.length} camp{camps.length === 1 ? "" : "s"} · long-press to log at a spot
          </p>
        </div>
        <Link
          href={`/${farmSlug}/admin/map/route-today`}
          className="text-xs font-medium rounded-lg px-3 py-1.5"
          style={{ background: "#0ea5e9", color: "#fff" }}
        >
          Route today →
        </Link>
      </div>

      <AdminMapClient
        farmSlug={farmSlug}
        tier={creds.tier}
        campData={campData}
        farmLat={settings?.latitude ?? null}
        farmLng={settings?.longitude ?? null}
      />
    </div>
  );
}
