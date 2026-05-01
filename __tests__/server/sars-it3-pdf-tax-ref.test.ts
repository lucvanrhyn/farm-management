/**
 * __tests__/server/sars-it3-pdf-tax-ref.test.ts
 *
 * TDD tests for wave/26c (refs #26 finding #7):
 *   Surface SARS Tax Reference Number on the IT3 / ITR12 Farming Schedule PDF.
 *
 * This is the *one* number SARS uses to key the return — without it on the
 * document the user has nothing to paste into eFiling. Renders an em-dash
 * placeholder when missing so the gap is visible to the user pre-submission.
 */

import { describe, it, expect } from "vitest";
import { buildIt3Pdf } from "@/lib/server/sars-it3-pdf";
import type { It3SnapshotPayload } from "@/lib/server/sars-it3";

function pdfToText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}

function makeMockRecord(
  farmOverrides: Partial<It3SnapshotPayload["farm"]> = {},
  recordOverrides: Partial<Parameters<typeof buildIt3Pdf>[0]> = {},
) {
  const payload: It3SnapshotPayload = {
    taxYear: 2026,
    periodStart: "2025-03-01",
    periodEnd: "2026-02-28",
    farm: {
      farmName: "Test Farm",
      ownerName: "Test Owner",
      ownerIdNumber: "7001015009088",
      taxReferenceNumber: "1234567890",
      physicalAddress: "1 Test Street, Stellenbosch",
      postalAddress: "",
      contactPhone: "0821234567",
      contactEmail: "test@farm.co.za",
      propertyRegNumber: "SG21-123",
      farmRegion: "Western Cape",
      ...farmOverrides,
    },
    schedules: {
      income: [],
      expense: [],
      totalIncome: 0,
      totalExpenses: 0,
      netFarmingIncome: 0,
      transactionCount: 0,
      farmingActivityCode: "0104",
    },
    inventory: { activeAtPeriodEnd: 0, byCategory: [] },
    meta: {
      generatedAtIso: "2026-04-30T10:00:00.000Z",
      generatedBy: "test-user",
      sourceTransactionCount: 0,
      categoryMapVersion: "2026-04-30",
      mappedCategories: [],
    },
  };

  return {
    taxYear: 2026,
    issuedAt: new Date("2026-04-30T10:00:00.000Z"),
    payload: JSON.stringify(payload),
    generatedBy: "test-user",
    pdfHash: null,
    voidedAt: null,
    voidReason: null,
    ...recordOverrides,
  };
}

describe("buildIt3Pdf — wave/26c: taxReferenceNumber surfacing", () => {
  it("renders the Tax Ref Number value when set on the payload", () => {
    const buffer = buildIt3Pdf(makeMockRecord({ taxReferenceNumber: "1234567890" }));
    const text = pdfToText(buffer);
    expect(text).toContain("Tax Ref");
    expect(text).toContain("1234567890");
  });

  it("renders a placeholder when taxReferenceNumber is missing — never the literal string 'undefined' or 'null'", () => {
    // Empty string — user hasn't filled the field yet.
    const buffer = buildIt3Pdf(makeMockRecord({ taxReferenceNumber: "" }));
    const text = pdfToText(buffer);
    expect(text).toContain("Tax Ref");
    // Sanity: never leak undefined/null/empty into the PDF body.
    expect(text).not.toContain("Tax Ref Number: undefined");
    expect(text).not.toContain("Tax Ref Number: null");
    // The em-dash (U+2014) is encoded as WinAnsi byte 0x97 by jsPDF, so
    // searching for the literal "—" character won't work via byte-string
    // extraction. Instead we assert the value slot literally ends with the
    // em-dash byte (0x97) — that's how jsPDF serialises U+2014 in the text
    // operator stream `(Tax Ref Number: )`.
    const taxRefMatch = text.match(/Tax Ref Number:[^)]*/);
    expect(taxRefMatch).not.toBeNull();
    // Value portion must contain the em-dash byte (0x97), not a digit.
    expect(taxRefMatch![0]).toContain("");
    expect(taxRefMatch![0]).not.toMatch(/\d/);
  });

  it("renders correctly for legacy payloads with no taxReferenceNumber field", () => {
    // Older snapshots (issued before wave/26c) have no taxReferenceNumber key
    // at all. The PDF must still render and use the em-dash placeholder.
    const payload = JSON.parse(makeMockRecord().payload) as It3SnapshotPayload;
    delete (payload.farm as { taxReferenceNumber?: string }).taxReferenceNumber;
    const record = {
      ...makeMockRecord(),
      payload: JSON.stringify(payload),
    };
    expect(() => buildIt3Pdf(record)).not.toThrow();
    const text = pdfToText(buildIt3Pdf(record));
    expect(text).toContain("Tax Ref");
  });

  it("Tax Ref Number line appears before ID Number in the output stream", () => {
    // Audit: per wave/26c spec, "Tax Ref Number" is rendered above "ID Number".
    const buffer = buildIt3Pdf(makeMockRecord({ taxReferenceNumber: "9876543210" }));
    const text = pdfToText(buffer);
    const taxIdx = text.indexOf("Tax Ref");
    const idIdx = text.indexOf("ID:");
    expect(taxIdx).toBeGreaterThan(-1);
    expect(idIdx).toBeGreaterThan(-1);
    expect(taxIdx).toBeLessThan(idIdx);
  });
});
