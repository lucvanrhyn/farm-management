/**
 * lib/server/inventory-replay.ts
 *
 * Reconstructs the opening (1 March) and closing (28/29 February) livestock
 * inventory for a SA tax year by replaying Animal + Observation rows.
 *
 * The output is two grouped (species, ageCategory) snapshots that can be fed
 * to summariseStockMovement() in lib/calculators/sars-stock.ts to produce the
 * stock-movement delta required by First Schedule paragraph 5(1).
 *
 * Design — minimal Prisma surface:
 *   The module accepts a tiny `InventoryReplayPrisma` interface (animal +
 *   observation `findMany`) rather than the full PrismaClient, so the algorithm
 *   can be unit-tested with a stub. Production callers pass the per-tenant
 *   PrismaClient — the structural type matches.
 *
 * Source: First Schedule paragraph 5(1) read with paragraph 2 + IT35 §3.4.
 *   - Natural increase (births during the year) appear in CLOSING stock at
 *     standard value; they are NOT in OPENING stock.
 *   - Deaths drop out of CLOSING stock entirely; they remain in OPENING stock
 *     (they were alive on 1 March).
 *   - Sales (Animal.status === "Sold" or animal_movement obs with sold flag)
 *     mirror deaths.
 */

import {
  mapFarmTrackCategoryToSarsClass,
  type AnimalSnapshot,
} from "@/lib/calculators/sars-stock";
import {
  UnknownLivestockClassError,
} from "@/lib/calculators/sars-livestock-values";
import { getSaTaxYearRange } from "@/lib/calculators/sars-it3";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AnimalRow {
  id: string;
  animalId: string;
  species: string;
  category: string;
  status: string;
  /** ISO YYYY-MM-DD or full ISO string */
  dateAdded: string;
  /** ISO YYYY-MM-DD or null */
  dateOfBirth: string | null;
  /** ISO YYYY-MM-DD or null */
  deceasedAt: string | null;
}

export interface ObservationRow {
  id: string;
  type: string;
  animalId: string | null;
  observedAt: Date | string;
  details?: string;
}

/**
 * Tiny prisma-shaped contract this module needs. The real PrismaClient
 * structurally satisfies this — no factory or wrapper required at the call
 * site.
 */
export interface InventoryReplayPrisma {
  animal: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany(args?: any): Promise<AnimalRow[]>;
  };
  observation: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany(args?: any): Promise<ObservationRow[]>;
  };
}

