/**
 * @vitest-environment node
 *
 * __tests__/alerts/predator-spike.test.ts — 2σ rolling-window stats test.
 *
 * We feed a synthetic 7-day baseline (zeros, small noise) and then inject a
 * today-count that should exceed μ + 2σ, then a smaller spike that shouldn't.
 */

import { describe, it, expect, vi } from "vitest";
import { evaluate } from "@/lib/server/alerts/predator-spike";
import { makePrisma, makeSettings } from "./fixtures";

function toIsoDate(daysAgoCount: number): string {
  return new Date(Date.now() - daysAgoCount * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * The predator-spike generator issues TWO $queryRawUnsafe calls (game +
 * observation). Return the injected rows to the game call and an empty array
 * to the observation call so the total stays what the test expects.
 */
function mockPredationQueries(gameRows: Array<{ date: string; count: number }>) {
  return vi.fn()
    .mockResolvedValueOnce(gameRows) // first call: GamePredationEvent
    .mockResolvedValueOnce([]); // second call: Observation type=predation_loss
}

describe("PREDATOR_SPIKE", () => {
  it("fires when today's count is > μ + 2σ AND ≥ 2", async () => {
    const rows = [
      { date: toIsoDate(1), count: 0 },
      { date: toIsoDate(2), count: 1 },
      { date: toIsoDate(3), count: 0 },
      { date: toIsoDate(4), count: 0 },
      { date: toIsoDate(5), count: 0 },
      { date: toIsoDate(6), count: 0 },
      { date: toIsoDate(7), count: 0 },
      { date: toIsoDate(0), count: 5 }, // today
    ];
    const prisma = makePrisma({ $queryRawUnsafe: mockPredationQueries(rows) });
    const out = await evaluate(prisma, makeSettings(), "tenant-a");
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("PREDATOR_SPIKE");
    expect(out[0].severity).toBe("red");
    expect(out[0].payload.todayCount).toBe(5);
  });

  it("does NOT fire when today's count is only 1 (below MIN_TODAY_COUNT)", async () => {
    const rows = [
      { date: toIsoDate(1), count: 0 },
      { date: toIsoDate(0), count: 1 },
    ];
    const prisma = makePrisma({ $queryRawUnsafe: mockPredationQueries(rows) });
    const out = await evaluate(prisma, makeSettings(), "tenant-a");
    expect(out).toHaveLength(0);
  });

  it("does NOT fire when today's count is within σ of baseline", async () => {
    const rows = [
      { date: toIsoDate(1), count: 2 },
      { date: toIsoDate(2), count: 3 },
      { date: toIsoDate(3), count: 2 },
      { date: toIsoDate(4), count: 3 },
      { date: toIsoDate(5), count: 2 },
      { date: toIsoDate(6), count: 3 },
      { date: toIsoDate(7), count: 2 },
      { date: toIsoDate(0), count: 3 }, // today, same as baseline avg
    ];
    const prisma = makePrisma({ $queryRawUnsafe: mockPredationQueries(rows) });
    const out = await evaluate(prisma, makeSettings(), "tenant-a");
    expect(out).toHaveLength(0);
  });
});
