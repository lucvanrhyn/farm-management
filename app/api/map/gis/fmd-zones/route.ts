/**
 * Phase K — Wave 2C — Static GIS: FMD disease zones.
 *
 * GET /api/map/gis/fmd-zones
 *   → GeoJSON FeatureCollection of SA FMD (Foot-and-Mouth Disease) zones.
 *
 * Source: `public/gis/fmd-zones.geojson` (committed to the repo). This is
 * intentionally static — DALRRD doesn't publish a stable machine-readable
 * endpoint, so scraping on each request would be fragile. See
 * `public/gis/fmd-zones.README.md` for the refresh process.
 *
 * Caching: `revalidate: false` — static. Next.js will cache indefinitely;
 * a redeploy is required after updating the GeoJSON file.
 *
 * Policy on read failure:
 *   Return HTTP 200 with empty-stale envelope so the UI never 500s on a
 *   missing/corrupt local file.
 *
 * Auth (app-level): flows through proxy.ts (authenticated session required).
 *
 * Error codes (in `_error`):
 *   FILE_NOT_FOUND     — GeoJSON file missing from public/gis/
 *   FILE_PARSE         — file exists but is not valid JSON / GeoJSON
 */

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const revalidate = false; // static until next deploy

function stale(code: string) {
  return NextResponse.json(
    { type: "FeatureCollection", features: [], _stale: true, _error: code },
    { status: 200 },
  );
}

export async function GET() {
  try {
    const filePath = path.join(
      process.cwd(),
      "public",
      "gis",
      "fmd-zones.geojson",
    );
    const raw = await fs.readFile(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return stale("FILE_PARSE");
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as { type?: unknown }).type !== "FeatureCollection" ||
      !Array.isArray((parsed as { features?: unknown }).features)
    ) {
      return stale("FILE_PARSE");
    }
    return NextResponse.json(parsed);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return stale("FILE_NOT_FOUND");
    return stale("FILE_PARSE");
  }
}
