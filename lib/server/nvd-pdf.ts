/**
 * lib/server/nvd-pdf.ts
 *
 * Renders an NVD (National Vendor Declaration) as an A4 portrait PDF.
 * Mirrors the jsPDF + autoTable pattern from app/api/[farmSlug]/export/route.ts.
 *
 * All data comes from the NvdRecord snapshot — the PDF is reproducible at any
 * point in time without touching live Animal or FarmSettings data.
 */

import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import type { SellerSnapshot, AnimalSnapshotEntry, NvdTransportDetails } from "./nvd";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NvdRecordView {
  nvdNumber: string;
  issuedAt: Date | string;
  saleDate: string;
  buyerName: string;
  buyerAddress: string | null;
  buyerContact: string | null;
  destinationAddress: string | null;
  sellerSnapshot: string;    // JSON string of SellerSnapshot
  animalSnapshot: string;    // JSON string of AnimalSnapshotEntry[]
  declarationsJson: string;  // JSON string of declaration booleans
  /**
   * JSON string of NvdTransportDetails (driverName, vehicleRegNumber, vehicleMakeModel).
   * Required by Stock Theft Act §8 for vehicular movements.
   * Null for records issued before wave/26 or for non-vehicular movements.
   */
  transport?: NvdTransportDetails | null;
  generatedBy: string | null;
  pdfHash: string | null;
}

interface DeclarationState {
  noEid: boolean;              // No EID devices implanted
  noWithdrawal: boolean;       // No animals in withdrawal
  noDisease: boolean;          // No known notifiable disease
  noSymptoms: boolean;         // No clinical signs of disease in last 30 days
  noPests: boolean;            // No external parasites / pest control within 7 days
  properlyIdentified: boolean; // All animals properly identified
  accurateInfo: boolean;       // Information is accurate and complete
  notes: string;
}

// ── Colour palette ────────────────────────────────────────────────────────────

const DARK = "#1C1815";
const GREEN = [74, 124, 89] as [number, number, number];
const LIGHT_GREEN: [number, number, number] = [225, 238, 229];
const GREY: [number, number, number] = [248, 246, 243];
const MID_GREY: [number, number, number] = [200, 200, 200];

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

function tick(value: boolean): string {
  return value ? "✓" : "✗";
}

// ── Main renderer ─────────────────────────────────────────────────────────────

