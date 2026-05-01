/**
 * __tests__/server/sars-it3-foreign-select.test.ts
 *
 * Regression test for the wave/26e silent-correctness gap:
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
 *   `TransactionLike[]` directly with `isForeign: true`. The gap was
 *   only the orchestration's Prisma select shape. We lock that shape
 *   here so a future refactor cannot drop a field silently.
 *
 *   See `feedback-regulatory-output-validate-against-spec.md` —
 *   internal-tests-pass ≠ external-spec-correct.
 */

import { describe, it, expect } from "vitest";
import { TRANSACTION_SELECT_FOR_IT3 } from "@/lib/server/sars-it3";

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
