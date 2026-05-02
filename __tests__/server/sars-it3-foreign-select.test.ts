/**
 * __tests__/server/sars-it3-foreign-select.test.ts
 *
 * Regression test for the wave/26e silent-correctness gap, hardened to a
 * full end-to-end pin (Wave 4 A6 / Codex HIGH #6, 2026-05-02).
 *
 *   `getIt3Payload` builds the ITR12 farming snapshot from a Prisma
 *   `transaction.findMany({ select })`. The original wave/26e select
 *   omitted `isForeign`, so every transaction came back with
 *   `isForeign: undefined`, which `splitTransactionsByForeignness`
 *   correctly treats as domestic. Net effect: the foreign-income code
 *   0192/0193 feature was *functionally inert* — every transaction
 *   landed on the domestic schedule regardless of the persisted flag.
 *
 *   Internal calculator-level tests passed because they fed
 *   `TransactionLike[]` directly with `isForeign: true`. The original
 *   shape-lock test below caught the missing field on the Prisma select,
 *   but did not actually drive the orchestration end-to-end. Codex HIGH
 *   #6 (2026-05-02) flagged that gap as latent risk: a future refactor
 *   could keep `isForeign` in the select but still drop it on the path
 *   from select → snapshot → PDF.
 *
 *   We therefore add an end-to-end pin that calls `getIt3Payload` with a
 *   stub Prisma containing one foreign + one domestic transaction and
 *   asserts:
 *
 *     1. The Prisma client is asked for `isForeign` (shape lock — was here).
 *     2. The returned snapshot's `schedules.foreignFarmingIncome` block is
 *        non-null and carries SARS source code 0192 (profit) per the
 *        ITR12 register.
 *     3. The domestic schedules totals EXCLUDE the foreign transaction
 *        (Para 3 confirms domestic vs foreign reporting are parallel,
 *        not double-counted).
 *     4. `buildIt3Pdf` rendered against that snapshot includes the
 *        FOREIGN FARMING INCOME header + the SARS source code 0192 in
 *        the rendered byte stream, proving the PDF renderer consumes
 *        the field rather than dropping it on the floor.
 *
 *   See `feedback-regulatory-output-validate-against-spec.md` —
 *   internal-tests-pass ≠ external-spec-correct.
 */

import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { TRANSACTION_SELECT_FOR_IT3, getIt3Payload } from "@/lib/server/sars-it3";
import { buildIt3Pdf } from "@/lib/server/sars-it3-pdf";

// ── Shape lock (the original regression marker) ───────────────────────────────

describe("TRANSACTION_SELECT_FOR_IT3 — IT3 prisma select shape", () => {
  it("includes every field that downstream IT3 consumers read", () => {
    expect(TRANSACTION_SELECT_FOR_IT3).toEqual({
      type: true,
      category: true,
      amount: true,
      date: true,
      description: true,
      isForeign: true,
    });
  });

  it("includes isForeign — the wave/26e regression marker", () => {
    expect(TRANSACTION_SELECT_FOR_IT3.isForeign).toBe(true);
  });
});

// ── End-to-end: isForeign survives select → snapshot → PDF ────────────────────

interface StubTxRow {
  type: string;
  category: string;
  amount: number;
  date: string;
  description: string | null;
  isForeign: boolean;
}

function buildStubPrisma(transactions: StubTxRow[]): {
  prisma: PrismaClient;
  txFindManySpy: ReturnType<typeof vi.fn>;
} {
  const txFindManySpy = vi.fn(
    async (args: { select?: Record<string, true> }) => {
      // Honour the select shape so a regressed loader (e.g. that drops
      // `isForeign`) would surface as `isForeign: undefined` in this stub
      // — exactly the wave/26e silent-correctness gap.
      const select = args?.select ?? {};
      return transactions.map((row) => {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(select)) {
          out[key] = (row as unknown as Record<string, unknown>)[key];
        }
        return out;
      });
    },
  );

  const prisma = {
    transaction: { findMany: txFindManySpy },
    farmSettings: {
      findFirst: vi.fn(async () => ({
        farmName: "Cross-Border Test Farm",
        ownerName: "Test Owner",
        ownerIdNumber: "7001015009088",
        taxReferenceNumber: "1234567890",
        physicalAddress: "1 Border Rd",
        postalAddress: "",
        contactPhone: "0821234567",
        contactEmail: "test@farm.co.za",
        propertyRegNumber: "SG21-123",
        farmRegion: "Free State",
      })),
    },
    animal: {
      groupBy: vi.fn(async () => []),
      // For inventory-replay's full-tenant scan; empty herd keeps stock
      // movement neutral so it does not interfere with the foreign assertion.
      findMany: vi.fn(async () => []),
    },
    observation: {
      findMany: vi.fn(async () => []),
    },
    sarsLivestockElection: {
      findMany: vi.fn(async () => []),
    },
  } as unknown as PrismaClient;

  return { prisma, txFindManySpy };
}

