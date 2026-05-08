/**
 * @vitest-environment node
 *
 * Wave G1 (#165) — `getNvdById` / `getNvdByIdOrThrow` / `listNvds`
 * domain op tests.
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  getNvdById,
  getNvdByIdOrThrow,
  listNvds,
} from "@/lib/domain/nvd/get";
import { NvdNotFoundError } from "@/lib/domain/nvd/errors";

describe("getNvdById", () => {
  it("returns the row when present", async () => {
    const prisma = {
      nvdRecord: { findUnique: vi.fn().mockResolvedValue({ id: "nvd-1" }) },
    } as unknown as PrismaClient;

    const result = await getNvdById(prisma, "nvd-1");

    expect(result).toEqual({ id: "nvd-1" });
  });

  it("returns null when missing", async () => {
    const prisma = {
      nvdRecord: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;

    expect(await getNvdById(prisma, "missing")).toBeNull();
  });
});

describe("getNvdByIdOrThrow", () => {
  it("throws NvdNotFoundError when row is missing", async () => {
    const prisma = {
      nvdRecord: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;

    await expect(getNvdByIdOrThrow(prisma, "missing")).rejects.toBeInstanceOf(
      NvdNotFoundError,
    );
  });

  it("returns the row when present", async () => {
    const prisma = {
      nvdRecord: { findUnique: vi.fn().mockResolvedValue({ id: "nvd-1" }) },
    } as unknown as PrismaClient;

    expect(await getNvdByIdOrThrow(prisma, "nvd-1")).toEqual({ id: "nvd-1" });
  });
});

describe("listNvds", () => {
  it("clamps page to >= 1 and uses limit 20", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = {
      nvdRecord: { findMany, count },
    } as unknown as PrismaClient;

    const result = await listNvds(prisma, { page: -5 });

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      skip: 0,
      take: 20,
    });
  });

  it("computes headCount from animalIds JSON without parsing snapshot", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "nvd-1",
        nvdNumber: "NVD-2026-0001",
        issuedAt: new Date(),
        saleDate: "2026-05-01",
        buyerName: "Buyer",
        animalIds: JSON.stringify(["A1", "A2", "A3"]),
        generatedBy: null,
        voidedAt: null,
        voidReason: null,
        transactionId: null,
      },
    ]);
    const count = vi.fn().mockResolvedValue(1);
    const prisma = {
      nvdRecord: { findMany, count },
    } as unknown as PrismaClient;

    const result = await listNvds(prisma);

    expect(result.records[0].headCount).toBe(3);
    expect(result.total).toBe(1);
  });

  it("falls back to headCount=0 when animalIds JSON is malformed", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "nvd-1",
        nvdNumber: "NVD-2026-0001",
        issuedAt: new Date(),
        saleDate: "2026-05-01",
        buyerName: "Buyer",
        animalIds: "not-json{",
        generatedBy: null,
        voidedAt: null,
        voidReason: null,
        transactionId: null,
      },
    ]);
    const count = vi.fn().mockResolvedValue(1);
    const prisma = {
      nvdRecord: { findMany, count },
    } as unknown as PrismaClient;

    const result = await listNvds(prisma);

    expect(result.records[0].headCount).toBe(0);
  });

  it("applies skip/take from page argument", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = {
      nvdRecord: { findMany, count },
    } as unknown as PrismaClient;

    await listNvds(prisma, { page: 3 });

    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 40, take: 20 });
  });
});
