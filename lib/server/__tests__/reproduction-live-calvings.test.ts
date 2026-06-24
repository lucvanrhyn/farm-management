/**
 * @vitest-environment node
 *
 * lib/server/__tests__/reproduction-live-calvings.test.ts
 *
 * Regression lock for the calving "live calf" key-drift on getReproStats. The
 * Calving Rate counted only calvings whose details carried `calf_status: "live"`
 * (the ReproductionForm sub-flow). The dedicated Calving tile — the primary path
 * — persists `calfAlive: true` instead, so every tile-logged calving was invisible
 * and the headline rate under-counted (often to 0).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { makeTenantPrisma, daysAgo } from "@/__tests__/helpers/mem-tenant";
import { getReproStats } from "@/lib/server/reproduction-analytics";

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = await makeTenantPrisma();
  await prisma.farmSpeciesSettings.create({ data: { species: "cattle", enabled: true } });
  await prisma.animal.create({
    data: { animalId: "COW-1", species: "cattle", category: "Cow", sex: "Female", status: "Active", currentCamp: "C1", dateAdded: "2022-01-01" },
  });
  // One insemination (denominator) + one tile-logged live calving (calfAlive),
  // both within the trailing 12 months.
  await prisma.observation.create({
    data: { type: "insemination", campId: "C1", animalId: "COW-1", details: JSON.stringify({ method: "AI" }), observedAt: daysAgo(300), species: "cattle" },
  });
  await prisma.observation.create({
    data: { type: "calving", campId: "C1", animalId: "COW-1", details: JSON.stringify({ calfAlive: true, calfAnimalId: "CALF-1" }), observedAt: daysAgo(20), species: "cattle" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getReproStats — counts tile-logged (calfAlive) live calvings", () => {
  it("calvingRate reflects the live calving (was 0 pre-fix)", async () => {
    const stats = await getReproStats(prisma, { species: "cattle" });
    // 1 live calving / 1 insemination = 100%.
    expect(stats.calvingRate).toBe(100);
  });
});
