/**
 * @vitest-environment node
 *
 * Wave G1 (#165) — `issueNvd` domain op tests.
 *
 * Pins:
 *   1. Throws `InvalidAnimalIdsError` when the validation step finds a
 *      blocker (was a bare Error pre-G1; new wire shape: 400
 *      INVALID_ANIMAL_IDS).
 *   2. Builds seller + animal snapshots and persists with the next
 *      sequential nvdNumber.
 *   3. Forwards optional `transport` payload onto the NvdRecord row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

const hoisted = vi.hoisted(() => ({
  getAnimalsInWithdrawal: vi.fn(),
}));

vi.mock("@/lib/server/treatment-analytics", () => ({
  getAnimalsInWithdrawal: hoisted.getAnimalsInWithdrawal,
}));

import { issueNvd } from "@/lib/domain/nvd/issue";
import { InvalidAnimalIdsError } from "@/lib/domain/nvd/errors";

beforeEach(() => {
  hoisted.getAnimalsInWithdrawal.mockReset();
  hoisted.getAnimalsInWithdrawal.mockResolvedValue([]);
});

function makePrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  const created = { id: "nvd-1", nvdNumber: "NVD-2026-0001" };
  return {
    nvdRecord: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(created),
    },
    animal: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    observation: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    farmSettings: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => unknown) => {
        // Tx client proxies straight through to the same `nvdRecord`
        // surface. Tests assert against the non-tx mock to keep things
        // simple — production behaviour holds because the mock object
        // inherits the create() spy.
        const tx = (overrides.__txClient ?? overrides.nvdRecord
          ? overrides
          : { nvdRecord: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(created) } }) as unknown;
        return fn(tx);
      }),
    ...overrides,
  } as unknown as PrismaClient;
}

describe("issueNvd", () => {
  it("throws InvalidAnimalIdsError when validation reports a blocker", async () => {
    hoisted.getAnimalsInWithdrawal.mockResolvedValueOnce([
      {
        animalId: "A002",
        name: "Bessie",
        campId: "C1",
        treatmentType: "Antibiotic",
        treatedAt: new Date(),
        withdrawalDays: 14,
        withdrawalEndsAt: new Date(),
        daysRemaining: 4,
      },
    ]);

    const prisma = makePrisma();

    await expect(
      issueNvd(prisma, {
        saleDate: "2026-05-01",
        buyerName: "Buyer",
        animalIds: ["A001", "A002"],
        declarationsJson: "{}",
      }),
    ).rejects.toBeInstanceOf(InvalidAnimalIdsError);
  });

  it("returns the created record's id + nvdNumber on success", async () => {
    const txCreate = vi
      .fn()
      .mockResolvedValue({ id: "nvd-42", nvdNumber: "NVD-2026-0099" });
    const txClient = {
      nvdRecord: {
        findFirst: vi.fn().mockResolvedValue({ nvdNumber: "NVD-2026-0098" }),
        create: txCreate,
      },
    };
    const prisma = {
      nvdRecord: { findFirst: vi.fn(), create: vi.fn() },
      animal: { findMany: vi.fn().mockResolvedValue([]) },
      observation: { findMany: vi.fn().mockResolvedValue([]) },
      farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi
        .fn()
        .mockImplementation(async (fn: (tx: unknown) => unknown) => fn(txClient)),
    } as unknown as PrismaClient;

    const result = await issueNvd(prisma, {
      saleDate: "2026-05-01",
      buyerName: "Buyer",
      animalIds: ["A001"],
      declarationsJson: "{}",
    });

    expect(result).toEqual({ id: "nvd-42", nvdNumber: "NVD-2026-0099" });
    expect(txCreate).toHaveBeenCalledTimes(1);
  });

  it("forwards the transport payload onto the persisted row when provided", async () => {
    const txCreate = vi
      .fn()
      .mockResolvedValue({ id: "nvd-1", nvdNumber: "NVD-2026-0001" });
    const txClient = {
      nvdRecord: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: txCreate,
      },
    };
    const prisma = {
      animal: { findMany: vi.fn().mockResolvedValue([]) },
      observation: { findMany: vi.fn().mockResolvedValue([]) },
      farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi
        .fn()
        .mockImplementation(async (fn: (tx: unknown) => unknown) => fn(txClient)),
    } as unknown as PrismaClient;

    await issueNvd(prisma, {
      saleDate: "2026-05-01",
      buyerName: "Buyer",
      animalIds: ["A001"],
      declarationsJson: "{}",
      transport: { driverName: "P", vehicleRegNumber: "CA 1" },
    });

    expect(txCreate).toHaveBeenCalledTimes(1);
    const data = txCreate.mock.calls[0][0].data;
    expect(data.transportJson).toBe(
      JSON.stringify({ driverName: "P", vehicleRegNumber: "CA 1" }),
    );
  });

  it("persists transportJson as null when transport is omitted", async () => {
    const txCreate = vi
      .fn()
      .mockResolvedValue({ id: "nvd-1", nvdNumber: "NVD-2026-0001" });
    const txClient = {
      nvdRecord: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: txCreate,
      },
    };
    const prisma = {
      animal: { findMany: vi.fn().mockResolvedValue([]) },
      observation: { findMany: vi.fn().mockResolvedValue([]) },
      farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi
        .fn()
        .mockImplementation(async (fn: (tx: unknown) => unknown) => fn(txClient)),
    } as unknown as PrismaClient;

    await issueNvd(prisma, {
      saleDate: "2026-05-01",
      buyerName: "Buyer",
      animalIds: ["A001"],
      declarationsJson: "{}",
    });

    expect(txCreate.mock.calls[0][0].data.transportJson).toBeNull();
  });
});
