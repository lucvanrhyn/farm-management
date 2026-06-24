/**
 * @vitest-environment node
 *
 * lib/server/alerts/__tests__/cog-breakeven.test.ts
 *
 * Regression lock for the cuid/tag join bug class + the dual-key weighing blind
 * spot on the COG_EXCEEDS_BREAKEVEN alert.
 *
 * Two defects shipped together in this reader and both made the alert DEAD in
 * production:
 *   1. cuid/tag join — Transaction.animalId and Observation.animalId store the
 *      animal TAG (Animal.animalId @unique), but the reader filtered both by the
 *      cuid Animal.id → every spend/weight row matched nothing → cogPerKg was
 *      always 0 → the alert never fired.
 *   2. snake-only SQL — the raw-SQL weight read extracted only `$.weight_kg`, so
 *      a task-completion weighing (camelCase `weightKg`) was invisible even once
 *      the join was fixed.
 *
 * This test drives the real reader against a real in-memory libSQL tenant, so a
 * regression on EITHER axis fails it for the same reason prod was silently broken.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FarmSettings, PrismaClient } from "@prisma/client";
import { makeTenantPrisma, daysAgo } from "@/__tests__/helpers/mem-tenant";
import { evaluate } from "@/lib/server/alerts/cog-breakeven";

let prisma: PrismaClient;
let settings: FarmSettings;

beforeAll(async () => {
  prisma = await makeTenantPrisma();
  // market R50/kg → breakeven = 50 × 0.85 = R42.50/kg
  await prisma.farmSettings.create({
    data: {
      id: "singleton",
      farmName: "Test",
      speciesAlertThresholds: JSON.stringify({ cattle: { marketPricePerKg: 50 } }),
    },
  });
  settings = await prisma.farmSettings.findFirstOrThrow();

  // OX-OVER: R5000 spend ÷ 100 kg = R50/kg cogPerKg > R42.50 breakeven → FIRES.
  //   weighing written camelCase `weightKg` (the task-completion path) — proves
  //   the SQL COALESCEs both keys.
  // OX-OK:   R1000 spend ÷ 100 kg = R10/kg < breakeven → NOT flagged.
  //   weighing written snake_case `weight_kg` — proves the canonical key still reads.
  for (const tag of ["OX-OVER", "OX-OK"]) {
    await prisma.animal.create({
      data: {
        animalId: tag,
        species: "cattle",
        category: "Ox",
        sex: "Male",
        status: "Active",
        currentCamp: "C1",
        dateAdded: "2022-01-01",
      },
    });
  }

  // NOTE: createMany() fails on an in-memory libSQL tenant ("no such table") —
  // the adapter's batch path doesn't see the connection-private :memory: schema.
  // Singular create() is the proven pattern for this harness.
  for (const t of [
    { amount: 5000, animalId: "OX-OVER" },
    { amount: 1000, animalId: "OX-OK" },
  ]) {
    await prisma.transaction.create({
      data: { type: "expense", category: "feed", amount: t.amount, date: "2026-01-01", description: "feed", animalId: t.animalId },
    });
  }

  for (const o of [
    { animalId: "OX-OVER", details: { weightKg: 100 } }, // camelCase (task-completion)
    { animalId: "OX-OK", details: { weight_kg: 100 } }, // snake_case (logger/modal)
  ]) {
    await prisma.observation.create({
      data: { type: "weighing", campId: "C1", animalId: o.animalId, details: JSON.stringify(o.details), observedAt: daysAgo(5), species: "cattle" },
    });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("cog-breakeven evaluate — joins spend + weight on the TAG, dual-key weighing", () => {
  it("fires COG_EXCEEDS_BREAKEVEN for the over-breakeven animal (was DEAD pre-fix)", async () => {
    const candidates = await evaluate(prisma, settings, "test-farm");
    const over = candidates.filter((c) => c.type === "COG_EXCEEDS_BREAKEVEN");
    expect(over).toHaveLength(1);
    expect(over[0].payload?.animalId).toBe("OX-OVER");
    // R5000 / 100 kg = R50.00/kg
    expect(over[0].payload?.cogPerKg).toBe(50);
  });

  it("does NOT flag the under-breakeven animal (not a blanket fire)", async () => {
    const candidates = await evaluate(prisma, settings, "test-farm");
    expect(candidates.some((c) => c.payload?.animalId === "OX-OK")).toBe(false);
  });
});
