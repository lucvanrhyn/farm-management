/**
 * __tests__/server/sars-it3-elections.test.ts
 *
 * Locks the contract of `loadElectionsForYear` — the IT3 payload-builder's
 * door into the `SarsLivestockElection` table.
 *
 * Two reasons this test exists:
 *
 * (1) Para-7 lock-in mechanism. The SARS First Schedule paragraph 7 says an
 *     adopted alternative standard value is "binding in respect of all
 *     subsequent returns rendered by the farmer". The operational way that
 *     binding shows up in the calculator is: `loadElectionsForYear(taxYear)`
 *     must return any election whose `electedYear <= taxYear`, with the
 *     newest election per (species, ageCategory) winning. That latest-wins
 *     dedup is the lock-in path. If a future refactor changes the dedup
 *     order or the year filter, the binding breaks silently.
 *
 * (2) Migration 0005 -> 0010 rename + native Prisma model. Before this PR
 *     the function read from `(prisma as any).sarsLivestockElection`. Now
 *     that the Prisma client has the model typed natively, the cast is
 *     gone and any future drift between the schema and the loader will
 *     fail TypeScript at build, not at runtime.
 *
 * The tests use a hand-rolled Prisma stub keyed only on the methods this
 * function calls. We deliberately don't drag in the real Prisma client —
 * `loadElectionsForYear` is an integration-shaped helper that is happiest
 * tested with a fake.
 */

import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { loadElectionsForYear } from "@/lib/server/sars-it3";

// ── Stub builder ──────────────────────────────────────────────────────────────

interface ElectionRow {
  species: string;
  ageCategory: string;
  electedValueZar: number;
  electedYear: number;
  sarsChangeApprovalRef: string | null;
}

