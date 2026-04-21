/**
 * Phase K Wave 3F — /admin/settings/map
 *
 * Server shell. Fetches current map-settings blob, tenant tier, and the
 * set of camp polygons (used to compute farm centroid for FMD-zone
 * assertion). Hands them to MapSettingsClient.
 *
 * Admin layout above already enforces ADMIN role. Moat-layer gating is
 * applied inside the client component.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import { getUserRoleForFarm } from "@/lib/auth";
import type { FarmTier } from "@/lib/tier";
import MapSettingsClient, {
  type FmdZoneResult,
} from "@/components/admin/map/MapSettingsClient";
import type { FarmMapSettings } from "@/app/api/farm-settings/map/schema";
import { DEFAULT_MAP_SETTINGS } from "@/app/api/farm-settings/map/schema";
import { computeFarmCentroid, pointInFmdZone } from "@/lib/map/fmd-zones";

export const dynamic = "force-dynamic";

function parseMapSettings(raw: string | null | undefined): FarmMapSettings {
  if (!raw) return DEFAULT_MAP_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<FarmMapSettings>;
    return {
      eskomAreaId:
        typeof parsed.eskomAreaId === "string" && parsed.eskomAreaId.trim()
          ? parsed.eskomAreaId.trim()
          : null,
    };
  } catch {
    return DEFAULT_MAP_SETTINGS;
  }
}

export default async function MapSettingsPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  if (getUserRoleForFarm(session, farmSlug) !== "ADMIN") {
    redirect(`/${farmSlug}/home`);
  }

  const [prisma, creds] = await Promise.all([
    getPrismaForFarm(farmSlug),
    getFarmCreds(farmSlug),
  ]);

  if (!prisma) {
    return (
      <div className="p-8 bg-[#FAFAF8] min-h-screen">
        <p className="text-red-500">Farm not found.</p>
      </div>
    );
  }

  const tier: FarmTier = (creds?.tier ?? "basic") as FarmTier;

  const [rawSettings, camps] = await Promise.all([
    prisma.farmSettings.findFirst({ select: { mapSettings: true } }),
    prisma.camp.findMany({ select: { geojson: true } }),
  ]);

  const settings = parseMapSettings(rawSettings?.mapSettings);

  // Compute FMD-zone assertion server-side so the client doesn't need to
  // download the full geojson up front.
  let fmdZone: FmdZoneResult = { status: "unknown" };
  const centroid = computeFarmCentroid(camps.map((c) => c.geojson));
  if (centroid) {
    try {
      const fmdPath = path.join(process.cwd(), "public", "gis", "fmd-zones.geojson");
      const raw = await fs.readFile(fmdPath, "utf8");
      // Trust-boundary: the on-disk geojson is a static asset we ship, so
      // casting through `unknown` is fine — the helper defensively handles
      // malformed features (silently skips them).
      const geojson = JSON.parse(raw) as {
        features: Parameters<typeof pointInFmdZone>[1];
      };
      const zone = pointInFmdZone(centroid, geojson.features);
      fmdZone = zone
        ? { status: "inside", zoneName: zone, centroid }
        : { status: "outside", centroid };
    } catch {
      // Silent-failure cure: if the geojson file is missing or unreadable,
      // surface an explicit "unknown" status to the client, not a crash.
      fmdZone = { status: "unknown", centroid };
    }
  }

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8] min-h-screen">
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: "#1C1815" }}>
          Map Settings
        </h1>
        <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
          Layer toggles and GIS integrations (EskomSePush, FMD-zone check)
        </p>
      </div>

      <div className="max-w-3xl">
        <MapSettingsClient
          farmSlug={farmSlug}
          tier={tier}
          initialSettings={settings}
          fmdZone={fmdZone}
        />
      </div>
    </div>
  );
}
