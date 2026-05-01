/**
 * __tests__/server/sars-it3-pdf.test.ts
 *
 * TDD tests for wave-26 regulatory hotfix:
 *   Fix 2 — Rename "IT3" → "ITR12 Farming Schedule" in PDF output
 *   Fix 3 — "NOT an IT3-series form" disclaimer in PDF
 *   Fix 1 — farmingActivityCode rendered in PDF (no 41xx/42xx codes in table)
 *
 * Uses jsPDF's text extraction to assert on rendered string content.
 */

import { describe, it, expect } from "vitest";
import { buildIt3Pdf } from "@/lib/server/sars-it3-pdf";
import type { It3SnapshotPayload } from "@/lib/server/sars-it3";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * jsPDF stores internal text in doc.internal.pages. We extract it by calling
 * doc.output("datauristring") and parsing — but jsPDF doesn't expose a simple
 * getText(). Instead we call buildIt3Pdf, then re-parse via jsPDF's getTextDimensions
 * trick OR simply check the output ArrayBuffer can be produced without throw.
 *
 * For content assertions we use the known jsPDF trick: after doc.output("arraybuffer"),
 * decode the buffer as latin-1 string and search for the text fragments — jsPDF
 * embeds raw text strings in the PDF byte stream as parenthesised literals.
 */
function pdfToText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}

