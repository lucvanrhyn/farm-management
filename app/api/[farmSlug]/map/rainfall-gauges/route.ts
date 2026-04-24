/**
 * Phase K — Wave 2C — Tenant map layer: rainfall gauges.
 *
 * GET /api/[farmSlug]/map/rainfall-gauges
 *   → GeoJSON FeatureCollection of Point features, one per unique (lat,lng) gauge.
 *
 * Aggregation: fetch all RainfallRecord rows with non-null lat/lng, then group
 * client-side by rounded lat/lng (6 decimal places — ~10cm precision) and sum
 * last 24h / last 7d per gauge. Skip rows without coordinates.
 *
 * Schema note: `RainfallRecord.date` is a `YYYY-MM-DD` string (see
 * schema.prisma), so window comparisons use string lexical sort — valid
 * because of the zero-padded ISO format.
 *
 * Phase G (P6.5): migrated to `getFarmContextForSlug`.
 *
 * Error codes:
 *   AUTH_REQUIRED              — 401, no session
 *   CROSS_TENANT_FORBIDDEN     — 403, session.farms doesn't include farmSlug
 */

import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { classifyFarmContextFailure } from "@/lib/server/farm-context-errors";

export const dynamic = "force-dynamic";

function asErr(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, error: code, message },
    { status },
  );
}

function yyyyMmDdDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function yyyyMmDdToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function gaugeKey(lat: number, lng: number): string {
  // 6 dp is <11cm at the equator — finer than any farm rain gauge needs.
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

interface RainRow {
  date: string;
  rainfallMm: number;
  stationName: string | null;
  campId: string | null;
  lat: number | null;
  lng: number | null;
}

interface Gauge {
  lat: number;
  lng: number;
  stationName: string | null;
  campId: string | null;
  mm24h: number;
  mm7d: number;
  lastReadingAt: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const { farmSlug } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) {
    const { code, status } = await classifyFarmContextFailure(req);
    return asErr(code, code === "AUTH_REQUIRED" ? "Sign in required" : "Forbidden", status);
  }

  // Only pull the last 7 days — anything older is irrelevant to map display.
  // "24h" in day-granularity rainfall means "today's reading" (RainfallRecord
  // stores date as YYYY-MM-DD; there's no time component to slide a 24h window
  // against), so the 24h cutoff equals today's date.
  const cutoff7d = yyyyMmDdDaysAgo(6); // today + last 6 days = 7 readings
  const cutoff24h = yyyyMmDdToday();

  const rows: RainRow[] = await ctx.prisma.rainfallRecord.findMany({
    where: { date: { gte: cutoff7d } },
    select: {
      date: true,
      rainfallMm: true,
      stationName: true,
      campId: true,
      lat: true,
      lng: true,
    },
    orderBy: { date: "desc" },
  });

  const gauges = new Map<string, Gauge>();

  for (const r of rows) {
    if (r.lat === null || r.lng === null) continue;
    const key = gaugeKey(r.lat, r.lng);
    const existing = gauges.get(key);
    if (existing) {
      existing.mm7d += r.rainfallMm;
      if (r.date >= cutoff24h) existing.mm24h += r.rainfallMm;
      if (r.date > existing.lastReadingAt) {
        existing.lastReadingAt = r.date;
        // Rows arrive desc by date — prefer the freshest stationName/campId.
      }
    } else {
      gauges.set(key, {
        lat: r.lat,
        lng: r.lng,
        stationName: r.stationName,
        campId: r.campId,
        mm24h: r.date >= cutoff24h ? r.rainfallMm : 0,
        mm7d: r.rainfallMm,
        lastReadingAt: r.date,
      });
    }
  }

  const features = Array.from(gauges.values()).map((g) => ({
    type: "Feature" as const,
    geometry: {
      type: "Point" as const,
      coordinates: [g.lng, g.lat],
    },
    properties: {
      stationName: g.stationName,
      campId: g.campId,
      mm24h: Math.round(g.mm24h * 10) / 10,
      mm7d: Math.round(g.mm7d * 10) / 10,
      lastReadingAt: g.lastReadingAt,
    },
  }));

  return NextResponse.json({
    type: "FeatureCollection",
    features,
  });
}
