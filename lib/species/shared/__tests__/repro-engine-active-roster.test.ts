/**
 * @vitest-environment node
 *
 * repro-engine — the cattle/game reproduction analytics engine.
 *
 * REGRESSION (dead-engine, live since 2026-04): the engine derived its
 * observation-join id-set from the cuid `Animal.id`, but `Observation.animalId`
 * stores the human TAG (`Animal.animalId @unique`). cuid ∩ tag = ∅, so EVERY
 * observation query returned empty and the cattle dashboard's four calving /
 * open-cow alert chips (cattleModule.getAlerts) were silently dead in prod —
 * see gotcha-observation-animalid-is-tag-not-cuid. The mock-masked
 * cattle/__tests__/alerts-active-roster.test.ts stubs the engine, so nothing
 * caught it. This test drives the REAL engine through a behaviour-faithful fake
 * prisma (real scoped()/crossSpecies merge logic), so it fails on the cuid bug.
 *
 * Two invariants, both required:
 *   1. an ACTIVE cow with an insemination ~gestation-ago surfaces as an
 *      upcoming birth (the resurrection — fails while keyed on cuid).
 *   2. a since-DECEASED cow with the same retained insemination is EXCLUDED
 *      from upcoming births (ADR-0010 active-roster intersection — else the
 *      resurrection re-introduces the deceased/sold/culled leak class that
 *      PR #577 closed everywhere else).
 */
import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getReproStatsForSpecies } from "../repro-engine";
import { cattleModule, CATTLE_CONFIG } from "@/lib/species/cattle";

const CONFIG = {
  gestationDays: CATTLE_CONFIG.gestationDays,
  voluntaryWaitingDays: CATTLE_CONFIG.voluntaryWaitingDays,
  estrusCycleDays: CATTLE_CONFIG.estrusCycleDays,
  heatObsType: "heat_detection",
  inseminationObsType: "insemination",
  pregnancyScanObsType: "pregnancy_scan",
  birthObsType: "calving",
  species: "cattle",
} as const;

type Row = Record<string, unknown>;

/** Faithful-enough fake: honours flat equality, {in}, {gte}, {not}, and orderBy. */
function makeFakePrisma(data: { animals: Row[]; observations: Row[]; camps: Row[] }) {
  const match = (row: Row, where: Row | undefined): boolean => {
    for (const [k, v] of Object.entries(where ?? {})) {
      const cell = row[k];
      if (v && typeof v === "object") {
        const cond = v as Record<string, unknown>;
        if ("in" in cond && !(cond.in as unknown[]).includes(cell)) return false;
        if ("gte" in cond && !((cell as Date) >= (cond.gte as Date))) return false;
        if ("not" in cond && cell === cond.not) return false;
      } else if (cell !== v) {
        return false;
      }
    }
    return true;
  };
  const query = (rows: Row[], args: { where?: Row; orderBy?: { observedAt?: "asc" | "desc" } } = {}) => {
    let out = rows.filter((r) => match(r, args.where));
    const dir = args.orderBy?.observedAt;
    if (dir) {
      out = [...out].sort((a, b) => {
        const d = (a.observedAt as Date).getTime() - (b.observedAt as Date).getTime();
        return dir === "desc" ? -d : d;
      });
    }
    return Promise.resolve(out);
  };
  return {
    animal: { findMany: (args?: { where?: Row }) => query(data.animals, args) },
    observation: { findMany: (args?: { where?: Row; orderBy?: { observedAt?: "asc" | "desc" } }) => query(data.observations, args) },
    camp: { findMany: () => Promise.resolve(data.camps) },
  } as unknown as PrismaClient;
}

const DAY = 86_400_000;
// insemination so calving lands ~5 days out → "due within 7 days" tier.
const insemDate = new Date(Date.now() - (CONFIG.gestationDays - 5) * DAY);