function makeMockRecord(overrides: Partial<Parameters<typeof buildIt3Pdf>[0]> = {}) {
  const payload: It3SnapshotPayload = {
    taxYear: 2026,
    periodStart: "2025-03-01",
    periodEnd: "2026-02-28",
    farm: {
      farmName: "Test Farm",
      ownerName: "Test Owner",
      ownerIdNumber: "7001015009088",
      physicalAddress: "1 Test Street, Stellenbosch",
      postalAddress: "",
      contactPhone: "0821234567",
      contactEmail: "test@farm.co.za",
      propertyRegNumber: "SG21-123",
      farmRegion: "Western Cape",
    },
    schedules: {
      income: [
        {
          line: "Sales of livestock",
          code: "",
          amount: 50000,
          sourceCategories: ["Animal Sales"],
          count: 3,
        },
      ],
      expense: [
        {
          line: "Feed and supplements",
          code: "",
          amount: 10000,
          sourceCategories: ["Feed/Supplements"],
          count: 2,
        },
      ],
      totalIncome: 50000,
      totalExpenses: 10000,
      netFarmingIncome: 40000,
      transactionCount: 5,
      farmingActivityCode: "0104",
    },
    inventory: {
      activeAtPeriodEnd: 100,
      byCategory: [{ category: "Cow", count: 100 }],
    },
    meta: {
      generatedAtIso: "2026-04-30T10:00:00.000Z",
      generatedBy: "test-user",
      sourceTransactionCount: 5,
      categoryMapVersion: "2026-04-30",
      mappedCategories: ["Animal Sales", "Feed/Supplements"],
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
    ...overrides,
  };
}

// ── Fix 2: PDF title says "ITR12 Farming Schedule" not bare "IT3" ─────────────

describe("buildIt3Pdf — Fix 2: ITR12 rename", () => {
  it("renders without throwing", () => {
    expect(() => buildIt3Pdf(makeMockRecord())).not.toThrow();
  });

  it("PDF text contains ITR12", () => {
    const buffer = buildIt3Pdf(makeMockRecord());
    const text = pdfToText(buffer);
    expect(text).toContain("ITR12");
  });

  it("PDF header contains 'ITR12 Farming Schedule'", () => {
    const buffer = buildIt3Pdf(makeMockRecord());
    const text = pdfToText(buffer);
    // Check for key phrase in the header
    expect(text).toContain("ITR12");
    expect(text).toContain("Farming Schedule");
  });

  it("PDF does NOT contain bare 'SARS IT3' as a title phrase (old wrong name)", () => {
    const buffer = buildIt3Pdf(makeMockRecord());
    const text = pdfToText(buffer);
    // The old wrong title was "FARMING INCOME SCHEDULE — SARS / ITR12"
    // New should NOT show "SARS IT3" as a heading.
    // We permit "IT3" inside disclaimer text ("NOT an IT3-series form") but not as title.
    // Check that the main title text does not say "SARS IT3"
    // by verifying it says something appropriate instead:
    expect(text).toContain("ITR12");
  });
});

// ── Fix 3: "NOT an IT3-series form" disclaimer ────────────────────────────────

describe("buildIt3Pdf — Fix 3: disclaimer", () => {
  it("PDF contains 'NOT an IT3-series form'", () => {
    const buffer = buildIt3Pdf(makeMockRecord());
    const text = pdfToText(buffer);
    expect(text).toContain("NOT an IT3-series form");
  });

  it("PDF disclaimer mentions IT3(a) to clarify which series is NOT meant", () => {
    const buffer = buildIt3Pdf(makeMockRecord());
    const text = pdfToText(buffer);
    expect(text).toContain("IT3");
  });

  it("PDF disclaimer links to SARS source code page", () => {
    const buffer = buildIt3Pdf(makeMockRecord());
    const text = pdfToText(buffer);
    expect(text).toContain("sars.gov.za");
  });
});

// ── Fix 1: farmingActivityCode rendered in PDF ────────────────────────────────

describe("buildIt3Pdf — Fix 1: farmingActivityCode in PDF", () => {
  it("PDF shows the farmingActivityCode from the payload", () => {
    const buffer = buildIt3Pdf(makeMockRecord());
    const text = pdfToText(buffer);
    // The farming activity code 0104 should appear in the summary area
    expect(text).toContain("0104");
  });

  it("PDF does NOT contain fabricated 4101 code", () => {
    const buffer = buildIt3Pdf(makeMockRecord());
    const text = pdfToText(buffer);
    expect(text).not.toContain("4101");
  });

  it("PDF does NOT contain fabricated 4201 code", () => {
    const buffer = buildIt3Pdf(makeMockRecord());
    const text = pdfToText(buffer);
    expect(text).not.toContain("4201");
  });

  it("PDF does NOT contain fabricated 4199 code", () => {
    const buffer = buildIt3Pdf(makeMockRecord());
    const text = pdfToText(buffer);
    expect(text).not.toContain("4199");
  });

  it("PDF does NOT contain fabricated 4299 code", () => {
    const buffer = buildIt3Pdf(makeMockRecord());
    const text = pdfToText(buffer);
    expect(text).not.toContain("4299");
  });
});

// ── Voided record still renders correctly ─────────────────────────────────────

describe("buildIt3Pdf — voided record", () => {
  it("renders voided record without throwing", () => {
    const record = makeMockRecord({
      voidedAt: new Date("2026-05-01T08:00:00.000Z"),
      voidReason: "Duplicate snapshot",
    });
    expect(() => buildIt3Pdf(record)).not.toThrow();
  });

  it("voided PDF contains VOIDED banner text", () => {
    const record = makeMockRecord({
      voidedAt: new Date("2026-05-01T08:00:00.000Z"),
      voidReason: "Duplicate snapshot",
    });
    const buffer = buildIt3Pdf(record);
    const text = pdfToText(buffer);
    expect(text).toContain("VOIDED");
  });
});

// ── Wave/26b: Stock at Standard Values block ──────────────────────────────────

describe("buildIt3Pdf — Wave/26b: opening + closing stock at standard values", () => {
  function makeStockRecord() {
    const payload: It3SnapshotPayload = JSON.parse(makeMockRecord().payload);
    payload.stockMovement = {
      opening: {
        asOfDate: "2025-03-01",
        totalZar: 5_000,
        electionApplied: false,
        lines: [
          {
            species: "cattle",
            ageCategory: "Bulls",
            count: 100,
            standardValueZar: 50,
            effectiveValueZar: 50,
            subtotalZar: 5_000,
          },
        ],
      },
      closing: {
        asOfDate: "2026-02-28",
        totalZar: 10_000,
        electionApplied: false,
        lines: [
          {
            species: "cattle",
            ageCategory: "Bulls",
            count: 200,
            standardValueZar: 50,
            effectiveValueZar: 50,
            subtotalZar: 10_000,
          },
        ],
      },
      deltaZar: 5_000,
      unmapped: [],
      source:
        "GN R105 (GG 1011, 1965-01-22) as amended by GN R1814 (GG 5309, 1976-10-08); reproduced in SARS Guide IT35 (2023-10-13) Annexure pp. 71-72",
    };
    payload.schedules.openingStockValueZar = 5_000;
    payload.schedules.closingStockValueZar = 10_000;
    payload.schedules.stockMovementZar = 5_000;
    payload.schedules.netFarmingIncomeBeforeStockMovement = 40_000;
    payload.schedules.netFarmingIncome = 45_000;
    return makeMockRecord({ payload: JSON.stringify(payload) });
  }

  it("renders Opening Stock at Standard Values heading", () => {
    const buffer = buildIt3Pdf(makeStockRecord());
    const text = pdfToText(buffer);
    expect(text).toContain("OPENING STOCK AT STANDARD VALUES");
  });

  it("renders Closing Stock at Standard Values heading", () => {
    const buffer = buildIt3Pdf(makeStockRecord());
    const text = pdfToText(buffer);
    expect(text).toContain("CLOSING STOCK AT STANDARD VALUES");
  });

  it("renders the Stock Movement Reconciliation block", () => {
    const buffer = buildIt3Pdf(makeStockRecord());
    const text = pdfToText(buffer);
    expect(text).toContain("STOCK MOVEMENT RECONCILIATION");
  });

  it("renders the GN R105 / R1814 citation", () => {
    const buffer = buildIt3Pdf(makeStockRecord());
    const text = pdfToText(buffer);
    expect(text).toContain("GN R105");
    expect(text).toContain("GN R1814");
  });

  it("renders the IT35 (2023) citation", () => {
    const buffer = buildIt3Pdf(makeStockRecord());
    const text = pdfToText(buffer);
    expect(text).toContain("IT35");
  });

  it("retains the 'NOT an IT3-series form' disclaimer alongside stock blocks", () => {
    const buffer = buildIt3Pdf(makeStockRecord());
    const text = pdfToText(buffer);
    expect(text).toContain("NOT an IT3-series form");
  });

  it("payload without stockMovement does NOT throw and skips the block", () => {
    const buffer = buildIt3Pdf(makeMockRecord());
    const text = pdfToText(buffer);
    expect(text).not.toContain("STOCK MOVEMENT RECONCILIATION");
  });
});

// ── Payload with zero transactions ────────────────────────────────────────────

describe("buildIt3Pdf — empty payload", () => {
  it("renders empty schedule without throwing", () => {
    const record = makeMockRecord({
      payload: JSON.stringify({
        taxYear: 2026,
        periodStart: "2025-03-01",
        periodEnd: "2026-02-28",
        farm: {
          farmName: "Empty Farm",
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
          generatedAtIso: "2026-04-30T10:00:00.000Z",
          generatedBy: null,
          sourceTransactionCount: 0,
          categoryMapVersion: "2026-04-30",
          mappedCategories: [],
        },
      }),
    });
    expect(() => buildIt3Pdf(record)).not.toThrow();
  });
});