describe("getIt3Payload — isForeign threads through to the snapshot", () => {
  const TAX_YEAR = 2026;

  it("requests isForeign in the Prisma select (shape lock at the call site)", async () => {
    const { prisma, txFindManySpy } = buildStubPrisma([]);
    await getIt3Payload(prisma, TAX_YEAR, "test-user");
    const callArgs = txFindManySpy.mock.calls[0][0];
    expect(callArgs.select).toMatchObject({ isForeign: true });
  });

  it("emits a foreignFarmingIncome block when an isForeign=true transaction exists", async () => {
    // Tax year 2026 = SA window 2025-03-01 .. 2026-02-28.
    const { prisma } = buildStubPrisma([
      // Domestic income — must roll into the main schedule, not foreign.
      {
        type: "income",
        category: "Animal Sales",
        amount: 10000,
        date: "2025-06-15",
        description: "Domestic auction",
        isForeign: false,
      },
      // Foreign-derived income — must roll into the parallel SARS 0192/0193
      // reporting block per the ITR12 source-code register.
      {
        type: "income",
        category: "Animal Sales",
        amount: 4000,
        date: "2025-09-20",
        description: "Lesotho cross-border sale",
        isForeign: true,
      },
    ]);

    const payload = await getIt3Payload(prisma, TAX_YEAR, "test-user");

    // Foreign block must materialise with the literal SARS source code
    // 0192 (profit) per the ITR12 "Find a Source Code" register.
    expect(payload.schedules.foreignFarmingIncome).not.toBeNull();
    expect(payload.schedules.foreignFarmingIncome!.activityCode).toBe("0192");
    expect(payload.schedules.foreignFarmingIncome!.totalIncome).toBe(4000);
    expect(payload.schedules.foreignFarmingIncome!.net).toBe(4000);

    // Domestic schedule must NOT double-count the foreign R4000.
    expect(payload.schedules.totalIncome).toBe(10000);
  });

  it("does not emit a foreign block when every transaction is domestic", async () => {
    const { prisma } = buildStubPrisma([
      {
        type: "income",
        category: "Animal Sales",
        amount: 10000,
        date: "2025-06-15",
        description: "Domestic only",
        isForeign: false,
      },
    ]);
    const payload = await getIt3Payload(prisma, TAX_YEAR, "test-user");
    // foreignFarmingIncome may be absent or null — both mean "no foreign tx".
    expect(payload.schedules.foreignFarmingIncome ?? null).toBeNull();
    expect(payload.schedules.totalIncome).toBe(10000);
  });

  it("buildIt3Pdf rendered from the snapshot contains the SARS 0192 source code", async () => {
    // PDF-renderer regression-lock: prove the foreignFarmingIncome block
    // does not get silently dropped on the snapshot → PDF hop. This pins
    // the rendering layer to the same Para 3 / source-code register
    // contract as the calculator.
    const { prisma } = buildStubPrisma([
      {
        type: "income",
        category: "Animal Sales",
        amount: 4000,
        date: "2025-09-20",
        description: "Lesotho cross-border sale",
        isForeign: true,
      },
    ]);
    const payload = await getIt3Payload(prisma, TAX_YEAR, "test-user");

    const buffer = buildIt3Pdf({
      taxYear: TAX_YEAR,
      issuedAt: new Date("2026-04-30T10:00:00.000Z"),
      payload: JSON.stringify(payload),
      generatedBy: "test-user",
      pdfHash: null,
      voidedAt: null,
      voidReason: null,
    });

    const bytes = new Uint8Array(buffer);
    let pdfText = "";
    for (let i = 0; i < bytes.length; i += 1) {
      pdfText += String.fromCharCode(bytes[i]);
    }
    expect(pdfText).toContain("FOREIGN FARMING INCOME");
    // The SARS source code is rendered into the heading text — pin both.
    expect(pdfText).toContain("0192");
  });
});
