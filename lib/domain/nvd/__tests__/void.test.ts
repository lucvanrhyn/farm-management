/**
 * @vitest-environment node
 *
 * Wave G1 (#165) — `voidNvdById` / `voidNvd` domain op tests.
 *
 * `voidNvdById` enforces existence + already-voided pre-conditions and
 * throws typed errors. The legacy `voidNvd(prisma, id, reason)` is kept
 * as the low-level mutation for callers that already know the record is
 * void-able (exporters, tests, admin scripts).
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { voidNvd, voidNvdById } from "@/lib/domain/nvd/void";
import {
  NvdAlreadyVoidedError,
  NvdNotFoundError,
} from "@/lib/domain/nvd/errors";

function makePrisma(
  findUniqueResult: unknown,
  updateImpl: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({}),
): PrismaClient {
  return {
    nvdRecord: {
      findUnique: vi.fn().mockResolvedValue(findUniqueResult),
      update: updateImpl,
    },
  } as unknown as PrismaClient;
}

describe("voidNvdById", () => {
  it("throws NvdNotFoundError (404) when record does not exist", async () => {
    const prisma = makePrisma(null);

    await expect(voidNvdById(prisma, "missing-id", "reason")).rejects.toBeInstanceOf(
      NvdNotFoundError,
    );
  });

  it("throws NvdAlreadyVoidedError (409) when voidedAt is set", async () => {
    const prisma = makePrisma({
      id: "nvd-1",
      voidedAt: new Date("2026-04-01"),
    });

    await expect(voidNvdById(prisma, "nvd-1", "reason")).rejects.toBeInstanceOf(
      NvdAlreadyVoidedError,
    );
  });

  it("returns { ok: true } and updates the row on success", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = makePrisma({ id: "nvd-1", voidedAt: null }, update);

    const result = await voidNvdById(prisma, "nvd-1", "Voided by admin");

    expect(result).toEqual({ ok: true });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({
      where: { id: "nvd-1" },
      data: { voidReason: "Voided by admin" },
    });
    // voidedAt should be a Date — exact instant doesn't matter
    expect(update.mock.calls[0][0].data.voidedAt).toBeInstanceOf(Date);
  });
});

describe("voidNvd (low-level)", () => {
  it("calls prisma.nvdRecord.update with voidedAt + voidReason", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      nvdRecord: { update },
    } as unknown as PrismaClient;

    await voidNvd(prisma, "nvd-1", "reason");

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({
      where: { id: "nvd-1" },
      data: { voidReason: "reason" },
    });
  });
});
