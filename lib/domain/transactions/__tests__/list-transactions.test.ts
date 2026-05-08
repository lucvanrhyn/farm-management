/**
 * @vitest-environment node
 *
 * Wave D (#159) — domain op: `listTransactions`.
 *
 * Pure function on `(prisma, filters)` that returns transaction rows
 * ordered by `date desc`. Filters (`type`, `category`, `from`, `to`)
 * translate to a Prisma `where` clause. The `from` / `to` filters carry
 * a YYYY-MM-DD regex precondition (legacy 400 "from must be YYYY-MM-DD"
 * migrated to a typed `InvalidDateFormatError`).
 *
 * Wire shape stays the raw Prisma `Transaction` row — preserved verbatim
 * so the admin /finansies UI and offline-sync queue remain compatible.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { listTransactions } from "../list-transactions";
import { InvalidDateFormatError } from "../errors";

describe("listTransactions(prisma, filters)", () => {
  const findMany = vi.fn();
  const prisma = {
    transaction: { findMany },
  } as unknown as PrismaClient;

  beforeEach(() => {
    findMany.mockReset();
  });

  it("returns transactions ordered by date desc with no filters", async () => {
    findMany.mockResolvedValue([{ id: "tx-1" }]);

    const result = await listTransactions(prisma, {});

    expect(result).toEqual([{ id: "tx-1" }]);
    expect(findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { date: "desc" },
    });
  });

  it("translates type + category filters to a Prisma where clause", async () => {
    findMany.mockResolvedValue([]);

    await listTransactions(prisma, {
      type: "income",
      category: "Animal Sales",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: { type: "income", category: "Animal Sales" },
      orderBy: { date: "desc" },
    });
  });

  it("translates from/to to a date range gte/lte clause", async () => {
    findMany.mockResolvedValue([]);

    await listTransactions(prisma, {
      from: "2026-01-01",
      to: "2026-12-31",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: { date: { gte: "2026-01-01", lte: "2026-12-31" } },
      orderBy: { date: "desc" },
    });
  });

  it("translates from-only into a gte-only clause", async () => {
    findMany.mockResolvedValue([]);

    await listTransactions(prisma, { from: "2026-03-01" });

    expect(findMany).toHaveBeenCalledWith({
      where: { date: { gte: "2026-03-01" } },
      orderBy: { date: "desc" },
    });
  });

  it("translates to-only into an lte-only clause", async () => {
    findMany.mockResolvedValue([]);

    await listTransactions(prisma, { to: "2026-09-30" });

    expect(findMany).toHaveBeenCalledWith({
      where: { date: { lte: "2026-09-30" } },
      orderBy: { date: "desc" },
    });
  });

  it("throws InvalidDateFormatError when from is not YYYY-MM-DD", async () => {
    await expect(
      listTransactions(prisma, { from: "01-01-2026" }),
    ).rejects.toBeInstanceOf(InvalidDateFormatError);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("throws InvalidDateFormatError when to is not YYYY-MM-DD", async () => {
    await expect(
      listTransactions(prisma, { to: "2026/12/31" }),
    ).rejects.toBeInstanceOf(InvalidDateFormatError);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("preserves the offending field on the InvalidDateFormatError", async () => {
    try {
      await listTransactions(prisma, { from: "bad" });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidDateFormatError);
      expect((err as InvalidDateFormatError).field).toBe("from");
    }

    try {
      await listTransactions(prisma, { to: "also-bad" });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidDateFormatError);
      expect((err as InvalidDateFormatError).field).toBe("to");
    }
  });

  it("ignores null/undefined filters (empty where, no date range)", async () => {
    findMany.mockResolvedValue([]);

    await listTransactions(prisma, {
      type: null,
      category: undefined,
      from: null,
      to: undefined,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { date: "desc" },
    });
  });
});
