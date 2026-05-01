/**
 * __tests__/server/sars-it3-pdf-foreign.test.ts
 *
 * TDD tests for wave/26e (refs #26 audit finding #22):
 *   PDF rendering of the FOREIGN FARMING INCOME block (SARS source codes
 *   0192 / 0193) on the ITR12 Farming Schedule.
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
  scheduleOverrides: Partial<It3SnapshotPayload["schedules"]> = {},
) {
  const payload: It3SnapshotPayload = {
    taxYear: 2026,
    periodStart: "2025-03-01",
    periodEnd: "2026-02-28",
    farm: {
      farmName: "Cross-Border Farm",
      ownerName: "Test Owner",
      ownerIdNumber: "7001015009088",
      taxReferenceNumber: "1234567890",
      physicalAddress: "1 Border Road, Ficksburg",
      postalAddress: "",
      contactPhone: "0821234567",
      contactEmail: "test@farm.co.za",
      propertyRegNumber: "SG21-123",
      farmRegion: "Free State",
    },
    schedules: {
      income: [
        {
          line: "Sales of livestock",
          code: "",
          amount: 10000,
          sourceCategories: ["Animal Sales"],
          count: 2,
        },
      ],
      expense: [
        {
          line: "Feed and supplements",
          code: "",
          amount: 2000,
          sourceCategories: ["Feed/Supplements"],
          count: 1,
        },
      ],
      totalIncome: 10000,
      totalExpenses: 2000,
      netFarmingIncome: 8000,
      transactionCount: 3,
      farmingActivityCode: "0104",
      foreignFarmingIncome: null,
      ...scheduleOverrides,
    },
    inventory: { activeAtPeriodEnd: 0, byCategory: [] },
    meta: {
      generatedAtIso: "2026-04-30T10:00:00.000Z",
      generatedBy: "test-user",
      sourceTransactionCount: 3,
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
  };
}

describe("buildIt3Pdf — wave/26e: foreignFarmingIncome block", () => {
  it("omits the FOREIGN FARMING INCOME heading when no foreign tx exist", () => {
    const buffer = buildIt3Pdf(makeMockRecord({ foreignFarmingIncome: null }));
    const text = pdfToText(buffer);
    expect(text).not.toContain("FOREIGN FARMING INCOME");
    expect(text).not.toContain("0192");
  });

  it("renders the FOREIGN FARMING INCOME heading + 0192 code when foreign profit", () => {
    const buffer = buildIt3Pdf(
      makeMockRecord({
        foreignFarmingIncome: {
          income: [
            {
              line: "Sales of livestock",
              code: "",
              amount: 5000,
              sourceCategories: ["Animal Sales"],
              count: 1,
            },
          ],
          expense: [
            {
              line: "Veterinary services and medicine",
              code: "",
              amount: 800,
              sourceCategories: ["Medication/Vet"],
              count: 1,
            },
          ],
          totalIncome: 5000,
          totalExpenses: 800,
          net: 4200,
          activityCode: "0192",
        },
      }),
    );
    const text = pdfToText(buffer);
    expect(text).toContain("FOREIGN FARMING INCOME");
    expect(text).toContain("0192");
    // Citation that anchors the user back to the SARS source code register.
    expect(text).toContain("source code 0192");
  });

  it("renders 0193 for foreign loss", () => {
    const buffer = buildIt3Pdf(
      makeMockRecord({
        foreignFarmingIncome: {
          income: [
            {
              line: "Sales of livestock",
              code: "",
              amount: 100,
              sourceCategories: ["Animal Sales"],
              count: 1,
            },
          ],
          expense: [
            {
              line: "Feed and supplements",
              code: "",
              amount: 1000,
              sourceCategories: ["Feed/Supplements"],
              count: 1,
            },
          ],
          totalIncome: 100,
          totalExpenses: 1000,
          net: -900,
          activityCode: "0193",
        },
      }),
    );
    const text = pdfToText(buffer);
    expect(text).toContain("FOREIGN FARMING INCOME");
    expect(text).toContain("0193");
  });

  it("renders correctly for legacy payloads with no foreignFarmingIncome key", () => {
    // Older snapshots (issued before wave/26e) have no foreignFarmingIncome
    // key at all — the PDF must still render and just omit the foreign block.
    const record = makeMockRecord();
    const payload = JSON.parse(record.payload) as It3SnapshotPayload;
    delete (
      payload.schedules as { foreignFarmingIncome?: unknown }
    ).foreignFarmingIncome;
    const legacyRecord = { ...record, payload: JSON.stringify(payload) };
    expect(() => buildIt3Pdf(legacyRecord)).not.toThrow();
    const text = pdfToText(buildIt3Pdf(legacyRecord));
    expect(text).not.toContain("FOREIGN FARMING INCOME");
  });
});
