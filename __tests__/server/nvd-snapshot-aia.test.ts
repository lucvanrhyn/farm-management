/**
 * __tests__/server/nvd-snapshot-aia.test.ts
 *
 * TDD tests for wave/26d (refs #26):
 *   buildAnimalSnapshot must propagate tagNumber + brandSequence into the
 *   frozen NVD animal-snapshot JSON, and buildSellerSnapshot must propagate
 *   aiaIdentificationMark.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

function makeMockPrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  return {
    nvdRecord: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
    observation: { findMany: vi.fn().mockResolvedValue([]) },
    animal: { findMany: vi.fn().mockResolvedValue([]) },
    farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
    ...overrides,
  } as unknown as PrismaClient;
}

describe("buildAnimalSnapshot — AIA tag/brand propagation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("includes tagNumber + brandSequence when set on the animal row", async () => {
    const { buildAnimalSnapshot } = await import("@/lib/server/nvd");
    const prisma = makeMockPrisma({
      animal: {
        findMany: vi.fn().mockResolvedValue([
          {
            animalId: "A001",
            name: "Bessie",
            sex: "F",
            breed: "Brangus",
            category: "Cow",
            dateOfBirth: "2020-01-15",
            currentCamp: "C1",
            status: "Active",
            tagNumber: "TAG-12345",
            brandSequence: "001",
          },
        ]),
      },
      observation: { findMany: vi.fn().mockResolvedValue([]) },
    });

    const snapshots = await buildAnimalSnapshot(prisma, ["A001"]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].tagNumber).toBe("TAG-12345");
    expect(snapshots[0].brandSequence).toBe("001");
  });

  it("emits null for animals without tag/brand", async () => {
    const { buildAnimalSnapshot } = await import("@/lib/server/nvd");
    const prisma = makeMockPrisma({
      animal: {
        findMany: vi.fn().mockResolvedValue([
          {
            animalId: "A002",
            name: null,
            sex: "M",
            breed: "Brangus",
            category: "Bull",
            dateOfBirth: null,
            currentCamp: "C2",
            status: "Active",
            tagNumber: null,
            brandSequence: null,
          },
        ]),
      },
      observation: { findMany: vi.fn().mockResolvedValue([]) },
    });

    const snapshots = await buildAnimalSnapshot(prisma, ["A002"]);
    expect(snapshots[0].tagNumber).toBeNull();
    expect(snapshots[0].brandSequence).toBeNull();
  });

  it("snapshot remains JSON-serialisable with new fields", async () => {
    const { buildAnimalSnapshot } = await import("@/lib/server/nvd");
    const prisma = makeMockPrisma({
      animal: {
        findMany: vi.fn().mockResolvedValue([
          {
            animalId: "A003",
            name: null,
            sex: "F",
            breed: "Angus",
            category: "Cow",
            dateOfBirth: null,
            currentCamp: "C1",
            status: "Active",
            tagNumber: "T-3",
            brandSequence: "B-3",
          },
        ]),
      },
      observation: { findMany: vi.fn().mockResolvedValue([]) },
    });

    const snapshots = await buildAnimalSnapshot(prisma, ["A003"]);
    const json = JSON.stringify(snapshots);
    const parsed = JSON.parse(json);
    expect(parsed[0].tagNumber).toBe("T-3");
    expect(parsed[0].brandSequence).toBe("B-3");
  });
});
