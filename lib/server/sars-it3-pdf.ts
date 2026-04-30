/**
 * lib/server/sars-it3-pdf.ts
 *
 * Renders a SARS IT3 / ITR12 farming schedule as an A4 portrait PDF.
 * Mirrors the jsPDF + autoTable pattern from `lib/server/nvd-pdf.ts`.
 *
 * All data comes from the stored It3Snapshot payload — the PDF is reproducible
 * at any later date without touching live Transaction or FarmSettings rows.
 * This is critical for audit trail: once a return is filed, the PDF must not
 * drift because of later transaction edits.
 */

import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { formatZar } from "@/lib/calculators/sars-it3";
import type { It3SnapshotPayload } from "./sars-it3";

// ── Types ─────────────────────────────────────────────────────────────────────

interface It3RecordView {
  taxYear: number;
  issuedAt: Date | string;
  payload: string; // JSON string of It3SnapshotPayload
  generatedBy: string | null;
  pdfHash: string | null;
  voidedAt: Date | string | null;
  voidReason: string | null;
}

// ── Colour palette (matches NVD) ──────────────────────────────────────────────

const DARK = "#1C1815";
const GREEN = [74, 124, 89] as [number, number, number];
const LIGHT_GREEN: [number, number, number] = [225, 238, 229];
const GREY: [number, number, number] = [248, 246, 243];
const MID_GREY: [number, number, number] = [200, 200, 200];
const RED: [number, number, number] = [139, 58, 58];

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function formatDate(iso: string | Date | null): string {
  if (!iso) return "—";
  const s = typeof iso === "string" ? iso : iso.toISOString();
  return s.slice(0, 10);
}

// ── Main renderer ─────────────────────────────────────────────────────────────

