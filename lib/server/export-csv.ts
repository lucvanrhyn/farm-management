// lib/server/export-csv.ts
// Pure CSV generation helpers — no side effects, no DB calls.

import type { WithdrawalAnimal } from "@/lib/server/treatment-analytics";
import type { UpcomingCalving } from "@/lib/server/reproduction-analytics";
import type {
  CogByCampRow,
  CogByAnimalRow,
} from "@/lib/server/financial-analytics";
import type { DroughtMonthRow } from "@/lib/server/drought";
import type { It3SnapshotPayload } from "@/lib/server/sars-it3";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AnimalRow {
  animalId: string;
  name: string | null;
  sex: string;
  breed: string;
  category: string;
  currentCamp: string;
  status: string;
  dateOfBirth: string | null;
  dateAdded: string;
}

export interface CampRow {
  campId: string;
  campName: string;
  sizeHectares: number | null;
  waterSource: string | null;
  grazingQuality: string | null;
  waterStatus: string | null;
  fenceStatus: string | null;
  lastInspectedAt: string | null;
}

export interface TransactionRow {
  date: string;
  type: string;
  category: string;
  amount: number;
  description: string;
  animalId: string | null;
  saleType: string | null;
  counterparty: string | null;
  quantity: number | null;
  avgMassKg: number | null;
  fees: number | null;
  transportCost: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Wrap a cell value in quotes if it contains a comma, newline, or quote. */
function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function row(...cells: (string | number | null | undefined)[]): string {
  return cells.map(escapeCell).join(",");
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return String(d);
  return date.toISOString().slice(0, 10);
}

// ── Exports ──────────────────────────────────────────────────────────────────

export function animalsToCSV(animals: AnimalRow[]): string {
  const header = row(
    "Animal ID", "Name", "Sex", "Breed", "Category", "Camp", "Status",
    "Date of Birth", "Date Added"
  );
  const rows = animals.map((a) =>
    row(a.animalId, a.name, a.sex, a.breed, a.category, a.currentCamp, a.status, a.dateOfBirth, a.dateAdded)
  );
  return `${header}\n${rows.join("\n")}`;
}

export function withdrawalToCSV(animals: WithdrawalAnimal[]): string {
  const header = row(
    "Animal ID", "Name", "Camp", "Treatment Type",
    "Treated Date", "Withdrawal Ends", "Days Remaining"
  );
  const rows = animals.map((a) =>
    row(
      a.animalId,
      a.name,
      a.campId,
      a.treatmentType,
      formatDate(a.treatedAt),
      formatDate(a.withdrawalEndsAt),
      a.daysRemaining
    )
  );
  return `${header}\n${rows.join("\n")}`;
}

function calvingUrgencyLabel(daysAway: number): string {
  if (daysAway < 0) return "Overdue";
  if (daysAway <= 7) return "Due in 7 days";
  if (daysAway <= 14) return "Due in 14 days";
  return "Upcoming";
}

export function calvingsToCSV(calvings: UpcomingCalving[]): string {
  const header = row(
    "Animal ID", "Camp ID", "Camp Name", "Expected Calving Date",
    "Days Away", "Source", "Urgency"
  );
  const rows = calvings.map((c) =>
    row(
      c.animalId,
      c.campId,
      c.campName,
      formatDate(c.expectedCalving),
      c.daysAway,
      c.source,
      calvingUrgencyLabel(c.daysAway)
    )
  );
  return `${header}\n${rows.join("\n")}`;
}

export function campsToCSV(camps: CampRow[]): string {
  const header = row(
    "Camp ID", "Camp Name", "Size (ha)", "Water Source",
    "Grazing Quality", "Water Status", "Fence Status", "Last Inspected"
  );
  const rows = camps.map((c) =>
    row(
      c.campId,
      c.campName,
      c.sizeHectares,
      c.waterSource,
      c.grazingQuality,
      c.waterStatus,
      c.fenceStatus,
      c.lastInspectedAt
    )
  );
  return `${header}\n${rows.join("\n")}`;
}

// ── Weight History ──────────────────────────────────────────────────────────

export interface WeightHistoryRow {
  animalId: string;
  name: string | null;
  camp: string | null;
  date: string;
  weightKg: number;
}

export function weightHistoryToCSV(rows: WeightHistoryRow[]): string {
  const header = row("Animal ID", "Name", "Camp", "Date", "Weight (kg)");
  const lines = rows.map((r) =>
    row(r.animalId, r.name, r.camp, r.date, r.weightKg)
  );
  return `${header}\n${lines.join("\n")}`;
}

// ── Reproduction Summary ────────────────────────────────────────────────────

export interface ReproSummaryRow {
  metric: string;
  value: string;
  benchmark: string;
}

export function reproSummaryToCSV(rows: ReproSummaryRow[]): string {
  const header = row("Metric", "Value", "SA Benchmark");
  const lines = rows.map((r) => row(r.metric, r.value, r.benchmark));
  return `${header}\n${lines.join("\n")}`;
}

// ── Performance Summary ─────────────────────────────────────────────────────

export interface PerformanceRow {
  campId: string;
  campName: string;
  sizeHectares: number | null;
  animalCount: number;
  lsuPerHa: number | null;
  kgDmPerHa: number | null;
  daysGrazingRemaining: number | null;
}

export function performanceToCSV(rows: PerformanceRow[]): string {
  const header = row(
    "Camp ID", "Camp Name", "Size (ha)", "Animals",
    "LSU/ha", "kg DM/ha", "Days Grazing Remaining"
  );
  const lines = rows.map((r) =>
    row(
      r.campId,
      r.campName,
      r.sizeHectares,
      r.animalCount,
      r.lsuPerHa != null ? r.lsuPerHa.toFixed(2) : null,
      r.kgDmPerHa,
      r.daysGrazingRemaining,
    )
  );
  return `${header}\n${lines.join("\n")}`;
}

// ── Rotation Plan ───────────────────────────────────────────────────────────

export interface RotationPlanExportStep {
  sequence: number;
  campName: string;
  mobName: string | null;
  plannedStart: string; // ISO
  plannedDays: number;
  status: string;
  actualStart: string | null; // ISO
  notes: string | null;
}

export function rotationPlanToCSV(
  planName: string,
  steps: RotationPlanExportStep[],
): string {
  const header = row(
    "Sequence", "Camp", "Mob", "Planned Start", "Planned Days",
    "Status", "Actual Start", "Notes"
  );
  const lines = steps.map((s) =>
    row(
      s.sequence,
      s.campName,
      s.mobName,
      formatDate(s.plannedStart),
      s.plannedDays,
      s.status,
      s.actualStart ? formatDate(s.actualStart) : null,
      s.notes,
    )
  );
  return `# ${planName}\n${header}\n${lines.join("\n")}`;
}

// ── Cost of Gain ────────────────────────────────────────────────────────────

function formatCog(n: number | null): string {
  return n === null ? "" : n.toFixed(2);
}

export function cogByCampToCSV(rows: CogByCampRow[]): string {
  const header = row(
    "Camp ID",
    "Camp Name",
    "Hectares",
    "Active Animals",
    "Total Cost (R)",
    "Kg Gained",
    "Cost of Gain (R/kg)",
  );
  const lines = rows.map((r) =>
    row(
      r.campId,
      r.campName,
      r.hectares,
      r.activeAnimalCount,
      r.totalCost.toFixed(2),
      r.kgGained.toFixed(1),
      formatCog(r.costOfGain),
    ),
  );
  return `${header}\n${lines.join("\n")}`;
}

export function cogByAnimalToCSV(rows: CogByAnimalRow[]): string {
  const header = row(
    "Animal ID",
    "Name",
    "Category",
    "Current Camp",
    "Total Cost (R)",
    "Kg Gained",
    "Cost of Gain (R/kg)",
  );
  const lines = rows.map((r) =>
    row(
      r.animalId,
      r.name,
      r.category,
      r.currentCamp,
      r.totalCost.toFixed(2),
      r.kgGained.toFixed(1),
      formatCog(r.costOfGain),
    ),
  );
  return `${header}\n${lines.join("\n")}`;
}

// ── Veld Score Summary ──────────────────────────────────────────────────────

export interface VeldScoreRow {
  campId: string;
  latestDate: string | null;
  assessor: string | null;
  veldScore: number | null;
  haPerLsu: number | null;
  trendSlope: number;
  daysSinceAssessment: number | null;
}

export function veldScoreToCSV(rows: VeldScoreRow[]): string {
  const header = row(
    "camp_id",
    "latest_date",
    "assessor",
    "veld_score",
    "ha_per_lsu",
    "trend_slope_per_month",
    "days_since_assessment",
  );
  const lines = rows.map((r) =>
    row(
      r.campId,
      r.latestDate,
      r.assessor,
      r.veldScore,
      r.haPerLsu,
      r.trendSlope.toFixed(3),
      r.daysSinceAssessment,
    ),
  );
  return `${header}\n${lines.join("\n")}`;
}

// ── Transactions ────────────────────────────────────────────────────────────

export function transactionsToCSV(transactions: TransactionRow[]): string {
  const header = row(
    "Date", "Type", "Category", "Amount (R)", "Description",
    "Animal ID", "Sale Type", "Buyer/Seller", "Quantity",
    "Avg Mass (kg)", "Fees (R)", "Transport (R)"
  );
  const rows = transactions.map((t) =>
    row(
      t.date,
      t.type,
      t.category,
      t.amount,
      t.description,
      t.animalId,
      t.saleType,
      t.counterparty,
      t.quantity,
      t.avgMassKg,
      t.fees,
      t.transportCost
    )
  );
  return `${header}\n${rows.join("\n")}`;
}

// ── FOO (Feed on Offer) Summary ───────────────────────────────────────────

export interface FooRow {
  campId: string;
  campName: string;
  sizeHectares: number | null;
  kgDmPerHa: number | null;
  status: string;
  effectiveFooKg: number | null;
  capacityLsuDays: number | null;
  lastRecordedAt: string | null;
  daysSinceReading: number | null;
  trendSlope: number;
}

export function fooToCSV(rows: FooRow[]): string {
  const header = row(
    "camp_id",
    "camp_name",
    "size_hectares",
    "kg_dm_per_ha",
    "status",
    "effective_foo_kg",
    "capacity_lsu_days",
    "last_recorded_at",
    "days_since_reading",
    "trend_slope_kg_per_month",
  );
  const lines = rows.map((r) =>
    row(
      r.campId,
      r.campName,
      r.sizeHectares,
      r.kgDmPerHa,
      r.status,
      r.effectiveFooKg != null ? Math.round(r.effectiveFooKg) : null,
      r.capacityLsuDays != null ? Math.round(r.capacityLsuDays) : null,
      r.lastRecordedAt,
      r.daysSinceReading,
      r.trendSlope.toFixed(1),
    ),
  );
  return `${header}\n${lines.join("\n")}`;
}

// ── SARS / IT3 Farming Tax Export ───────────────────────────────────────────

/**
 * Two-section CSV mirroring the PDF layout: farm header, income schedule,
 * expense schedule, summary block, inventory block. Single flat file — the
 * downstream consumer (farmer's accountant) can slice sections in Excel.
 */
export function it3SnapshotToCSV(payload: It3SnapshotPayload): string {
  const lines: string[] = [];
  const f = payload.farm;

  lines.push(row("# SARS / ITR12 Farming Schedule"));
  lines.push(row("# Tax year", String(payload.taxYear)));
  lines.push(row("# Period", `${payload.periodStart} to ${payload.periodEnd}`));
  lines.push(row("# Farm", f.farmName));
  lines.push(row("# Owner", f.ownerName));
  if (f.ownerIdNumber) lines.push(row("# Owner ID", f.ownerIdNumber));
  if (f.propertyRegNumber) lines.push(row("# Property Reg", f.propertyRegNumber));
  if (f.physicalAddress) lines.push(row("# Physical Address", f.physicalAddress));
  if (f.farmRegion) lines.push(row("# Region", f.farmRegion));
  lines.push("");

  lines.push(row("section", "code", "line", "source_categories", "amount_zar", "transaction_count"));

  for (const r of payload.schedules.income) {
    lines.push(
      row("income", r.code, r.line, r.sourceCategories.join("; "), r.amount.toFixed(2), r.count),
    );
  }
  for (const r of payload.schedules.expense) {
    lines.push(
      row("expense", r.code, r.line, r.sourceCategories.join("; "), r.amount.toFixed(2), r.count),
    );
  }

  lines.push("");
  lines.push(row("summary", "total_income_zar", payload.schedules.totalIncome.toFixed(2)));
  lines.push(row("summary", "total_expenses_zar", payload.schedules.totalExpenses.toFixed(2)));
  lines.push(row("summary", "net_farming_income_zar", payload.schedules.netFarmingIncome.toFixed(2)));
  lines.push(row("summary", "transactions_included", payload.schedules.transactionCount));

  lines.push("");
  lines.push(row("inventory", "category", "head_count"));
  for (const r of payload.inventory.byCategory) {
    lines.push(row("inventory", r.category, r.count));
  }
  lines.push(row("inventory", "total_active", payload.inventory.activeAtPeriodEnd));

  return lines.join("\n");
}

export function droughtMonthlyToCSV(rows: DroughtMonthRow[]): string {
  const header = row(
    "month",
    "actual_mm",
    "normal_mm",
    "deviation_mm",
    "spi",
    "severity",
    "source",
  );
  const lines = rows.map((r) =>
    row(
      r.month,
      r.actualMm.toFixed(1),
      r.normalMm.toFixed(1),
      (r.actualMm - r.normalMm).toFixed(1),
      r.spi.toFixed(2),
      r.severity,
      r.source,
    ),
  );
  return `${header}\n${lines.join("\n")}`;
}
