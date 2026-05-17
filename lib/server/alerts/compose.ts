// lib/server/alerts/compose.ts
//
// ADR-0005 — the single pure alert-composition core.
//
// `composeAlerts(inputs)` is the ONLY place alert severity, messages and
// counts are decided. It is pure, total and deterministic: same inputs →
// same output, no I/O, no clock read (the caller passes `now`).
//
// `AlertInputs` is a bag of *independently-optional* source inputs plus
// required config. An **absent source contributes nothing** — "we didn't
// fetch rotation" and "rotation is clean" are indistinguishable in the
// output, by design (see the ADR's monotonicity rationale). This is what
// lets the same definition run with partial data (offline header badge)
// and full data (`/admin/alerts`): a partial pass is always a prefix of
// the full pass.
//
// The fetch shell `getDashboardAlerts` (lib/server/dashboard-alerts.ts)
// does the eight-way Promise.all then delegates here.

import type { LiveCampStatus } from "@/lib/server/camp-status";
import type { WithdrawalAnimal } from "@/lib/server/treatment-analytics";
import type { RotationPayload } from "@/lib/domain/rotation/get-status";
import type { FarmVeldSummary } from "@/lib/server/veld-score";
import type { FarmFeedOnOfferPayload } from "@/lib/server/feed-on-offer";
import type { DroughtPayload } from "@/lib/server/drought";
import type {
  AlertThresholds,
  DashboardAlert,
  DashboardAlerts,
} from "@/lib/server/dashboard-alerts";

/**
 * Independently-optional source inputs + required config.
 *
 * Every source key is optional: `undefined` means "this source did not
 * contribute" — which, by ADR-0005's monotonicity guarantee, is identical
 * to "this source had nothing to report." Callers with partial data (the
 * offline header) pass only the sources they have; the full-pass shell
 * passes all eight.
 */
export interface AlertInputs {
  // ── independently-optional sources ──────────────────────────────────────
  campConditions?: Map<string, LiveCampStatus>;
  totalCamps?: number;
  withdrawalAnimals?: WithdrawalAnimal[];
  rotationPayload?: RotationPayload | null;
  veldSummary?: FarmVeldSummary | null;
  feedOnOfferPayload?: FarmFeedOnOfferPayload | null;
  droughtPayload?: DroughtPayload | null;
  speciesAlerts?: DashboardAlert[];
  // ── required config ─────────────────────────────────────────────────────
  thresholds: AlertThresholds;
  farmSlug: string;
  now: Date;
}

