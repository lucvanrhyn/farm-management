/**
 * @vitest-environment node
 *
 * Wave G4 (#168) — `listCampPerformance` test.
 *
 * Exercises the camp performance rollup that was previously inline in
 * `app/api/[farmSlug]/performance/route.ts`. The behaviour is preserved
 * verbatim — these tests pin that contract before the file moves.
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { listCampPerformance } from "@/lib/domain/performance/list-camp-performance";

function buildPrisma(opts: {
  camps?: Array<{
    campId: string;
    campName: string;
    sizeHectares: number | null;
  }>;
  animalGroups?: Array<{ currentCamp: string | null; _count: { _all: number } }>;
  observations?: Array<{
    campId: string;
    details: unknown;
    observedAt: Date | string;
  }>;
  covers?: Array<{
    campId: string;
    coverCategory: string;
    recordedAt: Date | string;
  }>;
}): PrismaClient {
  const camp = {
    findMany: vi.fn().mockResolvedValue(opts.camps ?? []),
  };
  const animal = {
    groupBy: vi.fn().mockResolvedValue(opts.animalGroups ?? []),
  };
  const observation = {
    findMany: vi.fn().mockResolvedValue(opts.observations ?? []),
  };
  const campCoverReading = {
    findMany: vi.fn().mockResolvedValue(opts.covers ?? []),
  };
  return {
    camp,
    animal,
    observation,
    campCoverReading,
  } as unknown as PrismaClient;
}

describe("listCampPerformance", () => {
  it("returns [] when the farm has no camps and skips the bulk queries", async () => {
    const prisma = buildPrisma({ camps: [] });

    const result = await listCampPerformance(prisma);

    expect(result).toEqual([]);
    // sanity: still query the camp list, but skip the IN-keyed bulk fetches
    expect((prisma.camp.findMany as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      orderBy: { campId: "asc" },
    });
    expect((prisma.animal.groupBy as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(
      (prisma.observation.findMany as ReturnType<typeof vi.fn>),
    ).not.toHaveBeenCalled();
    expect(
      (prisma.campCoverReading.findMany as ReturnType<typeof vi.fn>),
    ).not.toHaveBeenCalled();
  });

  it("rolls up animal count, latest condition, and latest cover per camp", async () => {
    const prisma = buildPrisma({
      camps: [
        { campId: "A", campName: "Alpha", sizeHectares: 10 },
        { campId: "B", campName: "Bravo", sizeHectares: 0 },
      ],
      animalGroups: [
        { currentCamp: "A", _count: { _all: 25 } },
        { currentCamp: null, _count: { _all: 9 } }, // ignored — no camp link
      ],
      // Newest first by query contract: first match per campId wins.
      observations: [
        {
          campId: "A",
          details: { grazing: "good", fence: "ok" },
          observedAt: new Date("2026-04-10T12:00:00Z"),
        },
        {
          campId: "A",
          details: { grazing: "fair", fence: "needs-fix" },
          observedAt: new Date("2026-03-01T09:00:00Z"),
        },
      ],
      covers: [
        {
          campId: "A",
          coverCategory: "high",
          recordedAt: new Date("2026-04-12T08:00:00Z"),
        },
        {
          campId: "A",
          coverCategory: "low",
          recordedAt: new Date("2026-02-01T08:00:00Z"),
        },
      ],
    });

    const result = await listCampPerformance(prisma);

    expect(result).toEqual([
      {
        campId: "A",
        campName: "Alpha",
        sizeHectares: 10,
        animalCount: 25,
        stockingDensity: "2.5",
        grazingQuality: "good",
        fenceStatus: "ok",
        lastInspection: "2026-04-10",
        coverCategory: "high",
        coverReadingDate: "2026-04-12",
      },
      {
        // sizeHectares = 0 → stockingDensity null
        // no observations / cover → all condition + cover fields null
        campId: "B",
        campName: "Bravo",
        sizeHectares: 0,
        animalCount: 0,
        stockingDensity: null,
        grazingQuality: null,
        fenceStatus: null,
        lastInspection: null,
        coverCategory: null,
        coverReadingDate: null,
      },
    ]);

    // Verify the IN-keyed queries scoped to the camp list.
    expect((prisma.animal.groupBy as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      by: ["currentCamp"],
      where: { currentCamp: { in: ["A", "B"] }, status: "Active" },
      _count: { _all: true },
    });
    expect(
      (prisma.observation.findMany as ReturnType<typeof vi.fn>),
    ).toHaveBeenCalledWith({
      where: { campId: { in: ["A", "B"] }, type: "camp_condition" },
      orderBy: { observedAt: "desc" },
      select: { campId: true, details: true, observedAt: true },
    });
    expect(
      (prisma.campCoverReading.findMany as ReturnType<typeof vi.fn>),
    ).toHaveBeenCalledWith({
      where: { campId: { in: ["A", "B"] } },
      orderBy: { recordedAt: "desc" },
      select: { campId: true, coverCategory: true, recordedAt: true },
    });
  });

  it("falls back to null for missing observation/cover fields", async () => {
    const prisma = buildPrisma({
      camps: [{ campId: "C", campName: "Charlie", sizeHectares: 5 }],
      animalGroups: [{ currentCamp: "C", _count: { _all: 2 } }],
      observations: [
        // details JSON is empty → grazing/fence both null
        { campId: "C", details: {}, observedAt: new Date("2026-03-15T00:00:00Z") },
      ],
      covers: [],
    });

    const result = await listCampPerformance(prisma);

    expect(result).toEqual([
      {
        campId: "C",
        campName: "Charlie",
        sizeHectares: 5,
        animalCount: 2,
        stockingDensity: "0.4",
        grazingQuality: null,
        fenceStatus: null,
        lastInspection: "2026-03-15",
        coverCategory: null,
        coverReadingDate: null,
      },
    ]);
  });
});
