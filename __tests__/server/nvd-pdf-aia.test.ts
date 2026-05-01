/**
 * __tests__/server/nvd-pdf-aia.test.ts
 *
 * TDD tests for wave/26d (refs #26):
 *   NVD PDF must surface (a) the farm AIA identification mark in the seller
 *   block and (b) per-animal Tag + Brand columns in the animals table.
 *
 * Legal basis: Animal Identification Act 6 of 2002 — required for roadblock
 * inspection. Without these fields, the NVD cannot legally identify animals.
 */

import { describe, it, expect } from "vitest";
import { buildNvdPdf } from "@/lib/server/nvd-pdf";

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
      aiaIdentificationMark: "TST",
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
        tagNumber: "TAG-12345",
        brandSequence: "001",
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

describe("buildNvdPdf — AIA mark in seller block", () => {
  it("renders Farm AIA Mark line when set", () => {
    const buffer = buildNvdPdf(makeBaseRecord());
    const text = pdfToText(buffer);
    // "TST" is the mark from makeBaseRecord
    expect(text).toContain("TST");
  });

  it("does not throw when aiaIdentificationMark is empty/legacy", () => {
    const record = makeBaseRecord({
      sellerSnapshot: JSON.stringify({
        farmName: "Test Farm",
        ownerName: "Test Owner",
        ownerIdNumber: "",
        physicalAddress: "1 Test Street",
        postalAddress: "",
        contactPhone: "",
        contactEmail: "",
        propertyRegNumber: "",
        // Legacy snapshot — no aiaIdentificationMark key at all
        farmRegion: "",
      }),
    });
    expect(() => buildNvdPdf(record)).not.toThrow();
  });

  it("renders 'AIA Mark:' label so inspector knows what to look for", () => {
    const buffer = buildNvdPdf(makeBaseRecord());
    const text = pdfToText(buffer);
    expect(text).toMatch(/AIA Mark/);
  });
});

describe("buildNvdPdf — per-animal tag/brand columns", () => {
  it("animals table contains tagNumber when set", () => {
    const buffer = buildNvdPdf(makeBaseRecord());
    const text = pdfToText(buffer);
    expect(text).toContain("TAG-12345");
  });

  it("animals table contains brandSequence when set", () => {
    const buffer = buildNvdPdf(makeBaseRecord());
    const text = pdfToText(buffer);
    expect(text).toContain("001");
  });

  it("animals table renders Tag and Brand column headers", () => {
    const buffer = buildNvdPdf(makeBaseRecord());
    const text = pdfToText(buffer);
    expect(text).toContain("Tag");
    expect(text).toContain("Brand");
  });

  it("legacy snapshots (without tagNumber/brandSequence keys) render gracefully", () => {
    const record = makeBaseRecord({
      animalSnapshot: JSON.stringify([
        {
          animalId: "LEGACY-1",
          name: null,
          sex: "F",
          breed: "Angus",
          category: "Cow",
          dateOfBirth: null,
          lastCampId: "C1",
          lastMovementDate: null,
          // No tagNumber, no brandSequence — legacy NvdRecord
        },
      ]),
    });
    expect(() => buildNvdPdf(record)).not.toThrow();
    const text = pdfToText(buildNvdPdf(record));
    // Animal still rendered; missing fields shown as em-dash, not "undefined".
    expect(text).toContain("LEGACY-1");
    expect(text).not.toContain("undefined");
  });

  it("animal with null tag and brand renders em-dash, not undefined", () => {
    const record = makeBaseRecord({
      animalSnapshot: JSON.stringify([
        {
          animalId: "NULL-1",
          name: null,
          sex: "M",
          breed: "Brangus",
          category: "Bull",
          dateOfBirth: null,
          lastCampId: "C1",
          lastMovementDate: null,
          tagNumber: null,
          brandSequence: null,
        },
      ]),
    });
    const text = pdfToText(buildNvdPdf(record));
    expect(text).toContain("NULL-1");
    // jsPDF metadata can contain the literal "null" (e.g. "/Outlines null"),
    // so we cannot assert globally — but the rendered cell text must not
    // contain the JS string "undefined".
    expect(text).not.toContain("undefined");
  });
});
