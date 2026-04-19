// lib/server/alerts/spi-drought.ts — SPI_DROUGHT_MODERATE / _SEVERE (MOAT).
//
// Reuses the existing lib/server/drought.ts payload. SPI-3 is the canonical
// agricultural-drought signal in SA (SAWS). Thresholds per research brief §F:
//   amber: spi3 ≤ -1.0  (moderate drought)
//   red:   spi3 ≤ -1.5  (severe drought)

import type { PrismaClient, FarmSettings } from "@prisma/client";
import type { AlertCandidate } from "./types";
import { defaultExpiry, toIsoWeek } from "./helpers";
import { getDroughtPayload } from "@/lib/server/drought";

export async function evaluate(
  prisma: PrismaClient,
  settings: FarmSettings,
  _farmSlug?: string,
): Promise<AlertCandidate[]> {
  if (settings.latitude == null || settings.longitude == null) {
    return [];
  }
  let payload;
  try {
    payload = await getDroughtPayload(prisma, settings.latitude, settings.longitude);
  } catch (err) {
    console.warn(
      "[alerts:SPI_DROUGHT] drought payload fetch failed:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }

  const spi3 = payload?.spi3?.value;
  if (spi3 == null || Number.isNaN(spi3)) return [];

  const now = new Date();
  const week = toIsoWeek(now);
  const expiresAt = defaultExpiry(now);

  if (spi3 <= -1.5) {
    return [
      {
        type: "SPI_DROUGHT_SEVERE",
        category: "weather",
        severity: "red",
        dedupKey: `SPI_DROUGHT_SEVERE:farm:${week}`,
        collapseKey: null,
        payload: { spi3, severity: payload.spi3?.severity ?? "severe" },
        message: `Severe drought — SPI-3 = ${spi3.toFixed(2)}`,
        href: `/tools/drought`,
        expiresAt,
      },
    ];
  }
  if (spi3 <= -1.0) {
    return [
      {
        type: "SPI_DROUGHT_MODERATE",
        category: "weather",
        severity: "amber",
        dedupKey: `SPI_DROUGHT_MODERATE:farm:${week}`,
        collapseKey: null,
        payload: { spi3, severity: payload.spi3?.severity ?? "moderate" },
        message: `Moderate drought — SPI-3 = ${spi3.toFixed(2)}`,
        href: `/tools/drought`,
        expiresAt,
      },
    ];
  }
  return [];
}
