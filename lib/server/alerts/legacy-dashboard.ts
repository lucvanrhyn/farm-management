// lib/server/alerts/legacy-dashboard.ts — Wraps getDashboardAlerts() output.
//
// Purpose: the existing lib/server/dashboard-alerts.ts already fires a large
// family of alerts (calving_overdue, in_withdrawal, poor_grazing,
// rotation_overstayed, veld_critical, feed_on_offer_*, drought_*, stale
// inspections, species-module alerts). We DO NOT duplicate those in the new
// per-type generators — instead, this wrapper shapes each DashboardAlert into
// an AlertCandidate so the Inngest pipeline persists/dispatches them uniformly.

import type { PrismaClient, FarmSettings } from "@prisma/client";
import type { AlertCandidate, AlertCategory } from "./types";
import { defaultExpiry, toIsoDate } from "./helpers";
import {
  getDashboardAlerts,
  type AlertThresholds,
  type DashboardAlert,
} from "@/lib/server/dashboard-alerts";

const DEFAULT_THRESHOLDS: AlertThresholds = {
  adgPoorDoerThreshold: 0.7,
  calvingAlertDays: 14,
  daysOpenLimit: 365,
  campGrazingWarningDays: 7,
  staleCampInspectionHours: 48,
};

function thresholdsFromSettings(s: FarmSettings): AlertThresholds {
  return {
    adgPoorDoerThreshold: s.adgPoorDoerThreshold ?? DEFAULT_THRESHOLDS.adgPoorDoerThreshold,
    calvingAlertDays: s.calvingAlertDays ?? DEFAULT_THRESHOLDS.calvingAlertDays,
    daysOpenLimit: s.daysOpenLimit ?? DEFAULT_THRESHOLDS.daysOpenLimit,
    campGrazingWarningDays:
      s.campGrazingWarningDays ?? DEFAULT_THRESHOLDS.campGrazingWarningDays,
    staleCampInspectionHours:
      s.alertThresholdHours ?? DEFAULT_THRESHOLDS.staleCampInspectionHours,
  };
}

// Map legacy alert ids → new category taxonomy. Falls back to "performance"
// for anything we haven't explicitly mapped; that is intentional — legacy
// alerts without a category still flow through the pipeline, they just land
// in the generic "performance" bucket and can be re-categorised later.
const CATEGORY_MAP: Record<string, AlertCategory> = {
  "calving-due": "reproduction",
  "calving-overdue": "reproduction",
  "poor-doer": "performance",
  "in-withdrawal": "compliance",
  "poor-grazing": "veld",
  "rotation-overstayed": "veld",
  "rotation-overdue-rest": "veld",
  "veld-critical": "veld",
  "veld-declining": "veld",
  "veld-overdue-assessment": "veld",
  "feed-on-offer-critical": "veld",
  "feed-on-offer-low": "veld",
  "feed-on-offer-stale-reading": "veld",
  "drought-severe": "weather",
  "drought-moderate": "weather",
  "stale-inspections": "performance",
  "sheep-predation": "predator",
  "game-predation-recent": "predator",
  "sheep-shearing-due": "performance",
  "sheep-dosing-overdue": "compliance",
};

function categoryFor(id: string): AlertCategory {
  return CATEGORY_MAP[id] ?? "performance";
}

export function toAlertCandidate(alert: DashboardAlert, now: Date = new Date()): AlertCandidate {
  const type = `LEGACY_${alert.id.toUpperCase().replace(/-/g, "_")}`;
  return {
    type,
    category: categoryFor(alert.id),
    severity: alert.severity,
    dedupKey: `${type}:farm:${toIsoDate(now)}`,
    collapseKey: null,
    payload: {
      legacyId: alert.id,
      icon: alert.icon,
      count: alert.count,
      species: alert.species,
    },
    message: alert.message,
    href: alert.href,
    expiresAt: defaultExpiry(now),
  };
}

export async function evaluate(
  prisma: PrismaClient,
  settings: FarmSettings,
  farmSlug: string,
): Promise<AlertCandidate[]> {
  const thresholds = thresholdsFromSettings(settings);
  const now = new Date();
  let bundle;
  try {
    bundle = await getDashboardAlerts(prisma, farmSlug, thresholds);
  } catch (err) {
    // Dashboard alerts has its own internal .catch(() => []) on most sub-queries,
    // so reaching this branch is rare. Log and return [] rather than block the
    // whole evaluation pipeline.
    console.warn(
      "[alerts:legacy-dashboard] getDashboardAlerts failed:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
  return [...bundle.red, ...bundle.amber].map((a) => toAlertCandidate(a, now));
}
