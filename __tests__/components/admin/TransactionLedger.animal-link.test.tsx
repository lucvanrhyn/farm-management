// @vitest-environment jsdom
/**
 * Finance-page animal link 404 (background-task chip 2026-06-13).
 *
 * The transaction ledger renders a link to the animal detail page for any
 * livestock-tagged transaction. The href was built as `/admin/animals/${id}`
 * — missing the `/[farmSlug]` segment every tenant route carries — so every
 * click 404'd. The detail route lives at
 * `app/[farmSlug]/admin/animals/[id]/page.tsx`, i.e. `/${slug}/admin/animals/${id}`.
 *
 * Asserted:
 *   1. With a farmSlug, the href is slug-prefixed (the bug fix).
 *   2. Without a farmSlug, it falls back to the legacy path (mirrors the
 *      component's existing `farmSlug ? … : …` API-URL idiom).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : ""} {...rest}>
      {children}
    </a>
  ),
}));

// Modal is only rendered on interaction; stub it so the import graph stays light.
vi.mock("@/components/admin/finansies/TransactionModal", () => ({ default: () => null }));

import TransactionLedger from "@/components/admin/finansies/TransactionLedger";

afterEach(cleanup);

const tx = {
  id: "tx1",
  type: "income",
  category: "Animal Sales",
  amount: 1000,
  date: "2026-01-01",
  description: "sale",
  animalId: "COW-007",
};

describe("TransactionLedger animal link", () => {
  it("prefixes the animal href with the farm slug", () => {
    render(
      <TransactionLedger
        transactions={[tx as never]}
        incomeCategories={[]}
        expenseCategories={[]}
        onChanged={() => {}}
        farmSlug="basson-boerdery"
      />,
    );
    const link = screen.getByRole("link", { name: "COW-007" });
    expect(link.getAttribute("href")).toBe("/basson-boerdery/admin/animals/COW-007");
  });

  it("falls back to the legacy path when no farm slug is supplied", () => {
    render(
      <TransactionLedger
        transactions={[tx as never]}
        incomeCategories={[]}
        expenseCategories={[]}
        onChanged={() => {}}
      />,
    );
    const link = screen.getByRole("link", { name: "COW-007" });
    expect(link.getAttribute("href")).toBe("/admin/animals/COW-007");
  });
});
