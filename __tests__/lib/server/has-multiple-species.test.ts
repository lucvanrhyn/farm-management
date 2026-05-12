/**
 * __tests__/lib/server/has-multiple-species.test.ts
 *
 * wave/235 — issue #235 detection rule. A tenant counts as multi-species
 * iff `prisma.animal.groupBy({ by: ['species'] })` against Active rows
 * returns 2+ distinct species groups. Single OR zero distinct species
 * counts as single-species from the UX perspective (the upsell pill
 * still renders).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/farm-prisma", () => ({
  withFarmPrisma: vi.fn(),
}));

import { withFarmPrisma } from "@/lib/farm-prisma";
import { hasMultipleActiveSpecies } from "@/lib/server/has-multiple-species";

function mockGroupBy(groups: Array<{ species: string }>) {
  (withFarmPrisma as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (_slug: string, fn: (prisma: unknown) => unknown) => {
      const prisma = {
        animal: {
          groupBy: vi.fn().mockResolvedValue(groups),
        },
      };
      return fn(prisma);
    },
  );
}

describe("hasMultipleActiveSpecies", () => {
  it("returns false when the tenant has zero distinct active species", async () => {
    mockGroupBy([]);
    await expect(hasMultipleActiveSpecies("acme")).resolves.toBe(false);
  });

  it("returns false when the tenant has exactly one distinct active species (Basson)", async () => {
    mockGroupBy([{ species: "cattle" }]);
    await expect(hasMultipleActiveSpecies("basson")).resolves.toBe(false);
  });

  it("returns true when the tenant has two distinct active species (Trio B)", async () => {
    mockGroupBy([{ species: "cattle" }, { species: "sheep" }]);
    await expect(hasMultipleActiveSpecies("trio-b")).resolves.toBe(true);
  });

  it("fails closed (returns false) when the underlying query throws", async () => {
    // Multi-tenant safety: on a Prisma/Turso outage we'd rather show the
    // upsell pill (mildly noisy on a multi-species farm) than crash the
    // header. The cached.ts wrapper relies on this not throwing.
    (withFarmPrisma as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        throw new Error("turso down");
      },
    );
    await expect(hasMultipleActiveSpecies("broken")).resolves.toBe(false);
  });
});
