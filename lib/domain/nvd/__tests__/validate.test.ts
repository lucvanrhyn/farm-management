/**
 * @vitest-environment node
 *
 * Wave G1 (#165) — `validateNvdAnimals` domain op tests.
 *
 * Behaviour preserved verbatim from the pre-G1 server module — these
 * tests pin the discriminated-union return shape and the in/out blocker
 * filtering. The legacy `__tests__/lib/server/nvd.test.ts` covers the
 * same op via the re-export shim; this file pins it at the new module
 * path so future renames have to update it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

const hoisted = vi.hoisted(() => ({
  getAnimalsInWithdrawal: vi.fn(),
}));

vi.mock("@/lib/server/treatment-analytics", () => ({
  getAnimalsInWithdrawal: hoisted.getAnimalsInWithdrawal,
}));

import { validateNvdAnimals } from "@/lib/domain/nvd/validate";

const mockPrisma = {} as unknown as PrismaClient;

beforeEach(() => {
  hoisted.getAnimalsInWithdrawal.mockReset();
});

describe("validateNvdAnimals", () => {
  it("returns ok:true when no animals are in withdrawal", async () => {
    hoisted.getAnimalsInWithdrawal.mockResolvedValueOnce([]);

    const result = await validateNvdAnimals(mockPrisma, ["A001", "A002"]);

    expect(result.ok).toBe(true);
  });

  it("returns ok:false with blockers when selected animals are in withdrawal", async () => {
    hoisted.getAnimalsInWithdrawal.mockResolvedValueOnce([
      {
        animalId: "A002",
        name: "Bessie",
        campId: "C1",
        treatmentType: "Antibiotic",
        treatedAt: new Date("2026-04-01"),
        withdrawalDays: 14,
        withdrawalEndsAt: new Date("2026-04-15"),
        daysRemaining: 4,
      },
    ]);

    const result = await validateNvdAnimals(mockPrisma, ["A001", "A002"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].animalId).toBe("A002");
    }
  });

  it("ignores withdrawal animals not in the selected list", async () => {
    hoisted.getAnimalsInWithdrawal.mockResolvedValueOnce([
      {
        animalId: "A999",
        name: "Other",
        campId: "C1",
        treatmentType: "Antibiotic",
        treatedAt: new Date("2026-04-01"),
        withdrawalDays: 14,
        withdrawalEndsAt: new Date("2026-04-15"),
        daysRemaining: 4,
      },
    ]);

    const result = await validateNvdAnimals(mockPrisma, ["A001", "A002"]);

    expect(result.ok).toBe(true);
  });
});
