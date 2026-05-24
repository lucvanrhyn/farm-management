/**
 * __tests__/server/get-latest-camp-conditions.test.ts
 *
 * Issue #407 — `getLatestCampConditions` contract.
 *
 * The server consumer of the "last visit" badge. Reads the latest
 * `camp_condition` / `camp_check` observation per camp via Prisma's
 * `distinct: ["campId"]` + `orderBy: { observedAt: "desc" }`.
 *
 * These tests pin the read contract so future refactors cannot silently
 * drop a type, swap the order, or undo the cross-species facade. They use
 * a fake PrismaClient that records the `where` clause and returns supplied
 * rows — same pattern as `count-inspected-today.test.ts`.
 *
 * The literal type set is consumed via the hoisted constant
 * `CAMP_INSPECTION_OBSERVATION_TYPES` so the producer (logger submit
 * handlers) and the consumer (this query) cannot drift in spirit with
 * ADR-0006's "named-door / single-source-of-truth" doctrine.
 */
import { describe, it, expect, vi } from "vitest";
import { getLatestCampConditions } from "@/lib/server/camp-status";
import { CAMP_INSPECTION_OBSERVATION_TYPES } from "@/lib/observations/camp-inspection-types";
import type { PrismaClient } from "@prisma/client";

type ObsRow = {
  type: string;
  campId: string;
  details: string;
  observedAt: Date | string;
};

function fakePrisma(rows: ObsRow[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const prisma = {
    observation: { findMany },
  } as unknown as PrismaClient;
  return { prisma, findMany };
}

describe("getLatestCampConditions — issue #407 read-contract", () => {
  it("filters on the canonical camp-inspection type set (camp_condition + camp_check)", async () => {
    const { prisma, findMany } = fakePrisma([]);
    await getLatestCampConditions(prisma);
    const where = findMany.mock.calls.at(-1)?.[0]?.where as
      | { type?: { in?: string[] } }
      | undefined;
    expect(where?.type?.in).toEqual([...CAMP_INSPECTION_OBSERVATION_TYPES]);
  });

  it("orders by observedAt desc with distinct on campId so the latest observation wins", async () => {
    const { prisma, findMany } = fakePrisma([]);
    await getLatestCampConditions(prisma);
    const args = findMany.mock.calls.at(-1)?.[0];
    expect(args?.orderBy).toEqual({ observedAt: "desc" });
    expect(args?.distinct).toEqual(["campId"]);
  });

  it("returns an empty map when no observations exist", async () => {
    const { prisma } = fakePrisma([]);
    const map = await getLatestCampConditions(prisma);
    expect(map.size).toBe(0);
  });

  it("emits camp_condition details verbatim (grazing/water/fence/logged_by)", async () => {
    const { prisma } = fakePrisma([
      {
        type: "camp_condition",
        campId: "rivierkamp",
        details: JSON.stringify({
          grazing: "Good",
          water: "Full",
          fence: "Intact",
          logged_by: "luc",
        }),
        observedAt: new Date("2026-05-24T09:00:00Z"),
      },
    ]);
    const map = await getLatestCampConditions(prisma);
    const status = map.get("rivierkamp");
    expect(status).toBeDefined();
    expect(status?.grazing_quality).toBe("Good");
    expect(status?.water_status).toBe("Full");
    expect(status?.fence_status).toBe("Intact");
    expect(status?.last_inspected_by).toBe("luc");
    expect(status?.last_inspected_at).toBe("2026-05-24T09:00:00.000Z");
  });

  it("treats a camp_check row as Good/Full/Intact (the All-Normal branch)", async () => {
    const { prisma } = fakePrisma([
      {
        type: "camp_check",
        campId: "bullekamp",
        details: JSON.stringify({ status: "normal", logged_by: "luc" }),
        observedAt: new Date("2026-05-24T09:00:00Z"),
      },
    ]);
    const map = await getLatestCampConditions(prisma);
    const status = map.get("bullekamp");
    expect(status?.grazing_quality).toBe("Good");
    expect(status?.water_status).toBe("Full");
    expect(status?.fence_status).toBe("Intact");
    expect(status?.last_inspected_by).toBe("luc");
  });

  it("returns ISO strings for last_inspected_at when Prisma returns Date objects", async () => {
    const { prisma } = fakePrisma([
      {
        type: "camp_condition",
        campId: "weiveld-3",
        details: "{}",
        observedAt: new Date("2026-05-24T09:00:00Z"),
      },
    ]);
    const map = await getLatestCampConditions(prisma);
    expect(map.get("weiveld-3")?.last_inspected_at).toBe(
      "2026-05-24T09:00:00.000Z",
    );
  });

  it("survives a malformed details JSON (skips fields, keeps timestamp)", async () => {
    const { prisma } = fakePrisma([
      {
        type: "camp_condition",
        campId: "weiveld-3",
        details: "not-json{",
        observedAt: new Date("2026-05-24T09:00:00Z"),
      },
    ]);
    const map = await getLatestCampConditions(prisma);
    const status = map.get("weiveld-3");
    // Malformed details → defaults applied; the row still appears in the map.
    expect(status).toBeDefined();
    expect(status?.last_inspected_at).toBe("2026-05-24T09:00:00.000Z");
  });
});

describe("CAMP_INSPECTION_OBSERVATION_TYPES — hoisted constant", () => {
  it("contains exactly camp_condition + camp_check (the producer/consumer contract)", () => {
    expect(new Set(CAMP_INSPECTION_OBSERVATION_TYPES)).toEqual(
      new Set(["camp_condition", "camp_check"]),
    );
  });

  it("is a stable tuple/array (caller can spread or iterate)", () => {
    expect(Array.isArray(CAMP_INSPECTION_OBSERVATION_TYPES)).toBe(true);
    expect(CAMP_INSPECTION_OBSERVATION_TYPES.length).toBe(2);
  });
});
