// lib/server/alerts/index.ts — evaluateAllAlerts fan-out.
//
// Runs every generator in parallel via Promise.allSettled so a single broken
// generator doesn't poison the whole run. Rejected generators are logged with
// structured context; the cron continues with whatever succeeded.

import type { PrismaClient, FarmSettings } from "@prisma/client";
import type { AlertCandidate } from "./types";

import { evaluate as lambingDue } from "./lambing-due";
import { evaluate as fawningDue } from "./fawning-due";
import { evaluate as shearingCrutching } from "./shearing-crutching";
import { evaluate as predatorSpike } from "./predator-spike";
import { evaluate as rainfallStale } from "./rainfall-stale";
import { evaluate as coverStale } from "./cover-stale";
import { evaluate as weighingStale } from "./weighing-stale";
import { evaluate as cogBreakeven } from "./cog-breakeven";
import { evaluate as waterService } from "./water-service";
import { evaluate as taxDeadline } from "./tax-deadline";
import { evaluate as spiDrought } from "./spi-drought";
import { evaluate as lsuOverstock } from "./lsu-overstock";
import { evaluate as legacyDashboard } from "./legacy-dashboard";
import { logger } from "@/lib/logger";

interface NamedGenerator {
  name: string;
  run: (p: PrismaClient, s: FarmSettings, slug: string) => Promise<AlertCandidate[]>;
}

const GENERATORS: NamedGenerator[] = [
  { name: "LAMBING_DUE_7D", run: lambingDue },
  { name: "FAWNING_DUE", run: fawningDue },
  { name: "SHEARING_CRUTCHING", run: shearingCrutching },
  { name: "PREDATOR_SPIKE", run: predatorSpike },
  { name: "RAINFALL_NOT_LOGGED", run: rainfallStale },
  { name: "COVER_READING_STALE_21D", run: coverStale },
  { name: "NO_WEIGHING_90D", run: weighingStale },
  { name: "COG_EXCEEDS_BREAKEVEN", run: cogBreakeven },
  { name: "WATER_SERVICE_OVERDUE_30D", run: waterService },
  { name: "TAX_DEADLINE", run: taxDeadline },
  { name: "SPI_DROUGHT", run: spiDrought },
  { name: "LSU_OVERSTOCK", run: lsuOverstock },
  { name: "LEGACY_DASHBOARD", run: legacyDashboard },
];

export async function evaluateAllAlerts(
  prisma: PrismaClient,
  settings: FarmSettings,
  farmSlug: string,
): Promise<AlertCandidate[]> {
  const settled = await Promise.allSettled(
    GENERATORS.map((g) => g.run(prisma, settings, farmSlug)),
  );

  const out: AlertCandidate[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      out.push(...r.value);
    } else {
      logger.warn('[alerts] generator failed', {
        generator: GENERATORS[i].name,
        tenant: farmSlug,
        reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  }
  return out;
}

export type { AlertCandidate, AlertCategory, AlertSeverity } from "./types";
export { COLLAPSE_THRESHOLD, getCollapseThreshold } from "./types";
export { persistNotifications, collapseCandidates } from "./dedup";
