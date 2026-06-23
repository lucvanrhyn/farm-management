/**
 * @vitest-environment node
 *
 * lib/server/__tests__/withdrawal-tracker-deceased.test.ts
 *
 * Regression lock for the deceased/culled leak on getWithdrawalTracker (the
 * admin Analytics "not yet cleared for market" table). It read every treatment
 * observation with NO animal-status filter, so an animal that died/was sold the
 * day after a treatment still showed as in-withdrawal. The fix joins the treated
 * tags to their Animal rows and keeps only Active ones.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { makeTenantPrisma, daysAgo } from "@/__tests__/helpers/mem-tenant";
import { getWithdrawalTracker } from "@/lib/server/analytics";

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = await makeTenantPrisma();
  for (const [tag, status] of [["COW-A", "Active"], ["COW-D", "Deceased"], ["OX-S", "Sold"]] as const) {
    await prisma.animal.create({
      data: { animalId: tag, species: "cattle", category: "Cow", sex: "Female", status, currentCamp: "C1", dateAdded: "2022-01-01" },
    });
  }
  for (const tag of ["COW-A", "COW-D", "OX-S"]) {
    await prisma.observation.create({
      data: {
        type: "treatment",
        campId: "C1",
        animalId: tag,
        details: JSON.stringify({ product: "Terramycin", withdrawalDays: 14 }),
        observedAt: daysAgo(2),
        species: "cattle",
      },
    });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getWithdrawalTracker — excludes animals that have left the herd", () => {
  it("lists only the live (Active) animal, not the deceased/sold ones", async () => {
    const rows = await getWithdrawalTracker(prisma);
    expect(rows).toHaveLength(1); // was 3 pre-fix
    expect(rows[0].animalId).toBe("COW-A");
  });
});