export function buildNvdPdf(record: NvdRecordView): ArrayBuffer {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const seller = parseJson<SellerSnapshot>(record.sellerSnapshot, {
    farmName: "My Farm",
    ownerName: "",
    ownerIdNumber: "",
    physicalAddress: "",
    postalAddress: "",
    contactPhone: "",
    contactEmail: "",
    propertyRegNumber: "",
    aiaIdentificationMark: "",
    farmRegion: "",
  });

  const animals = parseJson<AnimalSnapshotEntry[]>(record.animalSnapshot, []);

  const decl = parseJson<DeclarationState>(record.declarationsJson, {
    noEid: false,
    noWithdrawal: false,
    noDisease: false,
    noSymptoms: false,
    noPests: false,
    properlyIdentified: false,
    accurateInfo: false,
    notes: "",
  });

  const pageWidth = 210; // A4 portrait mm
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  // ── Header ────────────────────────────────────────────────────────────────

  // Green header bar
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, pageWidth, 22, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("NATIONAL VENDOR DECLARATION (NVD)", margin, 10);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`${record.nvdNumber}  |  Issued: ${formatDate(record.issuedAt)}  |  Sale Date: ${formatDate(record.saleDate)}`, margin, 17);

  let y = 28;

  // ── Seller + Buyer blocks side-by-side ────────────────────────────────────

  const colWidth = (contentWidth - 6) / 2;

  // Seller block
  doc.setFillColor(...LIGHT_GREEN);
  doc.rect(margin, y, colWidth, 46, "F");
  doc.setTextColor(DARK);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("SELLER / VENDOR", margin + 3, y + 6);
  doc.setFont("helvetica", "normal");
  const sellerLines = [
    seller.farmName,
    seller.ownerName,
    seller.physicalAddress,
    seller.postalAddress ? `Postal: ${seller.postalAddress}` : "",
    seller.contactPhone ? `Tel: ${seller.contactPhone}` : "",
    seller.contactEmail ? `Email: ${seller.contactEmail}` : "",
    seller.propertyRegNumber ? `Prop. Reg: ${seller.propertyRegNumber}` : "",
    // AIA Mark — surfaced on every NVD per Animal Identification Act 2002.
    // Always rendered (with em-dash when unset) so a roadblock inspector
    // sees the field exists even when the farmer has not yet registered.
    `AIA Mark: ${seller.aiaIdentificationMark || "—"}`,
    seller.farmRegion,
  ].filter(Boolean);
  sellerLines.forEach((line, i) => {
    doc.text(line, margin + 3, y + 12 + i * 4.5);
  });

  // Buyer block
  const buyerX = margin + colWidth + 6;
  doc.setFillColor(...GREY);
  doc.rect(buyerX, y, colWidth, 46, "F");
  doc.setFont("helvetica", "bold");
  doc.text("BUYER / CONSIGNEE", buyerX + 3, y + 6);
  doc.setFont("helvetica", "normal");
  const buyerLines = [
    record.buyerName,
    record.buyerAddress ?? "",
    record.buyerContact ? `Contact: ${record.buyerContact}` : "",
    record.destinationAddress ? `Destination: ${record.destinationAddress}` : "",
  ].filter(Boolean);
  buyerLines.forEach((line, i) => {
    doc.text(line, buyerX + 3, y + 12 + i * 4.5);
  });

  y += 52;

  // ── Sale summary line ─────────────────────────────────────────────────────

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(DARK);
  doc.text(`Total head: ${animals.length}`, margin, y);
  doc.setFont("helvetica", "normal");

  y += 6;

  // ── Animals table ─────────────────────────────────────────────────────────

  // Animals table — AIA 2002 requires Tag + Brand columns alongside the
  // FarmTrack-internal animalId. `tagNumber` and `brandSequence` are nullable
  // and default to em-dash for legacy snapshots issued before wave/26d.
  autoTable(doc, {
    head: [["Animal ID", "Tag", "Brand", "Category", "Sex", "Breed", "D.O.B", "Last Camp", "Last Move"]],
    body: animals.map((a) => [
      a.animalId,
      a.tagNumber ?? "—",
      a.brandSequence ?? "—",
      a.category,
      a.sex,
      a.breed,
      a.dateOfBirth ?? "—",
      a.lastCampId,
      a.lastMovementDate ?? "—",
    ]),
    startY: y,
    margin: { left: margin, right: margin },
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: GREEN, textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: GREY },
    columnStyles: {
      0: { cellWidth: 20 }, // Animal ID
      1: { cellWidth: 18 }, // Tag
      2: { cellWidth: 16 }, // Brand
      3: { cellWidth: 20 }, // Category
      4: { cellWidth: 9 },  // Sex
      5: { cellWidth: 18 }, // Breed
      6: { cellWidth: 18 }, // D.O.B
      7: { cellWidth: 22 }, // Last Camp
      8: { cellWidth: 21 }, // Last Move
    },
  });

  y = (// eslint-disable-next-line @typescript-eslint/no-explicit-any
(doc as any).lastAutoTable?.finalY ?? y) + 8;

  // ── Declarations ──────────────────────────────────────────────────────────

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(DARK);
  doc.text("VENDOR DECLARATIONS", margin, y);

  y += 5;

  const declarations: Array<{ label: string; value: boolean }> = [
    { label: "No EID devices (transponders) implanted in any of these animals.", value: decl.noEid },
    { label: "No animals are within a withholding / withdrawal period for any veterinary treatment.", value: decl.noWithdrawal },
    { label: "No known notifiable disease is present on the property of origin.", value: decl.noDisease },
    { label: "No clinical signs of disease observed in the last 30 days.", value: decl.noSymptoms },
    { label: "No animals treated with pest-control substances within the last 7 days.", value: decl.noPests },
    { label: "All animals are properly identified (tag, brand, or tattoo) as required by law.", value: decl.properlyIdentified },
    { label: "The information provided is accurate and complete to the best of my knowledge.", value: decl.accurateInfo },
  ];

  declarations.forEach((d, i) => {
    const tickColor = d.value ? GREEN : [139, 58, 58] as [number, number, number];
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...tickColor);
    doc.text(tick(d.value), margin, y + i * 6);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(DARK);
    doc.text(`  ${d.label}`, margin + 5, y + i * 6);
  });

  y += declarations.length * 6 + 4;

  if (decl.notes && decl.notes.trim()) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    const noteLines = doc.splitTextToSize(`Notes: ${decl.notes}`, contentWidth) as string[];
    doc.text(noteLines, margin, y);
    y += noteLines.length * 4 + 4;
  }

  // ── Transport block (Stock Theft Act §8) ─────────────────────────────────

  doc.setDrawColor(...MID_GREY);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(DARK);
  doc.text("TRANSPORT", margin, y);
  y += 5;

  const transport = record.transport ?? null;
  if (transport && transport.driverName) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    const transportRows: [string, string][] = [
      ["Driver:", transport.driverName],
      ["Vehicle reg:", transport.vehicleRegNumber],
      ["Vehicle make/model:", transport.vehicleMakeModel ?? "—"],
    ];
    const labelX = margin;
    const valueX = margin + 40;
    transportRows.forEach(([label, value], i) => {
      doc.setFont("helvetica", "bold");
      doc.text(label, labelX, y + i * 5.5);
      doc.setFont("helvetica", "normal");
      doc.text(value, valueX, y + i * 5.5);
    });
    y += transportRows.length * 5.5 + 4;
  } else {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(120, 100, 80);
    doc.text("Transport details not provided.", margin, y);
    y += 8;
  }

  // ── Signature block ───────────────────────────────────────────────────────

  // Separator line
  doc.setDrawColor(...MID_GREY);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(DARK);
  doc.text("SELLER'S DECLARATION & SIGNATURE", margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(
    `I, the undersigned, declare that the information above is true and correct, and that all animals have been`,
    margin, y
  );
  y += 4;
  doc.text("inspected and found to be in good health immediately before dispatch.", margin, y);
  y += 10;

  // Printed name, signature, date
  const sigColW = contentWidth / 3;
  doc.text(`Name: ${seller.ownerName || "___________________________"}`, margin, y);
  doc.text("Signature: _______________________", margin + sigColW + 3, y);
  doc.text(`Date: ___________________`, margin + (sigColW + 3) * 2, y);

  // ── Footer ────────────────────────────────────────────────────────────────

  const pageHeight = 297; // A4 portrait mm
  doc.setFontSize(6.5);
  doc.setTextColor(150, 150, 150);
  doc.text(
    `Generated by FarmTrack  •  ${record.generatedBy ?? "system"}  •  ${new Date().toLocaleDateString("en-ZA")}`,
    margin,
    pageHeight - 10
  );
  if (record.pdfHash) {
    doc.text(`SHA-256: ${record.pdfHash}`, margin, pageHeight - 6);
  }

  return doc.output("arraybuffer") as ArrayBuffer;
}