export interface ReconstructResult {
  yearStart: string;
  yearEnd: string;
  opening: AnimalSnapshot[];
  closing: AnimalSnapshot[];
  /** Animals that could not be mapped to a SARS class — surfaced separately. */
  unmapped: Array<{ id: string; animalId: string; species: string; category: string; reason: string }>;
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function toIsoDate(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (typeof v === "string") return v.length >= 10 ? v.slice(0, 10) : v;
  return v.toISOString().slice(0, 10);
}

// ── Replay logic ─────────────────────────────────────────────────────────────

/**
 * Replay rules (per AnimalRow, against the [yearStart, yearEnd] window):
 *
 *   IN_CLOSING = (status === "Active") AND dateAdded ≤ yearEnd AND
 *                (no death/sale/dispatch event for this animal ≤ yearEnd)
 *
 *   IN_OPENING = (dateAdded ≤ yearStart) AND
 *                (no death/sale/dispatch event for this animal ≤ yearStart)
 *
 * Notes:
 *   - dateAdded for natural-increase animals equals dateOfBirth (per the
 *     existing logger: `dateAdded: data.dateOfBirth`). So an animal born
 *     mid-year is correctly excluded from opening (dateAdded > yearStart) and
 *     included in closing (dateAdded ≤ yearEnd).
 *   - Sold animals have status === "Sold". When an explicit sale observation
 *     is present we use its observedAt date; when absent we fall back to
 *     "removed at yearEnd" — conservative. We bias toward including the
 *     animal in OPENING when status is Sold/Deceased and we know they were
 *     alive at yearStart (deceasedAt > yearStart, or no deceasedAt + dateAdded
 *     ≤ yearStart).
 */
export async function reconstructStockSnapshots(
  prisma: InventoryReplayPrisma,
  taxYearEndingIn: number,
): Promise<ReconstructResult> {
  const { start, end } = getSaTaxYearRange(taxYearEndingIn);
  const yearEndDate = new Date(`${end}T23:59:59.999Z`);

  // SARS IT3 inventory replay must scan every Animal row for the tenant —
  // First Schedule paragraph 5(1) requires opening + closing snapshots that
  // include every animal alive at any point in the tax year. Bounding by
  // `take` would silently truncate the return and falsify the tax filing.
  // audit-allow-findmany: full-tenant scan required by tax-law contract
  const animals = await prisma.animal.findMany({
    select: {
      id: true,
      animalId: true,
      species: true,
      category: true,
      status: true,
      dateAdded: true,
      dateOfBirth: true,
      deceasedAt: true,
    },
  });

  // Pull all exit-event observations for these animals within the tax-year
  // window. Used to time-anchor sales/dispatches that don't carry a deceasedAt.
  const exitTypes = ["death", "predation_loss", "game_mortality", "game_predation", "animal_movement"];
  const animalIds = animals.map((a) => a.id);
  let exitObsRaw: ObservationRow[] = [];
  if (animalIds.length > 0) {
    // Bounded by animalIds (capped by the animal scan above) AND by the SA
    // tax-year window — full population is required to reproduce paragraph
    // 5(1) opening/closing reconciliation faithfully.
    // audit-allow-findmany: bounded by animalIds + tax-year date window
    exitObsRaw = await prisma.observation.findMany({
      where: {
        type: { in: exitTypes },
        animalId: { in: animalIds },
        observedAt: { gte: start, lte: end },
      },
      select: { id: true, type: true, animalId: true, observedAt: true, details: true },
    });
  }

  // Map: animalId -> earliest exit date (ISO YYYY-MM-DD) within the year.
  const exitDateByAnimal = new Map<string, string>();
  for (const obs of exitObsRaw) {
    if (!obs.animalId) continue;
    // animal_movement is only an exit when details indicate a sold/dispatched/transferred-out direction.
    if (obs.type === "animal_movement") {
      const details = obs.details ?? "";
      const isExit =
        /"direction"\s*:\s*"(?:sold|dispatched|transferred[_-]?out|out)"/i.test(details) ||
        /"sold"\s*:\s*true/i.test(details) ||
        /"dispatched"\s*:\s*true/i.test(details);
      if (!isExit) continue;
    }
    const iso = toIsoDate(obs.observedAt);
    if (!iso) continue;
    const prev = exitDateByAnimal.get(obs.animalId);
    if (!prev || iso < prev) {
      exitDateByAnimal.set(obs.animalId, iso);
    }
  }

  const openingAcc = new Map<string, AnimalSnapshot>();
  const closingAcc = new Map<string, AnimalSnapshot>();
  const unmapped: ReconstructResult["unmapped"] = [];

  function addToAcc(
    acc: Map<string, AnimalSnapshot>,
    animal: AnimalRow,
    asOf: Date,
  ): void {
    let cls;
    try {
      cls = mapFarmTrackCategoryToSarsClass({
        farmTrackCategory: animal.category,
        species: animal.species,
        birthDate: animal.dateOfBirth,
        asOfDate: asOf,
      });
    } catch (err) {
      if (err instanceof UnknownLivestockClassError) {
        unmapped.push({
          id: animal.id,
          animalId: animal.animalId,
          species: animal.species,
          category: animal.category,
          reason: err.message,
        });
        return;
      }
      throw err;
    }
    const key = `${cls.species}/${cls.ageCategory}`;
    const existing = acc.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      acc.set(key, {
        species: cls.species,
        ageCategory: cls.ageCategory,
        count: 1,
      });
    }
  }

  const yearStartDate = new Date(`${start}T00:00:00.000Z`);

  for (const animal of animals) {
    const dateAdded = toIsoDate(animal.dateAdded);
    if (!dateAdded) continue;

    const deceasedAt = toIsoDate(animal.deceasedAt);
    const exitDate = deceasedAt ?? exitDateByAnimal.get(animal.id) ?? null;

    // ── Closing inventory (at yearEnd) ──
    // Animal counts at closing iff: addedOn ≤ yearEnd AND no exit ≤ yearEnd
    // AND status is Active (a Sold/Deceased animal without exit-date evidence
    // is conservatively treated as exited at or before yearEnd).
    const inClosing =
      dateAdded <= end &&
      (!exitDate || exitDate > end) &&
      animal.status === "Active";
    if (inClosing) {
      addToAcc(closingAcc, animal, yearEndDate);
    }

    // ── Opening inventory (at yearStart) ──
    // Animal counts at opening iff: addedOn ≤ yearStart AND
    //   (no exit OR exit > yearStart)
    // Status doesn't filter opening — the animal was alive on 1 March even if
    // it has since died/been sold (that's exactly why opening differs from
    // closing).
    const wasAliveAtYearStart =
      dateAdded <= start && (!exitDate || exitDate > start);
    if (wasAliveAtYearStart) {
      addToAcc(openingAcc, animal, yearStartDate);
    }
  }

  return {
    yearStart: start,
    yearEnd: end,
    opening: [...openingAcc.values()],
    closing: [...closingAcc.values()],
    unmapped,
  };
}
