/**
 * @vitest-environment node
 *
 * __tests__/alerts/fawning-due.test.ts — FAWNING_DUE per-species (MOAT).
 *
 * Asserts that per-species gestation days from lib/species/gestation.ts drive
 * the alert timing: a kudu census from 236 days ago should fire (240 - 236 =
 * 4 days to fawning, inside 14d window); an impala from 50 days ago should
 * NOT fire (197 - 50 = 147 days away).
 */

import { describe, it, expect, vi } from "vitest";
import { evaluate } from "@/lib/server/alerts/fawning-due";
import { makePrisma, makeSettings, daysAgo } from "./fixtures";
import { GESTATION_TABLE } from "@/lib/species/gestation";

function censusDate(daysAgoCount: number): string {
  return daysAgo(daysAgoCount).toISOString().slice(0, 10);
}

describe("FAWNING_DUE", () => {
  it("fires for kudu when census + 240d lands inside the 14d window", async () => {
    const prisma = makePrisma({
      gameSpecies: {
        findMany: vi.fn().mockResolvedValue([
          { id: "sp-1", commonName: "Kudu", lastCensusDate: censusDate(236), gestationDays: null },
        ]),
      },
    });
    const out = await evaluate(prisma, makeSettings(), "tenant-a");
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("FAWNING_DUE");
    expect(out[0].payload.gestationDays).toBe(GESTATION_TABLE.kudu.days);
    expect(out[0].payload.speciesName).toBe("Kudu");
    expect(out[0].collapseKey).toBe("sp-1");
  });

  it("does NOT fire for impala when fawning is 147+ days away", async () => {
    const prisma = makePrisma({
      gameSpecies: {
        findMany: vi.fn().mockResolvedValue([
          { id: "sp-2", commonName: "Impala", lastCensusDate: censusDate(50), gestationDays: null },
        ]),
      },
    });
    const out = await evaluate(prisma, makeSettings(), "tenant-a");
    expect(out).toHaveLength(0);
  });

  it("honours an explicit gestationDays override on GameSpecies", async () => {
    const prisma = makePrisma({
      gameSpecies: {
        findMany: vi.fn().mockResolvedValue([
          { id: "sp-3", commonName: "Wildebeest", lastCensusDate: censusDate(251), gestationDays: 255 },
        ]),
      },
    });
    const out = await evaluate(prisma, makeSettings(), "tenant-a");
    expect(out).toHaveLength(1);
    expect(out[0].payload.gestationDays).toBe(255);
  });

  it("returns [] gracefully when GameSpecies model throws (non-game tenant)", async () => {
    const prisma = makePrisma({
      gameSpecies: { findMany: vi.fn().mockRejectedValue(new Error("no such table")) },
    });
    const out = await evaluate(prisma, makeSettings(), "tenant-a");
    expect(out).toEqual([]);
  });
});
