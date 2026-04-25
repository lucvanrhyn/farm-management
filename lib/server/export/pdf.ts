// lib/server/export/pdf.ts
// Tabular landscape-A4 PDF builder shared by the resource exporters.
// Single source of truth for jsPDF + autoTable styling so the
// per-resource modules don't redeclare the same boilerplate.

import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function pdfFilename(stem: string): string {
  return `${stem}-${today()}.pdf`;
}

export function csvFilename(stem: string): string {
  return `${stem}-${today()}.csv`;
}

export async function buildPdf(
  title: string,
  head: string[],
  body: (string | number | null | undefined)[][],
): Promise<ArrayBuffer> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleDateString("en-ZA")}`, 14, 22);
  autoTable(doc, {
    head: [head],
    body: body.map((r) => r.map((cell) => (cell === null || cell === undefined ? "" : String(cell)))),
    startY: 27,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 246, 243] },
  });
  return doc.output("arraybuffer") as ArrayBuffer;
}
