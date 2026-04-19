/**
 * Phase K — Wave 2C — External GIS proxy: CSIR AFIS active fires.
 *
 * GET /api/map/gis/afis?bbox=minLng,minLat,maxLng,maxLat
 *   → GeoJSON FeatureCollection of active fire detections inside the bbox.
 *
 * Upstream: CSIR Advanced Fire Information System (AFIS).
 *   https://www.afis.co.za/   — portal
 *   https://firms.afis.co.za/ — public GeoJSON source (confirm URL at
 *                               integration time; Wave 4 will wire the
 *                               canonical endpoint).
 *
 * Caching: 15 minutes (AFIS publishes ~every 10-15 min during MODIS/VIIRS
 * overpasses; no point polling tighter than the publish cadence).
 *
 * Policy on upstream failure:
 *   Return HTTP 200 with `{ type: "FeatureCollection", features: [],
 *   _stale: true, _error: "<code>" }` so the UI can show "GIS temporarily
 *   unavailable" instead of a 500. This matches the spec hard-constraint.
 *
 * Auth: flows through proxy.ts (NOT added to the negative-lookahead), meaning
 * an authenticated session is required. This is a deliberate choice so we
 * don't burn AFIS quota for anonymous visitors. See the "Proxy matcher" note
 * in Wave 2C spec — no proxy.ts change needed.
 *
 * Error codes (in `_error`, with HTTP 200 stale envelope):
 *   MISSING_BBOX       — ?bbox query param missing
 *   INVALID_BBOX       — bbox not 4 comma-separated numbers
 *   UPSTREAM_TIMEOUT   — fetch aborted after 10s
 *   UPSTREAM_ERROR     — non-2xx response from AFIS
 *   UPSTREAM_PARSE     — AFIS returned non-GeoJSON
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 900; // 15 minutes

// Placeholder endpoint — replace with the authoritative AFIS GeoJSON URL at
// Wave 4 integration time. Kept here (not in env) because it's a public,
// non-secret URL whose schema change affects code shape.
const AFIS_ENDPOINT = "https://firms.afis.co.za/api/v1/active-fires";

interface StaleEnvelope {
  type: "FeatureCollection";
  features: [];
  _stale: true;
  _error: string;
}

function stale(code: string): StaleEnvelope {
  return { type: "FeatureCollection", features: [], _stale: true, _error: code };
}

function parseBbox(raw: string | null): [number, number, number, number] | null {
  if (!raw) return null;
  const parts = raw.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4) return null;
  if (parts.some((n) => !Number.isFinite(n))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng >= maxLng || minLat >= maxLat) return null;
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) return null;
  return [minLng, minLat, maxLng, maxLat];
}

export async function GET(req: NextRequest) {
  const bboxRaw = new URL(req.url).searchParams.get("bbox");
  if (!bboxRaw) {
    return NextResponse.json(stale("MISSING_BBOX"), { status: 200 });
  }
  const bbox = parseBbox(bboxRaw);
  if (!bbox) {
    return NextResponse.json(stale("INVALID_BBOX"), { status: 200 });
  }

  const url = `${AFIS_ENDPOINT}?bbox=${bbox.join(",")}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        next: { revalidate: 900 },
        headers: { Accept: "application/json" },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      return NextResponse.json(stale("UPSTREAM_ERROR"), { status: 200 });
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return NextResponse.json(stale("UPSTREAM_PARSE"), { status: 200 });
    }

    // Accept either a FeatureCollection directly or an array we wrap.
    if (
      data &&
      typeof data === "object" &&
      (data as { type?: unknown }).type === "FeatureCollection" &&
      Array.isArray((data as { features?: unknown }).features)
    ) {
      return NextResponse.json(data);
    }
    if (Array.isArray(data)) {
      return NextResponse.json({ type: "FeatureCollection", features: data });
    }
    return NextResponse.json(stale("UPSTREAM_PARSE"), { status: 200 });
  } catch (err) {
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" || err.message.includes("aborted"));
    return NextResponse.json(
      stale(isAbort ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR"),
      { status: 200 },
    );
  }
}
