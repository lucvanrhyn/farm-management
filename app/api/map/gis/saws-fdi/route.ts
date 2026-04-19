/**
 * Phase K — Wave 2C — External GIS proxy: SAWS Fire Danger Index.
 *
 * GET /api/map/gis/saws-fdi?province=GP|KZN|...
 *   → { province, fdi: number, band, asOf: ISO }
 *
 * Upstream: SAWS (South African Weather Service) FDI page is HTML-only, so
 * this route falls back to a static JSON bundled at
 * `public/gis/saws-fdi-fallback.json` whenever live fetch fails or isn't yet
 * wired. Wave 4 can replace the TODO with a real endpoint.
 *
 * Caching: 3 hours (FDI updates typically 3x daily).
 *
 * Policy on upstream failure:
 *   Return HTTP 200 with `{ province, fdi, band, asOf, _stale: true,
 *   _error }` so the UI never shows a 500 for weather data.
 *
 * Error codes (in `_error`):
 *   MISSING_PROVINCE   — ?province param missing
 *   INVALID_PROVINCE   — not one of EC/FS/GP/KZN/LP/MP/NC/NW/WC
 *   UPSTREAM_NOT_WIRED — no live source configured yet (using fallback)
 *   FALLBACK_MISSING   — fallback JSON not found / malformed
 *   UPSTREAM_TIMEOUT   — live fetch aborted
 *   UPSTREAM_ERROR     — live fetch failed
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const revalidate = 10_800; // 3 hours

const VALID_PROVINCES = new Set([
  "EC", "FS", "GP", "KZN", "LP", "MP", "NC", "NW", "WC",
]);

type FdiBand = "Low" | "Moderate" | "High" | "VeryHigh" | "Extreme";

interface FdiReading {
  province: string;
  fdi: number;
  band: FdiBand;
  asOf: string;
}

interface FdiStaleReading extends FdiReading {
  _stale: true;
  _error: string;
}

function bandFromFdi(fdi: number): FdiBand {
  if (fdi >= 75) return "Extreme";
  if (fdi >= 60) return "VeryHigh";
  if (fdi >= 45) return "High";
  if (fdi >= 25) return "Moderate";
  return "Low";
}

async function loadFallback(province: string): Promise<FdiReading | null> {
  try {
    const fallbackPath = path.join(
      process.cwd(),
      "public",
      "gis",
      "saws-fdi-fallback.json",
    );
    const raw = await fs.readFile(fallbackPath, "utf8");
    const parsed = JSON.parse(raw) as {
      provinces?: Record<string, FdiReading>;
    };
    const entry = parsed.provinces?.[province];
    if (!entry) return null;
    return {
      province: entry.province,
      fdi: entry.fdi,
      band: entry.band,
      asOf: entry.asOf,
    };
  } catch {
    return null;
  }
}

function staleResponse(
  province: string,
  code: string,
  existing?: FdiReading,
): NextResponse {
  const base: FdiStaleReading = existing
    ? { ...existing, _stale: true, _error: code }
    : {
        province,
        fdi: 40,
        band: "Moderate",
        asOf: new Date().toISOString(),
        _stale: true,
        _error: code,
      };
  return NextResponse.json(base, { status: 200 });
}

export async function GET(req: NextRequest) {
  const province = new URL(req.url).searchParams.get("province");

  if (!province) {
    return staleResponse("", "MISSING_PROVINCE");
  }
  if (!VALID_PROVINCES.has(province)) {
    return staleResponse(province, "INVALID_PROVINCE");
  }

  // Live SAWS fetch is not yet wired (HTML-only source). Serve fallback with a
  // marker error so the UI knows to render a "static data" hint. Wave 4 will
  // replace this block with a real fetch that updates the cache.
  const fallback = await loadFallback(province);
  if (!fallback) {
    return staleResponse(province, "FALLBACK_MISSING");
  }

  return NextResponse.json({
    ...fallback,
    _stale: true,
    _error: "UPSTREAM_NOT_WIRED",
  });
}