const camps = [{ campId: "C1", campName: "Rivier", species: "cattle" }];
const insemObs = (tag: string) => ({
  id: `obs-${tag}`,
  type: "insemination",
  animalId: tag, // ← Observation.animalId is the TAG, not the cuid
  campId: "C1",
  observedAt: insemDate,
  loggedBy: "tester",
  details: JSON.stringify({ method: "AI" }),
  species: "cattle",
});

describe("repro-engine — resurrection + active-roster intersection", () => {
  it("surfaces an ACTIVE cow's upcoming calving (dead while keyed on cuid)", async () => {
    const prisma = makeFakePrisma({
      animals: [{ id: "cuid-active", animalId: "COW-ACTIVE", species: "cattle", status: "Active" }],
      observations: [insemObs("COW-ACTIVE")],
      camps,
    });
    const stats = await getReproStatsForSpecies(prisma, CONFIG);
    const tags = stats.upcomingBirths.map((b) => b.animalId);
    expect(tags).toContain("COW-ACTIVE");
  });

  it("EXCLUDES a since-deceased cow's retained insemination from upcoming calvings", async () => {
    const prisma = makeFakePrisma({
      animals: [
        { id: "cuid-active", animalId: "COW-ACTIVE", species: "cattle", status: "Active" },
        { id: "cuid-dead", animalId: "COW-DEAD", species: "cattle", status: "Deceased" },
      ],
      observations: [insemObs("COW-ACTIVE"), insemObs("COW-DEAD")],
      camps,
    });
    const stats = await getReproStatsForSpecies(prisma, CONFIG);
    const tags = stats.upcomingBirths.map((b) => b.animalId);
    expect(tags).toContain("COW-ACTIVE");
    expect(tags).not.toContain("COW-DEAD");
  });

  it("lights up the cattle dashboard calving chip for the active cow only", async () => {
    const prisma = makeFakePrisma({
      animals: [
        { id: "cuid-active", animalId: "COW-ACTIVE", species: "cattle", status: "Active" },
        { id: "cuid-dead", animalId: "COW-DEAD", species: "cattle", status: "Deceased" },
      ],
      observations: [insemObs("COW-ACTIVE"), insemObs("COW-DEAD")],
      camps,
    });
    const alerts = await cattleModule.getAlerts(prisma, "trio-b", {
      adgPoorDoerThreshold: 0.7,
      calvingAlertDays: 14,
      daysOpenLimit: 365,
    });
    const calving = alerts.find((a) => a.id === "calvings-due-7d");
    expect(calving?.count).toBe(1); // the active cow, not the deceased one
  });

  it("counts OPEN cows from the active roster only (deceased excluded)", async () => {
    // Both cows calved 200d ago with no reconception → daysOpen=null/isExtended.
    // Once the engine is alive, the open-cows COUNT must exclude the deceased
    // one (ADR-0010), mirroring the poor-doer intersection in the same fn.
    const calvingDate = new Date(Date.now() - 200 * DAY);
    const calving = (tag: string) => ({
      id: `calf-${tag}`,
      type: "calving",
      animalId: tag,
      campId: "C1",
      observedAt: calvingDate,
      loggedBy: "tester",
      details: JSON.stringify({ calf_status: "live" }),
      species: "cattle",
    });
    const prisma = makeFakePrisma({
      animals: [
        { id: "cuid-oa", animalId: "OPEN-ACTIVE", species: "cattle", status: "Active" },
        { id: "cuid-od", animalId: "OPEN-DEAD", species: "cattle", status: "Deceased" },
      ],
      observations: [calving("OPEN-ACTIVE"), calving("OPEN-DEAD")],
      camps,
    });
    const alerts = await cattleModule.getAlerts(prisma, "trio-b", {
      adgPoorDoerThreshold: 0.7,
      calvingAlertDays: 14,
      daysOpenLimit: 365,
    });
    const openCows = alerts.find((a) => a.id === "open-cows");
    expect(openCows?.count).toBe(1); // OPEN-ACTIVE only, not OPEN-DEAD
  });
});
