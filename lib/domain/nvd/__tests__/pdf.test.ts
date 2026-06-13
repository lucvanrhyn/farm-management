/**
 * @vitest-environment node
 *
 * Regression: SARS-1 — `renderNvdPdf` must bind the persisted
 * `transportJson` snapshot into `buildNvdPdf`.
 *
 * Bug: `renderNvdPdf` (lib/domain/nvd/pdf.ts) loaded the NvdRecord — which
 * carries the persisted `transportJson` column (written by issueNvd) — but
 * OMITTED `transport` from the argument passed to `buildNvdPdf`. So every
 * livestock-movement NVD printed "Transport details not provided." even when
 * the driver + vehicle WERE captured at issue time. Stock Theft Act §8
 * completeness break — the renderer was already capable of rendering the
 * transport block; the data was simply never plumbed through.
 *
 * These tests exercise the binding layer (`renderNvdPdf`) end-to-end with a
 * mocked Prisma, then assert the REAL transport field values appear (or the
 * placeholder when no transport was captured) in the rendered PDF bytes.
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { renderNvdPdf } from "@/lib/domain/nvd/pdf";

// Decode the jsPDF arraybuffer into a searchable latin-1 string so we can
// assert against the literal text jsPDF embeds in the content stream. Mirrors
// the helper used by __tests__/server/nvd-pdf*.test.ts.
function pdfToText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}

/** A full NvdRecord row as `findUnique` (no select) returns it. */
function makeRecordRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "nvd-1",
    nvdNumber: "NVD-2026-0001",
    issuedAt: new Date("2026-04-30T10:00:00.000Z"),
    saleDate: "2026-04-30",
    transactionId: null,
    buyerName: "John Buyer",
    buyerAddress: "2 Buy Street, Cape Town",
    buyerContact: "0831234567",
    destinationAddress: "Farm B, Stellenbosch",
    animalIds: JSON.stringify(["ZA-001"]),
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
    transportJson: null,
    generatedBy: "test-user",
    pdfHash: null,
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function makePrisma(row: Record<string, unknown> | null): PrismaClient {
  return {
    nvdRecord: { findUnique: vi.fn().mockResolvedValue(row) },
  } as unknown as PrismaClient;
}

describe("renderNvdPdf — SARS-1 transport binding", () => {
  it("renders the captured transport details (driver/vehicle/make-model) when transportJson is persisted", async () => {
    const prisma = makePrisma(
      makeRecordRow({
        transportJson: JSON.stringify({
          driverName: "Jan van der Berg",
          vehicleRegNumber: "CA 123-456",
          vehicleMakeModel: "Toyota Hilux 2.8 GD-6",
        }),
      }),
    );

    const { pdf } = await renderNvdPdf(prisma, "nvd-1");
    const text = pdfToText(pdf);

    // Real values must literally appear — the data was captured, so it must
    // print. Stock Theft Act §8 completeness.
    expect(text).toContain("Jan van der Berg");
    expect(text).toContain("CA 123-456");
    expect(text).toContain("Toyota Hilux");
    // And the placeholder must NOT appear when transport exists.
    expect(text).not.toContain("Transport details not provided");
  });

  it("renders the 'not provided' placeholder when no transport was captured", async () => {
    const prisma = makePrisma(makeRecordRow({ transportJson: null }));

    const { pdf } = await renderNvdPdf(prisma, "nvd-1");
    const text = pdfToText(pdf);

    expect(text).toContain("Transport details not provided");
  });

  it("falls back to the placeholder when transportJson is malformed (defensive parse)", async () => {
    const prisma = makePrisma(
      makeRecordRow({ transportJson: "not-json{" }),
    );

    // Must not throw on a malformed persisted blob, and must degrade to the
    // placeholder rather than crashing the regulated PDF route.
    const { pdf } = await renderNvdPdf(prisma, "nvd-1");
    const text = pdfToText(pdf);

    expect(text).toContain("Transport details not provided");
  });
});
