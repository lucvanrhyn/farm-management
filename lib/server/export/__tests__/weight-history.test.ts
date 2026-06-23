/**
 * @vitest-environment node
 *
 * lib/server/export/__tests__/weight-history.test.ts
 *
 * Regression lock for the cuid/tag enrichment join on the weight-history export.
 *
 * Observation.animalId stores the animal TAG (Animal.animalId @unique), but the
 * exporter built its name/camp enrichment map keyed by the cuid Animal.id and
 * then looked it up by the obs TAG → the lookup ALWAYS missed → every Name and
 * Camp column in the CSV/PDF came back blank. Joining tag→tag fixes it.
 *
 * Runs the real exporter against a real in-memory libSQL tenant.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { makeTenantPrisma, daysAgo } from "@/__tests__/helpers/mem-tenant";
import { exportWeightHistory } from "@/lib/server/export/weight-history";

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = await makeTenantPrisma();
  await prisma.animal.create({
    data: {
      animalId: "COW-1",
      name: "Daisy",
      species: "cattle",
      category: "Cow",
      sex: "Female",
      status: "Active",
      currentCamp: "North",
      dateAdded: "2022-01-01",
    },
  });
  // weighing written camelCase `weightKg` (task-completion path) → also exercises
  // the dual-key mass read.
  await prisma.observation.create({
    data: {
      type: "weighing",
      campId: "North",
      animalId: "COW-1",
      details: JSON.stringify({ weightKg: 305 }),
      observedAt: daysAgo(5),
      species: "cattle",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("exportWeightHistory — enriches Name/Camp by the animal TAG", () => {
  it("populates Name and Camp columns (were always blank pre-fix)", async () => {
    const artifact = await exportWeightHistory({
      prisma,
      format: "csv",
      url: new URL("http://test/export"),
      from: null,
      to: null,
    });
    const csv = artifact.body as string;
    // Header + exactly one data row.
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(2);
    const dataRow = lines[1];
    expect(dataRow).toContain("COW-1");
    expect(dataRow).toContain("Daisy"); // Name — blank pre-fix
    expect(dataRow).toContain("North"); // Camp — blank pre-fix
    expect(dataRow).toContain("305"); // dual-key camelCase mass
  });
});
