/**
 * __tests__/server/nvd-pdf.test.ts
 *
 * TDD tests for wave-26 regulatory hotfix:
 *   Fix 4 — NVD transport block (driverName, vehicleRegNumber, vehicleMakeModel)
 *            rendered in the PDF. Stock Theft Act §8 mandatory.
 *
 * Audit NVD table rows 6+7: driver/transporter and vehicle reg are mandatory.
 */

import { describe, it, expect } from "vitest";
import { buildNvdPdf } from "@/lib/server/nvd-pdf";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pdfToText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}

function makeBaseRecord(overrides: Partial<Parameters<typeof buildNvdPdf>[0]> = {}) {
  return {
    nvdNumber: "NVD-2026-0001",
    issuedAt: new Date("2026-04-30T10:00:00.000Z"),
    saleDate: "2026-04-30",
    buyerName: "John Buyer",
    buyerAddress: "2 Buy Street, Cape Town",
    buyerContact: "0831234567",
    destinationAddress: "Farm B, Stellenbosch",
    sellerSnapshot: JSON.stringify({
      farmName: "Test Farm",
      ownerName: "Test Owner",
      ownerIdNumber: "7001015009088",
      physicalAddress: "1 Test Street, Stellenbosch",
      postalAddress: "",
      contactPhone: "0821234567",
      contactEmail: "test@farm.co.za",
      propertyRegNumber: "SG21-123",
      farmRegion: "Western Cape",
    }),
    animalSnapshot: JSON.stringify([
      {
        animalId: "ZA-001",
        name: "Bella",
        sex: "Female",
        breed: "Angus",
        category: "Cow",
        dateOfBirth: "2022-05-01",
        lastCampId: "Camp A",
        lastMovementDate: "2026-03-01",
      },
    ]),
    declarationsJson: JSON.stringify({
      noEid: true,
      noWithdrawal: true,
      noDisease: true,
      noSymptoms: true,
      noPests: true,
      properlyIdentified: true,
      accurateInfo: true,
      notes: "",
    }),
    generatedBy: "test-user",
    pdfHash: null,
    ...overrides,
  };
}

// ── Fix 4: Transport block in PDF ─────────────────────────────────────────────

describe("buildNvdPdf — Fix 4: transport block rendered", () => {
  const transport = {
    driverName: "Jan van der Berg",
    vehicleRegNumber: "CA 123-456",
    vehicleMakeModel: "Toyota Hilux 2.8 GD-6",
  };

  it("renders transport block without throwing when transport data is present", () => {
    const record = makeBaseRecord({ transport });
    expect(() => buildNvdPdf(record)).not.toThrow();
  });

  it("PDF contains driver name when transport is populated", () => {
    const record = makeBaseRecord({ transport });
    const buffer = buildNvdPdf(record);
    const text = pdfToText(buffer);
    expect(text).toContain("Jan van der Berg");
  });

  it("PDF contains vehicle reg number when transport is populated", () => {
    const record = makeBaseRecord({ transport });
    const buffer = buildNvdPdf(record);
    const text = pdfToText(buffer);
    expect(text).toContain("CA 123-456");
  });

  it("PDF contains vehicle make/model when transport is populated", () => {
    const record = makeBaseRecord({ transport });
    const buffer = buildNvdPdf(record);
    const text = pdfToText(buffer);
    expect(text).toContain("Toyota Hilux");
  });

  it("PDF contains TRANSPORT section heading", () => {
    const record = makeBaseRecord({ transport });
    const buffer = buildNvdPdf(record);
    const text = pdfToText(buffer);
    expect(text).toContain("TRANSPORT");
  });
});

describe("buildNvdPdf — Fix 4: empty-state transport", () => {
  it("renders without throwing when transport is not provided", () => {
    const record = makeBaseRecord({ transport: undefined });
    expect(() => buildNvdPdf(record)).not.toThrow();
  });

  it("PDF contains 'Transport details not provided' when transport is absent", () => {
    const record = makeBaseRecord({ transport: undefined });
    const buffer = buildNvdPdf(record);
    const text = pdfToText(buffer);
    expect(text).toContain("Transport details not provided");
  });

  it("PDF contains TRANSPORT section heading even when no transport data", () => {
    const record = makeBaseRecord({ transport: undefined });
    const buffer = buildNvdPdf(record);
    const text = pdfToText(buffer);
    expect(text).toContain("TRANSPORT");
  });
});

describe("buildNvdPdf — Fix 4: transport without make/model", () => {
  it("renders correctly when vehicleMakeModel is omitted", () => {
    const record = makeBaseRecord({
      transport: {
        driverName: "Pieter Botha",
        vehicleRegNumber: "WC 789-012",
        vehicleMakeModel: undefined,
      },
    });
    expect(() => buildNvdPdf(record)).not.toThrow();
  });

  it("shows em-dash for missing vehicleMakeModel", () => {
    const record = makeBaseRecord({
      transport: {
        driverName: "Pieter Botha",
        vehicleRegNumber: "WC 789-012",
        vehicleMakeModel: undefined,
      },
    });
    const buffer = buildNvdPdf(record);
    const text = pdfToText(buffer);
    expect(text).toContain("Pieter Botha");
    expect(text).toContain("WC 789-012");
  });
});

// ── Existing NVD PDF content still renders ────────────────────────────────────

describe("buildNvdPdf — existing content not broken", () => {
  it("renders NVD number in PDF", () => {
    const buffer = buildNvdPdf(makeBaseRecord());
    const text = pdfToText(buffer);
    expect(text).toContain("NVD-2026-0001");
  });

  it("renders buyer name in PDF", () => {
    const buffer = buildNvdPdf(makeBaseRecord());
    const text = pdfToText(buffer);
    expect(text).toContain("John Buyer");
  });

  it("renders animal ID in the animals table", () => {
    const buffer = buildNvdPdf(makeBaseRecord());
    const text = pdfToText(buffer);
    expect(text).toContain("ZA-001");
  });

  it("renders seller farm name", () => {
    const buffer = buildNvdPdf(makeBaseRecord());
    const text = pdfToText(buffer);
    expect(text).toContain("Test Farm");
  });
});