export function composeAlerts(inputs: AlertInputs): DashboardAlerts {
  const {
    thresholds,
    farmSlug,
    now,
    campConditions,
    totalCamps,
    withdrawalAnimals,
    rotationPayload,
    veldSummary,
    feedOnOfferPayload,
    droughtPayload,
    speciesAlerts,
  } = inputs;

  const { staleCampInspectionHours } = thresholds;

  // ── Stale camp inspections ─────────────────────────────────────────────────
  // Absent camp-conditions / totalCamps → no stale-inspection contribution.
  // We only count "uninspected" camps when totalCamps is supplied alongside
  // conditions (the full-pass shell always supplies both; the offline header
  // supplies camps.length).
  let staleCampCount = 0;
  if (campConditions && totalCamps != null) {
    const staleThresholdMs = staleCampInspectionHours * 60 * 60 * 1000;
    const uninspectedCamps = totalCamps - campConditions.size;
    staleCampCount = uninspectedCamps;
    for (const status of campConditions.values()) {
      const inspectedAt = new Date(status.last_inspected_at);
      const ageMs = now.getTime() - inspectedAt.getTime();
      if (ageMs > staleThresholdMs) staleCampCount++;
    }
  }

  // ── Camp grazing (camp-conditions source) ──────────────────────────────────
  let poorGrazingCount = 0;
  if (campConditions) {
    for (const status of campConditions.values()) {
      if (
        status.grazing_quality === "Poor" ||
        status.grazing_quality === "Overgrazed"
      ) {
        poorGrazingCount++;
      }
    }
  }

  // ── Build alert arrays ────────────────────────────────────────────────────
  const red: DashboardAlert[] = [];
  const amber: DashboardAlert[] = [];

  // Aggregate species module alerts (split by severity). Absent → nothing.
  for (const alert of speciesAlerts ?? []) {
    if (alert.severity === "red") {
      red.push(alert);
    } else {
      amber.push(alert);
    }
  }

  // Red: animals in withdrawal (farm-wide, not species-specific)
  if (withdrawalAnimals && withdrawalAnimals.length > 0) {
    red.push({
      id: "in-withdrawal",
      severity: "red",
      icon: "FlaskConical",
      message:
        withdrawalAnimals.length === 1
          ? "1 animal in withdrawal period"
          : `${withdrawalAnimals.length} animals in withdrawal period`,
      count: withdrawalAnimals.length,
      href: `/${farmSlug}/admin/animals`,
      species: "farm",
    });
  }

  // Red: poor or overgrazed camps (farm-wide)
  if (poorGrazingCount > 0) {
    red.push({
      id: "poor-grazing",
      severity: "red",
      icon: "Tent",
      message:
        poorGrazingCount === 1
          ? "1 camp with poor or overgrazed pasture"
          : `${poorGrazingCount} camps with poor or overgrazed pasture`,
      count: poorGrazingCount,
      href: `/${farmSlug}/admin/performance`,
      species: "farm",
    });
  }

  // Rotation alerts (farm-wide): overstayed=red, overdue_rest=amber
  if (rotationPayload) {
    let overstayedCount = 0;
    let overdueRestCount = 0;
    for (const c of rotationPayload.camps) {
      if (c.status === "overstayed") overstayedCount++;
      else if (c.status === "overdue_rest") overdueRestCount++;
    }
    if (overstayedCount > 0) {
      red.push({
        id: "rotation-overstayed",
        severity: "red",
        icon: "Clock",
        message:
          overstayedCount === 1
            ? "1 camp overstayed (animals past max grazing days)"
            : `${overstayedCount} camps overstayed (animals past max grazing days)`,
        count: overstayedCount,
        href: `/${farmSlug}/admin/camps?tab=rotation`,
        species: "farm",
      });
    }
    if (overdueRestCount > 0) {
      amber.push({
        id: "rotation-overdue-rest",
        severity: "amber",
        icon: "AlertTriangle",
        message:
          overdueRestCount === 1
            ? "1 camp overdue for grazing (veld may be declining)"
            : `${overdueRestCount} camps overdue for grazing (veld may be declining)`,
        count: overdueRestCount,
        href: `/${farmSlug}/admin/camps?tab=rotation`,
        species: "farm",
      });
    }
  }

  // Veld condition alerts (farm-wide)
  if (veldSummary) {
    if (veldSummary.critical.length > 0) {
      const n = veldSummary.critical.length;
      red.push({
        id: "veld-critical",
        severity: "red",
        icon: "AlertTriangle",
        message: n === 1
          ? "1 camp in critical veld condition (score < 3)"
          : `${n} camps in critical veld condition (score < 3)`,
        count: n,
        href: `/${farmSlug}/tools/veld`,
        species: "farm",
      });
    }

    if (veldSummary.declining.length > 0) {
      const n = veldSummary.declining.length;
      amber.push({
        id: "veld-declining",
        severity: "amber",
        icon: "TrendingDown",
        message: n === 1
          ? "1 camp showing declining veld trend"
          : `${n} camps showing declining veld trend`,
        count: n,
        href: `/${farmSlug}/tools/veld`,
        species: "farm",
      });
    }

    if (veldSummary.overdue.length > 0) {
      const n = veldSummary.overdue.length;
      amber.push({
        id: "veld-overdue-assessment",
        severity: "amber",
        icon: "CalendarClock",
        message: n === 1
          ? "1 camp overdue for veld assessment (>180 days)"
          : `${n} camps overdue for veld assessment (>180 days)`,
        count: n,
        href: `/${farmSlug}/tools/veld`,
        species: "farm",
      });
    }
  }

  // Feed on Offer alerts (farm-wide)
  if (feedOnOfferPayload) {
    const { summary: feedOnOfferSummary } = feedOnOfferPayload;
    if (feedOnOfferSummary.campsCritical > 0) {
      const n = feedOnOfferSummary.campsCritical;
      red.push({
        id: "feed-on-offer-critical",
        severity: "red",
        icon: "AlertTriangle",
        message: n === 1
          ? "1 camp with critical feed levels (< 500 kg DM/ha)"
          : `${n} camps with critical feed levels (< 500 kg DM/ha)`,
        count: n,
        href: `/${farmSlug}/tools/feed-on-offer`,
        species: "farm",
      });
    }

    if (feedOnOfferSummary.campsLow > 0) {
      const n = feedOnOfferSummary.campsLow;
      amber.push({
        id: "feed-on-offer-low",
        severity: "amber",
        icon: "Wheat",
        message: n === 1
          ? "1 camp with low feed levels (< 1,000 kg DM/ha)"
          : `${n} camps with low feed levels (< 1,000 kg DM/ha)`,
        count: n,
        href: `/${farmSlug}/tools/feed-on-offer`,
        species: "farm",
      });
    }

    if (feedOnOfferSummary.campsStaleReading > 0) {
      const n = feedOnOfferSummary.campsStaleReading;
      amber.push({
        id: "feed-on-offer-stale-reading",
        severity: "amber",
        icon: "CalendarClock",
        message: n === 1
          ? "1 camp with outdated cover reading (> 30 days)"
          : `${n} camps with outdated cover readings (> 30 days)`,
        count: n,
        href: `/${farmSlug}/tools/feed-on-offer`,
        species: "farm",
      });
    }
  }

  // Drought alerts (farm-wide, based on SPI-3)
  if (droughtPayload?.spi3 != null) {
    const { value: spi3 } = droughtPayload.spi3;
    if (spi3 <= -1.5) {
      red.push({
        id: "drought-severe",
        severity: "red",
        icon: "CloudOff",
        message: `Severe drought conditions — SPI-3 = ${spi3.toFixed(2)}`,
        count: 1,
        href: `/${farmSlug}/tools/drought`,
        species: "farm",
      });
    } else if (spi3 <= -1.0) {
      amber.push({
        id: "drought-moderate",
        severity: "amber",
        icon: "Cloud",
        message: `Moderate drought conditions — SPI-3 = ${spi3.toFixed(2)}`,
        count: 1,
        href: `/${farmSlug}/tools/drought`,
        species: "farm",
      });
    }
  }

  // Amber: stale camp inspections (farm-wide)
  if (staleCampCount > 0) {
    amber.push({
      id: "stale-inspections",
      severity: "amber",
      icon: "ClipboardCheck",
      message:
        staleCampCount === 1
          ? `1 camp not inspected within ${staleCampInspectionHours}h`
          : `${staleCampCount} camps not inspected within ${staleCampInspectionHours}h`,
      count: staleCampCount,
      href: `/${farmSlug}/admin/observations`,
      species: "farm",
    });
  }

  return {
    red,
    amber,
    totalCount: red.length + amber.length,
  };
}
