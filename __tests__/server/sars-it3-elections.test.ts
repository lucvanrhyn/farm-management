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