function stubPrisma(rows: ElectionRow[]): PrismaClient {
  // Honour the where + orderBy contract that loadElectionsForYear uses so the
  // dedup logic exercises the right inputs.
  const findMany = vi.fn(async (args: {
    where?: { electedYear?: { lte?: number } };
    orderBy?: { electedYear: "asc" | "desc" };
  }) => {
    const lte = args.where?.electedYear?.lte ?? Number.POSITIVE_INFINITY;
    let filtered = rows.filter((r) => r.electedYear <= lte);
    if (args.orderBy?.electedYear === "desc") {
      filtered = [...filtered].sort((a, b) => b.electedYear - a.electedYear);
    } else if (args.orderBy?.electedYear === "asc") {
      filtered = [...filtered].sort((a, b) => a.electedYear - b.electedYear);
    }
    return filtered;
  });
  return { sarsLivestockElection: { findMany } } as unknown as PrismaClient;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("loadElectionsForYear — basic contract", () => {
  it("returns an empty array when no elections exist", async () => {
    const prisma = stubPrisma([]);
    const elections = await loadElectionsForYear(prisma, 2026);
    expect(elections).toEqual([]);
  });

  it("returns elections with electedYear <= taxYear", async () => {
    const prisma = stubPrisma([
      {
        species: "cattle",
        ageCategory: "Bulls",
        electedValueZar: 55,
        electedYear: 2024,
        sarsChangeApprovalRef: null,
      },
    ]);
    const elections = await loadElectionsForYear(prisma, 2026);
    expect(elections).toHaveLength(1);
    expect(elections[0]).toEqual({
      species: "cattle",
      ageCategory: "Bulls",
      electedValueZar: 55,
      electedYear: 2024,
      sarsChangeApprovalRef: null,
    });
  });

  it("excludes elections with electedYear > taxYear", async () => {
    // Future election (e.g. user pre-staged the 2027 election) must not
    // bleed into the 2026 IT3 — that would be picking the wrong year's value.
    const prisma = stubPrisma([
      {
        species: "cattle",
        ageCategory: "Bulls",
        electedValueZar: 55,
        electedYear: 2027,
        sarsChangeApprovalRef: null,
      },
    ]);
    const elections = await loadElectionsForYear(prisma, 2026);
    expect(elections).toEqual([]);
  });
});

describe("loadElectionsForYear — Para 7 latest-wins dedup", () => {
  it("collapses multiple elections per (species, ageCategory) to the newest", async () => {
    // SARS-approved re-election supersedes the old one for any tax year >=
    // newElectedYear. This IS the paragraph 7 lock-in mechanism in action.
    const prisma = stubPrisma([
      {
        species: "cattle",
        ageCategory: "Bulls",
        electedValueZar: 50,
        electedYear: 2020,
        sarsChangeApprovalRef: null,
      },
      {
        species: "cattle",
        ageCategory: "Bulls",
        electedValueZar: 55,
        electedYear: 2025,
        sarsChangeApprovalRef: "SARS-APPROVAL-2025",
      },
    ]);
    const elections = await loadElectionsForYear(prisma, 2026);
    expect(elections).toHaveLength(1);
    expect(elections[0].electedYear).toBe(2025);
    expect(elections[0].electedValueZar).toBe(55);
    expect(elections[0].sarsChangeApprovalRef).toBe("SARS-APPROVAL-2025");
  });

  it("returns the OLD election when the tax year is before the new election", async () => {
    // Querying tax year 2022 must NOT see the 2025 re-election yet.
    // Confirms that latest-wins respects the year filter.
    const prisma = stubPrisma([
      {
        species: "cattle",
        ageCategory: "Bulls",
        electedValueZar: 50,
        electedYear: 2020,
        sarsChangeApprovalRef: null,
      },
      {
        species: "cattle",
        ageCategory: "Bulls",
        electedValueZar: 55,
        electedYear: 2025,
        sarsChangeApprovalRef: "SARS-APPROVAL-2025",
      },
    ]);
    const elections = await loadElectionsForYear(prisma, 2022);
    expect(elections).toHaveLength(1);
    expect(elections[0].electedYear).toBe(2020);
    expect(elections[0].electedValueZar).toBe(50);
  });

  it("keeps independent (species, ageCategory) classes separate", async () => {
    const prisma = stubPrisma([
      {
        species: "cattle",
        ageCategory: "Bulls",
        electedValueZar: 55,
        electedYear: 2020,
        sarsChangeApprovalRef: null,
      },
      {
        species: "sheep",
        ageCategory: "Ewes",
        electedValueZar: 7,
        electedYear: 2021,
        sarsChangeApprovalRef: null,
      },
    ]);
    const elections = await loadElectionsForYear(prisma, 2026);
    expect(elections).toHaveLength(2);
    const byKey = Object.fromEntries(
      elections.map((e) => [`${e.species}/${e.ageCategory}`, e.electedValueZar]),
    );
    expect(byKey["cattle/Bulls"]).toBe(55);
    expect(byKey["sheep/Ewes"]).toBe(7);
  });
});

describe("loadElectionsForYear — graceful degradation", () => {
  it("returns [] when the underlying query throws (e.g. migration not yet applied)", async () => {
    // Older tenants that haven't migrated 0005/0010 yet would surface as a
    // model-missing or table-missing runtime error. The loader catches that
    // and returns []. Standard values then apply by default — the SARS-correct
    // behaviour absent any election.
    const prisma = {
      sarsLivestockElection: {
        findMany: vi.fn(async () => {
          throw new Error("no such table: SarsLivestockElection");
        }),
      },
    } as unknown as PrismaClient;
    const elections = await loadElectionsForYear(prisma, 2026);
    expect(elections).toEqual([]);
  });
});

// ── Para 7 lock-in — defence against an unapproved later election ─────────────
//
// Wave 4 A6 / Codex HIGH #7 (2026-05-02): the prior latest-wins implementation
// silently adopted any later-year election even when its `sarsChangeApprovalRef`
// was null. Per the SARS First Schedule paragraph 7 ("Once an option is
// exercised, it shall be binding in respect of all subsequent returns rendered
// by the farmer and may not be varied without the consent of the Commissioner"
// — verbatim per IT35 (2023-10-13) Annexure pp. 71-72), an unapproved later
// election is not a valid re-election: the original lock-in must remain
// binding.
//
// The data layer's `@@unique([species, ageCategory, electedYear])` blocks
// duplicate rows for the SAME year, but does NOT prevent a careless operator
// inserting a different value in a LATER year without setting the SARS
// approval ref (no insert API exists today; the management page is read-only,
// per app/[farmSlug]/admin/tax/elections/page.tsx). The loader is therefore
// the last line of defence — and that is what these tests pin.
//
// See `feedback-regulatory-output-validate-against-spec.md`: internal-tests-
// pass ≠ external-spec-correct. Each test below cites the rule it enforces.

describe("loadElectionsForYear — Para 7 lock-in defence", () => {
  it("keeps the EARLIER election when the later one has no sarsChangeApprovalRef", async () => {
    // Two elections, both with `sarsChangeApprovalRef: null`. Per Para 7 the
    // 2020 lock-in is binding — the unapproved 2025 row is invalid as a
    // re-election. Loader must hold the line and return the 2020 value.
    const prisma = stubPrisma([
      {
        species: "cattle",
        ageCategory: "Bulls",
        electedValueZar: 55,
        electedYear: 2020,
        sarsChangeApprovalRef: null,
      },
      {
        species: "cattle",
        ageCategory: "Bulls",
        electedValueZar: 45,
        electedYear: 2025,
        sarsChangeApprovalRef: null,
      },
    ]);
    const elections = await loadElectionsForYear(prisma, 2026);
    expect(elections).toHaveLength(1);
    expect(elections[0].electedYear).toBe(2020);
    expect(elections[0].electedValueZar).toBe(55);
    expect(elections[0].sarsChangeApprovalRef).toBeNull();
  });

  it("adopts the LATER election when it carries a sarsChangeApprovalRef (re-election)", async () => {
    // Para 7's escape hatch: "may not be varied without the consent of the
    // Commissioner". A later row WITH `sarsChangeApprovalRef` is a sanctioned
    // re-election and must override the earlier value.
    const prisma = stubPrisma([
      {
        species: "cattle",
        ageCategory: "Bulls",
        electedValueZar: 55,
        electedYear: 2020,
        sarsChangeApprovalRef: null,
      },
      {
        species: "cattle",
        ageCategory: "Bulls",
        electedValueZar: 45,
        electedYear: 2025,
        sarsChangeApprovalRef: "SARS-APPROVAL-XYZ-2025",
      },
    ]);
    const elections = await loadElectionsForYear(prisma, 2026);
    expect(elections).toHaveLength(1);
    expect(elections[0].electedYear).toBe(2025);
    expect(elections[0].electedValueZar).toBe(45);
    expect(elections[0].sarsChangeApprovalRef).toBe("SARS-APPROVAL-XYZ-2025");
  });

  it("treats an empty-string sarsChangeApprovalRef as no approval (defensive)", async () => {
    // Approval references are SARS-issued strings; an empty string is a
    // data-entry artifact, not consent. Treat as missing-approval so we
    // do not let a single space or empty sentinel value bypass Para 7.
    const prisma = stubPrisma([
      {
        species: "cattle",
        ageCategory: "Bulls",
        electedValueZar: 55,
        electedYear: 2020,
        sarsChangeApprovalRef: null,
      },
      {
        species: "cattle",
        ageCategory: "Bulls",
        electedValueZar: 45,
        electedYear: 2025,
        sarsChangeApprovalRef: "",
      },
    ]);
    const elections = await loadElectionsForYear(prisma, 2026);
    expect(elections).toHaveLength(1);
    expect(elections[0].electedYear).toBe(2020);
    expect(elections[0].electedValueZar).toBe(55);
  });

  it("collapses chained re-elections to the latest SARS-approved one", async () => {
    // 2020 (initial, unapproved by definition — a first election needs no
    // approval), 2023 (approved re-election), 2026 (approved re-election).
    // Latest SARS-approved row wins: R45 from 2026.
    const prisma = stubPrisma([
      {
        species: "sheep",
        ageCategory: "Ewes",
        electedValueZar: 7,
        electedYear: 2020,
        sarsChangeApprovalRef: null,
      },
      {
        species: "sheep",
        ageCategory: "Ewes",
        electedValueZar: 5,
        electedYear: 2023,
        sarsChangeApprovalRef: "SARS-APPROVAL-2023",
      },
      {
        species: "sheep",
        ageCategory: "Ewes",
        electedValueZar: 6,
        electedYear: 2026,
        sarsChangeApprovalRef: "SARS-APPROVAL-2026",
      },
    ]);
    const elections = await loadElectionsForYear(prisma, 2026);
    expect(elections).toHaveLength(1);
    expect(elections[0].electedYear).toBe(2026);
    expect(elections[0].electedValueZar).toBe(6);
  });

  it("ignores an unapproved later row even when the previous winner was approved", async () => {
    // Worst-case audit scenario: SARS approved a 2023 re-election to R5; in
    // 2025 a careless operator inserted R8 with no approval ref. The 2023
    // approved row remains binding under Para 7.
    const prisma = stubPrisma([
      {
        species: "sheep",
        ageCategory: "Ewes",
        electedValueZar: 7,
        electedYear: 2020,
        sarsChangeApprovalRef: null,
      },
      {
        species: "sheep",
        ageCategory: "Ewes",
        electedValueZar: 5,
        electedYear: 2023,
        sarsChangeApprovalRef: "SARS-APPROVAL-2023",
      },
      {
        species: "sheep",
        ageCategory: "Ewes",
        electedValueZar: 8,
        electedYear: 2025,
        sarsChangeApprovalRef: null,
      },
    ]);
    const elections = await loadElectionsForYear(prisma, 2026);
    expect(elections).toHaveLength(1);
    expect(elections[0].electedYear).toBe(2023);
    expect(elections[0].electedValueZar).toBe(5);
    expect(elections[0].sarsChangeApprovalRef).toBe("SARS-APPROVAL-2023");
  });

  it("each (species, ageCategory) class enforces its own lock-in independently", async () => {
    // Bulls had a 2020 lock-in and a 2025 unapproved re-election (must keep 2020).
    // Ewes had only a single 2021 election (must use it as-is).
    const prisma = stubPrisma([
      {
        species: "cattle",
        ageCategory: "Bulls",
        electedValueZar: 55,
        electedYear: 2020,
        sarsChangeApprovalRef: null,
      },
      {
        species: "cattle",
        ageCategory: "Bulls",
        electedValueZar: 45,
        electedYear: 2025,
        sarsChangeApprovalRef: null,
      },
      {
        species: "sheep",
        ageCategory: "Ewes",
        electedValueZar: 7,
        electedYear: 2021,
        sarsChangeApprovalRef: null,
      },
    ]);
    const elections = await loadElectionsForYear(prisma, 2026);
    expect(elections).toHaveLength(2);
    const byKey = Object.fromEntries(
      elections.map((e) => [
        `${e.species}/${e.ageCategory}`,
        { value: e.electedValueZar, year: e.electedYear },
      ]),
    );
    expect(byKey["cattle/Bulls"]).toEqual({ value: 55, year: 2020 });
    expect(byKey["sheep/Ewes"]).toEqual({ value: 7, year: 2021 });
  });
});
