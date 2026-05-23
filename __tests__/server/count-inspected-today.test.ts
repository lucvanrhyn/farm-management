/**
 * __tests__/server/count-inspected-today.test.ts
 *
 * Issue #363 — "Inspections Today" dashboard tile undercounts.
 *
 * Root cause: countInspectedToday() opened the cross-species door
 * (crossSpecies(prisma, "analytics-rollup")) but then injected a
 * `...(mode ? { species: mode } : {})` predicate. Camp inspections are
 * NULL-species `camp_condition` observation rows — they are not a
 * per-species concept. The conditional predicate dropped every NULL-species
 * row whenever a FarmMode was active, so Basson saw "0/9 Inspections Today"
 * while the camp-inspection quick-win on the same screen said "100%".
 *
 * Regression lock: countInspectedToday MUST count NULL-species
 * `camp_condition` rows and MUST NOT inject a `species` predicate — its
 * result is mode-independent.
 */
import { describe, it, expect, vi } from "vitest";
import { countInspectedToday } from "@/lib/server/camp-status";
import type { PrismaClient } from "@prisma/client";

/**
 * Build a fake PrismaClient whose observation.findMany records the `where`
 * clause it was called with and returns the supplied rows. crossSpecies()
 * forwards observation.findMany(args) verbatim to this client, so the
 * recorded `where` is exactly what countInspectedToday built.
 */
function fakePrisma(rows: Array<{ campId: string }>) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const prisma = {
    observation: { findMany },
  } as unknown as PrismaClient;
  return { prisma, findMany };
}

describe("countInspectedToday — issue #363 (no species predicate)", () => {
  it("never injects a `species` predicate into the where clause", async () => {
    const { prisma, findMany } = fakePrisma([]);

    await countInspectedToday(prisma);

    const where = findMany.mock.calls.at(-1)?.[0]?.where as
      | Record<string, unknown>
      | undefined;
    expect(where).toBeDefined();
    // NULL-species camp_condition rows must never be filtered out.
    expect(where).not.toHaveProperty("species");
  });

  it("counts distinct camps from NULL-species camp_condition rows", async () => {
    // Three rows across two camps — the result is the distinct-camp count.
    const { prisma } = fakePrisma([
      { campId: "camp-a" },
      { campId: "camp-a" },
      { campId: "camp-b" },
    ]);

    const count = await countInspectedToday(prisma);

    expect(count).toBe(2);
  });

  it("returns identical results regardless of any extra positional argument (issue #363)", async () => {
    // The DB layer (crossSpecies forwarder) decides which rows come back.
    // We simulate a tenant whose `camp_condition` rows are NULL-species
    // (which they always are): if countInspectedToday injects a `species`
    // predicate, the underlying findMany filters them all out and the tile
    // reads 0. This fake returns rows ONLY when no `species` predicate is
    // present — mirroring the real DB's behaviour.
    const allRows = [{ campId: "camp-a" }, { campId: "camp-b" }];
    const makeFake = () => {
      const findMany = vi.fn(
        async (args: { where?: { species?: unknown } }) =>
          args.where && "species" in args.where ? [] : allRows,
      );
      return { observation: { findMany } } as unknown as PrismaClient;
    };

    // Bare call and a call with a stray second positional arg (the old
    // `mode` slot, now `tz`) must agree. Pre-fix, passing "sheep" injected
    // `{ species: "sheep" }` and dropped every NULL-species row → 0.
    const bare = await countInspectedToday(makeFake());
    const withArg = await countInspectedToday(
      makeFake(),
      "Africa/Johannesburg",
    );

    expect(bare).toBe(2);
    expect(withArg).toBe(2);
  });

  it("queries camp_condition / camp_check observation types for today", async () => {
    const { prisma, findMany } = fakePrisma([]);

    await countInspectedToday(prisma);

    const where = findMany.mock.calls.at(-1)?.[0]?.where as {
      type?: { in?: string[] };
      observedAt?: { gte?: Date };
    };
    expect(where.type?.in).toEqual(["camp_condition", "camp_check"]);
    expect(where.observedAt?.gte).toBeInstanceOf(Date);
  });
});
