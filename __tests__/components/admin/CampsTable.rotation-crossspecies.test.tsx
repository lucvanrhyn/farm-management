// @vitest-environment jsdom
/**
 * __tests__/components/admin/CampsTable.rotation-crossspecies.test.tsx
 *
 * S25 (sp-M1) — the camps-overview rotation-metadata join is part of the
 * same cross-species camp surface as the list itself.
 *
 * `CampsTable` (server component behind `/admin/camps` and the per-species
 * namespace pages) joins veldType / rest-day overrides / rotation notes
 * onto the camp rows it was handed, keyed by `campId`. That lookup
 * previously routed through `scoped(prisma, mode)` — the active FarmMode
 * cookie — so any camp whose `species` tag differed from the cookie lost
 * its rotation metadata (rendered as `null` columns) even though the row
 * itself was displayed. Same divergence class PR #373 / #390 fixed on the
 * other camp surfaces; ADR-0005 makes `crossSpecies("farm-wide-audit")`
 * canonical for camp reads.
 *
 * Locking contract:
 *   1. The rotation-metadata camp.findMany carries no `where.species`.
 *   2. Rows handed to CampsTableClient keep rotation metadata for every
 *      camp in the list, regardless of the active FarmMode.
 */
import type React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Camp } from "@/lib/types";

const campFindManyMock = vi.fn();
const animalGroupByMock = vi.fn();
const getPrismaForFarmMock = vi.fn();
const getFarmModeMock = vi.fn();
const getLatestCampConditionsMock = vi.fn();

vi.mock("@/lib/farm-prisma", () => ({
  getPrismaForFarm: getPrismaForFarmMock,
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));
vi.mock("@/lib/server/get-farm-mode", () => ({ getFarmMode: getFarmModeMock }));
vi.mock("@/lib/server/camp-status", () => ({
  getLatestCampConditions: getLatestCampConditionsMock,
}));

// Capture the rows the server component computes for the client table.
type CapturedRow = {
  camp_id: string;
  veldType: string | null;
  restDaysOverride: number | null;
  maxGrazingDaysOverride: number | null;
  rotationNotes: string | null;
};
const clientCalls: Array<{ rows: CapturedRow[] }> = [];
vi.mock("@/components/admin/CampsTableClient", () => ({
  default: (props: { rows: CapturedRow[] }) => {
    clientCalls.push({ rows: props.rows });
    return null;
  },
}));

// Fixture: one cattle camp and one sheep camp, both carrying rotation
// metadata. The active FarmMode is cattle — the sheep camp's metadata
// must survive the join anyway.
const FIXTURE_DB_CAMPS = [
  {
    campId: "C1",
    species: "cattle" as const,
    veldType: "sweetveld",
    restDaysOverride: 30,
    maxGrazingDaysOverride: 7,
    rotationNotes: "cattle notes",
  },
  {
    campId: "S1",
    species: "sheep" as const,
    veldType: "sourveld",
    restDaysOverride: 45,
    maxGrazingDaysOverride: 5,
    rotationNotes: "sheep notes",
  },
];

const CAMPS_PROP: Camp[] = [
  { camp_id: "C1", camp_name: "Cattle Camp 1" },
  { camp_id: "S1", camp_name: "Sheep Camp 1" },
];

beforeEach(() => {
  vi.clearAllMocks();
  clientCalls.length = 0;
  getFarmModeMock.mockResolvedValue("cattle");
  getLatestCampConditionsMock.mockResolvedValue(new Map());
  animalGroupByMock.mockResolvedValue([]);
  getPrismaForFarmMock.mockResolvedValue({
    camp: { findMany: campFindManyMock },
    animal: { groupBy: animalGroupByMock },
  });
  // Faithful Prisma semantics: a `where.species` predicate filters rows;
  // absence of one returns every camp.
  campFindManyMock.mockImplementation(
    async (args?: { where?: { species?: string } }) => {
      const species = args?.where?.species;
      if (!species) return FIXTURE_DB_CAMPS;
      return FIXTURE_DB_CAMPS.filter((c) => c.species === species);
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderCampsTable() {
  const { default: CampsTable } = await import(
    "@/components/admin/CampsTable"
  );
  // Async server component — await the element, then render it so the
  // (mocked) client table receives its rows prop.
  const tree = await CampsTable({ camps: CAMPS_PROP, farmSlug: "trio-b" });
  render(tree as React.ReactElement);
}

describe("S25 (sp-M1) — CampsTable rotation-metadata join is cross-species", () => {
  it("rotation camp.findMany carries no where.species predicate", async () => {
    await renderCampsTable();

    expect(campFindManyMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of campFindManyMock.mock.calls) {
      const where = (call[0] as { where?: { species?: string } })?.where;
      expect(where?.species).toBeUndefined();
    }
  });

  it("keeps rotation metadata for camps of every species (the bug)", async () => {
    await renderCampsTable();

    expect(clientCalls.length).toBe(1);
    const byId = new Map(clientCalls[0].rows.map((r) => [r.camp_id, r]));

    // Active-mode camp keeps its metadata (no regression).
    expect(byId.get("C1")?.veldType).toBe("sweetveld");
    expect(byId.get("C1")?.restDaysOverride).toBe(30);

    // Off-mode camp must keep its metadata too — this was dropped when
    // the join went through scoped(prisma, mode).
    expect(byId.get("S1")?.veldType).toBe("sourveld");
    expect(byId.get("S1")?.restDaysOverride).toBe(45);
    expect(byId.get("S1")?.maxGrazingDaysOverride).toBe(5);
    expect(byId.get("S1")?.rotationNotes).toBe("sheep notes");
  });
});