export function buildIt3Pdf(record: It3RecordView): ArrayBuffer {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const payload = parseJson<It3SnapshotPayload>(record.payload, {
    taxYear: record.taxYear,
    periodStart: "",
    periodEnd: "",
    farm: {
      farmName: "My Farm",
      ownerName: "",
      ownerIdNumber: "",
      physicalAddress: "",
      postalAddress: "",
      contactPhone: "",
      contactEmail: "",
      propertyRegNumber: "",
      farmRegion: "",
    },
    schedules: {
      income: [],
      expense: [],
      totalIncome: 0,
      totalExpenses: 0,
      netFarmingIncome: 0,
      transactionCount: 0,
      farmingActivityCode: "0102",
    },
    inventory: { activeAtPeriodEnd: 0, byCategory: [] },
    meta: {
      generatedAtIso: "",
      generatedBy: null,
      sourceTransactionCount: 0,
      categoryMapVersion: "",
      mappedCategories: [],
    },
  });

  const pageWidth = 210; // A4 portrait mm
  const pageHeight = 297;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  // ── Header ────────────────────────────────────────────────────────────────

  doc.setFillColor(...GREEN);
  doc.rect(0, 0, pageWidth, 22, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("SARS ITR12 Farming Schedule", margin, 10);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Tax Year ${payload.taxYear}  |  Period: ${payload.periodStart} to ${payload.periodEnd}  |  Issued: ${formatDate(record.issuedAt)}`,
    margin,
    17,
  );

  let y = 28;

  // ── Void banner (if applicable) ──────────────────────────────────────────

  if (record.voidedAt) {
    doc.setFillColor(...RED);
    doc.rect(margin, y, contentWidth, 8, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(
      `VOIDED ${formatDate(record.voidedAt)} — ${record.voidReason ?? "no reason given"}`,
      margin + 3,
      y + 5.5,
    );
    y += 12;
  }

  // ── Farm identity block ──────────────────────────────────────────────────

  doc.setFillColor(...LIGHT_GREEN);
  doc.rect(margin, y, contentWidth, 40, "F");
  doc.setTextColor(DARK);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("FARMING ENTITY (SELLER / OPERATOR)", margin + 3, y + 6);
  doc.setFont("helvetica", "normal");

  const farmLines = [
    payload.farm.farmName,
    payload.farm.ownerName,
    payload.farm.ownerIdNumber ? `ID: ${payload.farm.ownerIdNumber}` : "",
    payload.farm.physicalAddress,
    payload.farm.postalAddress ? `Postal: ${payload.farm.postalAddress}` : "",
    payload.farm.contactPhone ? `Tel: ${payload.farm.contactPhone}` : "",
    payload.farm.contactEmail ? `Email: ${payload.farm.contactEmail}` : "",
    payload.farm.propertyRegNumber ? `Prop. Reg / LPHS: ${payload.farm.propertyRegNumber}` : "",
    payload.farm.farmRegion ? `Region: ${payload.farm.farmRegion}` : "",
  ].filter(Boolean);

  // Two-column layout
  const halfWidth = (contentWidth - 6) / 2;
  farmLines.slice(0, 5).forEach((line, i) => {
    doc.text(line, margin + 3, y + 12 + i * 4.5);
  });
  farmLines.slice(5).forEach((line, i) => {
    doc.text(line, margin + halfWidth + 6, y + 12 + i * 4.5);
  });

  y += 46;

  // ── Farming activity code block ──────────────────────────────────────────

  const farmingCode = payload.schedules.farmingActivityCode ?? payload.meta.farmingActivityCode ?? "—";
  doc.setFillColor(...LIGHT_GREEN);
  doc.rect(margin, y, contentWidth, 10, "F");
  doc.setTextColor(DARK);
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.text("SARS Farming Activity Code (ITR12):", margin + 3, y + 7);
  doc.setFontSize(9);
  doc.text(farmingCode, margin + 72, y + 7);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(80, 80, 80);
  doc.text("Enter this code on your ITR12 under 'Farming Operations'. Verify at sars.gov.za before filing.", margin + 82, y + 7);
  y += 16;

  // ── Income schedule ──────────────────────────────────────────────────────

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(DARK);
  doc.text("FARMING INCOME", margin, y);
  y += 4;

  autoTable(doc, {
    head: [["Line Item", "Contributing Categories", "Amount (R)"]],
    body: payload.schedules.income.map((r) => [
      r.line,
      r.sourceCategories.join(", "),
      formatZar(r.amount),
    ]),
    foot:
      payload.schedules.income.length > 0
        ? [[
            "Total farming income",
            "",
            formatZar(payload.schedules.totalIncome),
          ]]
        : undefined,
    startY: y,
    margin: { left: margin, right: margin },
    styles: { fontSize: 7.8, cellPadding: 1.8 },
    headStyles: { fillColor: GREEN, textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: LIGHT_GREEN, textColor: DARK, fontStyle: "bold" },
    alternateRowStyles: { fillColor: GREY },
    columnStyles: {
      0: { cellWidth: 88 },
      1: { cellWidth: 64 },
      2: { cellWidth: 30, halign: "right" },
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 6;

  // Page break if we're running low
  if (y > pageHeight - 80) {
    doc.addPage();
    y = 20;
  }

  // ── Expense schedule ─────────────────────────────────────────────────────

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(DARK);
  doc.text("FARMING EXPENSES", margin, y);
  y += 4;

  autoTable(doc, {
    head: [["Line Item", "Contributing Categories", "Amount (R)"]],
    body: payload.schedules.expense.map((r) => [
      r.line,
      r.sourceCategories.join(", "),
      formatZar(r.amount),
    ]),
    foot:
      payload.schedules.expense.length > 0
        ? [[
            "Total farming expenses",
            "",
            formatZar(payload.schedules.totalExpenses),
          ]]
        : undefined,
    startY: y,
    margin: { left: margin, right: margin },
    styles: { fontSize: 7.8, cellPadding: 1.8 },
    headStyles: { fillColor: GREEN, textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: LIGHT_GREEN, textColor: DARK, fontStyle: "bold" },
    alternateRowStyles: { fillColor: GREY },
    columnStyles: {
      0: { cellWidth: 88 },
      1: { cellWidth: 64 },
      2: { cellWidth: 30, halign: "right" },
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 6;

  // Page break before summary if needed
  if (y > pageHeight - 70) {
    doc.addPage();
    y = 20;
  }

  // ── Summary box ──────────────────────────────────────────────────────────

  const summaryHeight = 26;
  doc.setFillColor(...LIGHT_GREEN);
  doc.rect(margin, y, contentWidth, summaryHeight, "F");
  doc.setTextColor(DARK);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("SUMMARY", margin + 3, y + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);

  const rowX1 = margin + 3;
  const rowX2 = pageWidth - margin - 3;

  doc.text("Total farming income", rowX1, y + 12);
  doc.text(formatZar(payload.schedules.totalIncome), rowX2, y + 12, { align: "right" });

  doc.text("Total farming expenses", rowX1, y + 17);
  doc.text(formatZar(payload.schedules.totalExpenses), rowX2, y + 17, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.text("Net farming income", rowX1, y + 23);
  doc.text(formatZar(payload.schedules.netFarmingIncome), rowX2, y + 23, { align: "right" });

  y += summaryHeight + 6;

  // ── Inventory block ──────────────────────────────────────────────────────

  if (y > pageHeight - 50) {
    doc.addPage();
    y = 20;
  }

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(DARK);
  doc.text("LIVESTOCK INVENTORY AT ISSUE DATE", margin, y);
  y += 4;

  if (payload.inventory.byCategory.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text("No active livestock recorded at issue time.", margin, y + 4);
    y += 12;
  } else {
    autoTable(doc, {
      head: [["Category", "Head Count"]],
      body: payload.inventory.byCategory.map((r) => [r.category, String(r.count)]),
      foot: [[
        "Total active at period end",
        String(payload.inventory.activeAtPeriodEnd),
      ]],
      startY: y,
      margin: { left: margin, right: margin },
      styles: { fontSize: 7.8, cellPadding: 1.6 },
      headStyles: { fillColor: GREEN, textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: LIGHT_GREEN, textColor: DARK, fontStyle: "bold" },
      alternateRowStyles: { fillColor: GREY },
      columnStyles: {
        0: { cellWidth: 100 },
        1: { cellWidth: 30, halign: "right" },
      },
      tableWidth: 130,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 6;
  }

  // ── Advisory note ────────────────────────────────────────────────────────

  if (y > pageHeight - 35) {
    doc.addPage();
    y = 20;
  }

  doc.setDrawColor(...MID_GREY);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  // Fix 3: Bold "NOT an IT3-series form" disclaimer (audit finding)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(80, 30, 30);
  doc.text(
    "WARNING: This is NOT an IT3-series form.",
    margin,
    y,
  );
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 100, 100);
  const disclaimer = [
    "Forms in the IT3-series (IT3(a), IT3(b), IT3(c)) are third-party data submission certificates (employer payroll,",
    "dividends, retirement). This document is the ITR12 Farming Schedule (individual taxpayer) or IT48 (companies).",
    "Do NOT attach this document to an IT3(a) or any other IT3-series submission.",
    "Confirm current source codes at: https://www.sars.gov.za/types-of-tax/personal-income-tax/filing-season/find-a-source-code/",
    "All transaction data is a frozen snapshot at issue time; later edits to your Farm records do not change this PDF.",
  ];
  disclaimer.forEach((line, i) => doc.text(line, margin, y + i * 4));
  y += disclaimer.length * 4 + 4;

  // ── Footer ───────────────────────────────────────────────────────────────

  doc.setFontSize(6.5);
  doc.setTextColor(150, 150, 150);
  doc.text(
    `Generated by FarmTrack  •  ${record.generatedBy ?? payload.meta.generatedBy ?? "system"}  •  ${new Date().toLocaleDateString("en-ZA")}`,
    margin,
    pageHeight - 10,
  );
  doc.text(
    `Source: ${payload.meta.sourceTransactionCount} transactions  •  Category map: ${payload.meta.categoryMapVersion}`,
    margin,
    pageHeight - 6,
  );
  if (record.pdfHash) {
    doc.text(`SHA-256: ${record.pdfHash}`, pageWidth - margin, pageHeight - 6, { align: "right" });
  }

  return doc.output("arraybuffer") as ArrayBuffer;
}
