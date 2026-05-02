/**
 * __tests__/server/nvd-pdf-fallback.test.ts
 *
 * TDD red-green-refactor for wave/59-nvd-pdf-fallback (refs #26).
 *
 * Bug: lib/server/nvd-pdf.ts rendered the literal string "undefined" into the
 * regulatory NVD PDF when an optional field was missing from the payload —
 * specifically `transport.vehicleRegNumber` (Stock Theft Act §8 row 7), but
 * also any other unguarded interpolation. PDF/jsPDF coerces undefined to the
 * string "undefined" via String(value), which is illegible to a SAPS roadblock
 * inspector and embarrassing on a regulated document.
 *
 * Class-of-bug: see memory/feedback-regulatory-output-validate-against-spec.md.
 *
 * These tests render the PDF with each unguarded field individually missing
 * and assert the rendered text never contains the literal "undefined".
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

function makeBaseRecord(
  overrides: Partial<Parameters<typeof buildNvdPdf>[0]> = {}
) {
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
        tagNumber: "TAG-1",
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

// ── Transport: missing vehicleRegNumber (the originally-reported bug) ─────────

describe("buildNvdPdf — fallback: transport.vehicleRegNumber missing", () => {
  it("does not render literal 'undefined' when vehicleRegNumber is omitted", () => {
    const record = makeBaseRecord({
      transport: {
        driverName: "Pieter Botha",
        // vehicleRegNumber missing — NvdTransportDetails declares it required
        // but legacy snapshots / partial form submissions drop it.
        vehicleRegNumber: undefined as unknown as string,
        vehicleMakeModel: "Toyota Hilux",
      },
    });
    const text = pdfToText(buildNvdPdf(record));
    expect(text).not.toContain("undefined");
  });

  it("does not render literal 'undefined' when both reg and make/model omitted", () => {
    const record = makeBaseRecord({
      transport: {
        driverName: "Pieter Botha",
        vehicleRegNumber: undefined as unknown as string,
        vehicleMakeModel: undefined,
      },
    });
    const text = pdfToText(buildNvdPdf(record));
    expect(text).not.toContain("undefined");
  });
});

// ── Animal snapshot: legacy entries missing required-typed string fields ─────

describe("buildNvdPdf — fallback: legacy animal snapshot fields", () => {
  it("renders without 'undefined' when animal entry has no category/sex/breed", () => {
    const record = makeBaseRecord({
      animalSnapshot: JSON.stringify([
        {
          animalId: "ZA-LEGACY",
          // category, sex, breed, lastCampId all missing — legacy snapshots
          // pre-dating wave/26d may lack them. Type signature says required,
          // but the JSON-stored snapshot may not contain the keys.
          dateOfBirth: null,
          lastMovementDate: null,
          tagNumber: null,
          brandSequence: null,
        },
      ]),
    });
    const text = pdfToText(buildNvdPdf(record));
    expect(text).not.toContain("undefined");
  });
});

// ── Seller snapshot: legacy seller missing required-typed string fields ──────

describe("buildNvdPdf — fallback: legacy seller snapshot fields", () => {
  it("renders without 'undefined' when seller snapshot has only farmName", () => {
    const record = makeBaseRecord({
      sellerSnapshot: JSON.stringify({
        farmName: "Test Farm",
        // ownerName, physicalAddress, farmRegion all missing
      }),
    });
    const text = pdfToText(buildNvdPdf(record));
    expect(text).not.toContain("undefined");
  });
});

// ── Top-level record: missing buyerName (defensive) ──────────────────────────

describe("buildNvdPdf — fallback: top-level record fields", () => {
  it("renders without 'undefined' when buyerName is missing entirely", () => {
    const record = makeBaseRecord({
      buyerName: undefined as unknown as string,
    });
    const text = pdfToText(buildNvdPdf(record));
    expect(text).not.toContain("undefined");
  });
});
