/**
 * @vitest-environment node
 *
 * lib/server/__tests__/cog-by-animal-deceased.test.ts
 *
 * Regression lock for the deceased/culled leak on getCogByAnimal (the
 * "Cost of Gain — By Animal" CSV/PDF export). Its animal lookup had no status
 * filter, so a deceased/sold animal with in-period cost still appeared as a live
 * row — inconsistent with the By-Camp + Summary siblings, which filter Active.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { makeTenantPrisma } from "@/__tests__/helpers/mem-tenant";
import { getCogByAnimal } from "@/lib/server/financial-analytics";

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = await makeTenantPrisma();
  for (const [tag, status] of [["OX-A", "Active"], ["OX-S", "Sold"]] as const) {
    await prisma.animal.create({
      data: { animalId: tag, species: "cattle", category: "Ox", sex: "Male", status, currentCamp: "C1", dateAdded: "2022-01-01" },
    });
  }
  // Both animals carry an in-period feed expense (animalId = TAG).
  for (const tag of ["OX-A", "OX-S"]) {
    await prisma.transaction.create({
      data: { type: "expense", category: "Feed/Supplements", amount: 1000, date: "2026-01-15", description: "feed", animalId: tag },
    });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getCogByAnimal — excludes animals that have left the herd", () => {
  it("emits the live animal only, not the sold one", async () => {
    const rows = await getCogByAnimal(prisma, new Date("2026-01-01"), new Date("2026-01-31"), "all", 50);
    const tags = rows.map((r) => r.animalId);
    expect(tags).toContain("OX-A");
    expect(tags).not.toContain("OX-S"); // was present pre-fix
  });
});
