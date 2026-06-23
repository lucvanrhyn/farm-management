/**
 * @vitest-environment node
 *
 * lib/server/__tests__/treatment-analytics.test.ts
 *
 * Regression lock for the treatmentType / withdrawalDays key-drift on the
 * withdrawal tracker. Every persisted writer (TreatmentForm, CreateObservationModal)
 * emits camelCase `treatmentType` / `withdrawalDays`; the reader keyed snake_case
 * `treatment_type` / `withdrawal_days`, so EVERY treatment fell back to type
 * "Other" and the default 7-day window, discarding the real values.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { makeTenantPrisma, daysAgo } from "@/__tests__/helpers/mem-tenant";
import { getAnimalsInWithdrawal } from "@/lib/server/treatment-analytics";

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = await makeTenantPrisma();
  for (const [tag, status] of [["COW-A", "Active"], ["COW-D", "Deceased"]] as const) {
    await prisma.animal.create({
      data: { animalId: tag, species: "cattle", category: "Cow", sex: "Female", status, currentCamp: "C1", dateAdded: "2022-01-01" },
    });
  }
  // camelCase details — exactly what TreatmentForm persists. 14-day window, 2 days ago → still open.
  for (const tag of ["COW-A", "COW-D"]) {
    await prisma.observation.create({
      data: {
        type: "treatment",
        campId: "C1",
        animalId: tag,
        details: JSON.stringify({ treatmentType: "Antibiotic", product: "Terramycin", withdrawalDays: 14 }),
        observedAt: daysAgo(2),
        species: "cattle",
      },
    });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getAnimalsInWithdrawal — reads camelCase treatmentType/withdrawalDays", () => {
  it("returns the real treatment type and withdrawal window (not 'Other'/default)", async () => {
    const rows = await getAnimalsInWithdrawal(prisma);
    // Deceased animal already excluded by the active-join (regression guard).
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.animalId).toBe("COW-A");
    expect(r.treatmentType).toBe("Antibiotic"); // was "Other" pre-fix
    expect(r.withdrawalDays).toBe(14); // was DEFAULT_WITHDRAWAL_DAYS["Other"] = 7 pre-fix
  });
});
