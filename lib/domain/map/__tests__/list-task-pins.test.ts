/**
 * @vitest-environment node
 *
 * Wave G3 (#167) — `listTaskPins` test.
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { listTaskPins } from "@/lib/domain/map/list-task-pins";

function mkPrisma(opts: {
  tasks: ReadonlyArray<Record<string, unknown>>;
  camps: ReadonlyArray<{ campId: string; geojson: string | null }>;
  taskFindManySpy?: ReturnType<typeof vi.fn>;
  campFindManySpy?: ReturnType<typeof vi.fn>;
}): PrismaClient {
  const taskFindMany = opts.taskFindManySpy ?? vi.fn().mockResolvedValue(opts.tasks);
  const campFindMany = opts.campFindManySpy ?? vi.fn().mockResolvedValue(opts.camps);
  return {
    task: { findMany: taskFindMany },
    camp: { findMany: campFindMany },
  } as unknown as PrismaClient;
}

describe("listTaskPins", () => {
  it("uses task.lat/lng directly when present", async () => {
    const prisma = mkPrisma({
      tasks: [
        {
          id: "t1",
          title: "Inspect fence",
          taskType: "maintenance",
          status: "pending",
          priority: "high",
          dueDate: "2026-05-08",
          animalId: null,
          campId: null,
          lat: -25.5,
          lng: 28.5,
        },
      ],
      camps: [],
    });

    const result = await listTaskPins(prisma, "open");
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry).toEqual({
      type: "Point",
      coordinates: [28.5, -25.5],
    });
    expect(result.features[0].properties).toEqual({
      id: "t1",
      title: "Inspect fence",
      taskType: "maintenance",
      status: "pending",
      priority: "high",
      dueDate: "2026-05-08",
      animalId: null,
      campId: null,
    });
  });

  it("falls back to the camp centroid when task lacks coords but has campId", async () => {
    const prisma = mkPrisma({
      tasks: [
        {
          id: "t1",
          title: "Walk camp",
          taskType: "patrol",
          status: "pending",
          priority: "medium",
          dueDate: "2026-05-08",
          animalId: null,
          campId: "C1",
          lat: null,
          lng: null,
        },
      ],
      camps: [
        {
          campId: "C1",
          // Camp.geojson is a raw Point geometry; centroid trivially
          // resolves to that single coordinate.
          geojson: JSON.stringify({
            type: "Point",
            coordinates: [28.5, -25.5],
          }),
        },
      ],
    });

    const result = await listTaskPins(prisma, "open");
    expect(result.features).toHaveLength(1);
    const [lng, lat] = result.features[0].geometry.coordinates;
    expect(lng).toBeCloseTo(28.5, 4);
    expect(lat).toBeCloseTo(-25.5, 4);
  });

  it("skips tasks with no coords and no resolvable camp centroid", async () => {
    const prisma = mkPrisma({
      tasks: [
        {
          id: "t1",
          title: "Orphan",
          taskType: "patrol",
          status: "pending",
          priority: "medium",
          dueDate: null,
          animalId: null,
          campId: "MISSING",
          lat: null,
          lng: null,
        },
        {
          id: "t2",
          title: "No camp at all",
          taskType: "patrol",
          status: "pending",
          priority: "medium",
          dueDate: null,
          animalId: null,
          campId: null,
          lat: null,
          lng: null,
        },
      ],
      camps: [],
    });

    const result = await listTaskPins(prisma, "open");
    expect(result.features).toHaveLength(0);
  });

  it("applies the open filter — status in (pending, in_progress)", async () => {
    const taskFindManySpy = vi.fn().mockResolvedValue([]);
    const prisma = mkPrisma({
      tasks: [],
      camps: [],
      taskFindManySpy,
    });

    await listTaskPins(prisma, "open");
    expect(taskFindManySpy).toHaveBeenCalledWith({
      where: { status: { in: ["pending", "in_progress"] } },
      select: {
        id: true,
        title: true,
        taskType: true,
        status: true,
        priority: true,
        dueDate: true,
        animalId: true,
        campId: true,
        lat: true,
        lng: true,
      },
    });
  });

  it("applies the today filter — adds dueDate equality + status in (pending, in_progress)", async () => {
    const taskFindManySpy = vi.fn().mockResolvedValue([]);
    const prisma = mkPrisma({
      tasks: [],
      camps: [],
      taskFindManySpy,
    });

    await listTaskPins(prisma, "today");
    const call = taskFindManySpy.mock.calls[0][0];
    expect(call.where.status).toEqual({ in: ["pending", "in_progress"] });
    // dueDate is computed via Africa/Johannesburg today — assert format.
    expect(call.where.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("applies the all filter — no where clause", async () => {
    const taskFindManySpy = vi.fn().mockResolvedValue([]);
    const prisma = mkPrisma({
      tasks: [],
      camps: [],
      taskFindManySpy,
    });

    await listTaskPins(prisma, "all");
    expect(taskFindManySpy).toHaveBeenCalledWith({
      where: {},
      select: {
        id: true,
        title: true,
        taskType: true,
        status: true,
        priority: true,
        dueDate: true,
        animalId: true,
        campId: true,
        lat: true,
        lng: true,
      },
    });
  });

  it("queries camps with non-null geojson only", async () => {
    const campFindManySpy = vi.fn().mockResolvedValue([]);
    const prisma = mkPrisma({
      tasks: [],
      camps: [],
      campFindManySpy,
    });

    await listTaskPins(prisma, "open");
    expect(campFindManySpy).toHaveBeenCalledWith({
      select: { campId: true, geojson: true },
      where: { geojson: { not: null } },
    });
  });

  it("handles camp.geojson encoded as a Feature (with .geometry wrapper)", async () => {
    const prisma = mkPrisma({
      tasks: [
        {
          id: "t1",
          title: "Walk",
          taskType: "patrol",
          status: "pending",
          priority: "medium",
          dueDate: "2026-05-08",
          animalId: null,
          campId: "C1",
          lat: null,
          lng: null,
        },
      ],
      camps: [
        {
          campId: "C1",
          geojson: JSON.stringify({
            type: "Feature",
            properties: {},
            geometry: {
              type: "Point",
              coordinates: [28.5, -25.5],
            },
          }),
        },
      ],
    });

    const result = await listTaskPins(prisma, "open");
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.coordinates).toEqual([28.5, -25.5]);
  });

  it("silently ignores unparseable camp.geojson", async () => {
    const prisma = mkPrisma({
      tasks: [
        {
          id: "t1",
          title: "Walk",
          taskType: "patrol",
          status: "pending",
          priority: "medium",
          dueDate: "2026-05-08",
          animalId: null,
          campId: "C1",
          lat: null,
          lng: null,
        },
      ],
      camps: [{ campId: "C1", geojson: "not-json" }],
    });

    const result = await listTaskPins(prisma, "open");
    expect(result.features).toHaveLength(0);
  });
});
