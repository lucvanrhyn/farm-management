// lib/server/export-csv.ts
// Pure CSV generation helpers — no side effects, no DB calls.

import type { WithdrawalAnimal } from "@/lib/server/treatment-analytics";
import type { UpcomingCalving } from "@/lib/server/reproduction-analytics";

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
