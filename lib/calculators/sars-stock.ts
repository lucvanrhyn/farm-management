/**
 * lib/calculators/sars-stock.ts
 *
 * Stock-block valuation + opening/closing movement summary for the SARS IT3
 * (ITR12 farming schedule).
 *
 * Source: First Schedule to the Income Tax Act 58/1962, paragraphs 2 + 3 + 5(1)
 * + 6 + 7. Standard values per GN R105 (1965) as amended by GN R1814 (1976),
 * reproduced in SARS Guide IT35 (2023-10-13) Annexure pp. 71-72. See
 * sars-livestock-values.ts for the full source pack.
 *
 * Pure module — no I/O, no Prisma, no side effects. Tested against
 * __tests__/calculators/sars-stock.test.ts.
 */

import {
  effectiveValue,
  lookupStandardValue,
  type ElectionRecord,
  type LivestockClass,
  type SarsSpecies,
  UnknownLivestockClassError,
} from "@/lib/calculators/sars-livestock-values";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AnimalSnapshot {
  species: string;
  ageCategory: string;
  count: number;
  acquisitionMode?:
    | "natural_increase"
    | "purchase"
    | "inheritance"
    | "donation"
    | "private_to_farm";
}

export interface StockBlockLine {
  species: string;
  ageCategory: string;
  count: number;
  standardValueZar: number;
  /** standardValueZar with election applied if any. */
  effectiveValueZar: number;
  subtotalZar: number;
  source: string;
}

export interface StockBlockTotal {
  lines: StockBlockLine[];
  totalZar: number;
  /** True iff at least one election was applied to a non-zero-count line. */
  electionApplied: boolean;
}

export interface StockMovementSummary {
  openingStockValueZar: number;
  closingStockValueZar: number;
  /** closing - opening; positive when herd grew. */
  deltaZar: number;
}

// ── Election lookup helper ───────────────────────────────────────────────────

function findElection(
  elections: ElectionRecord[],
  species: string,
  ageCategory: string,
): ElectionRecord | null {
  return (
    elections.find(
      (e) => e.species === species && e.ageCategory === ageCategory,
    ) ?? null
  );
}

// ── valueStockBlock ──────────────────────────────────────────────────────────

/**
 * Value a single point-in-time stock block (opening OR closing) at standard
 * values, applying any per-class elections within ±20% per paragraph 6.
 */
export function valueStockBlock(
  snapshot: AnimalSnapshot[],
  elections: ElectionRecord[],
): StockBlockTotal {
  const lines: StockBlockLine[] = [];
  let total = 0;
  let electionApplied = false;

  for (const item of snapshot) {
    const cls: LivestockClass = {
      species: item.species as SarsSpecies,
      ageCategory: item.ageCategory,
    };
    const standard = lookupStandardValue(cls);
    const election = findElection(elections, item.species, item.ageCategory);
    const effective = election ? effectiveValue({ class: cls, election }) : standard;
    const subtotal = effective * item.count;

    if (election && item.count > 0 && effective !== standard) {
      electionApplied = true;
    }

    lines.push({
      species: item.species,
      ageCategory: item.ageCategory,
      count: item.count,
      standardValueZar: standard,
      effectiveValueZar: effective,
      subtotalZar: subtotal,
      source:
        "GN R105 (1965) as amended by GN R1814 (1976) / IT35 (2023-10-13) Annexure",
    });

    total += subtotal;
  }

  return { lines, totalZar: total, electionApplied };
}

// ── summariseStockMovement ───────────────────────────────────────────────────

/**
 * Compare opening and closing stock blocks valued at standard values
 * (+ elections) and return the delta. The delta rolls into netFarmingIncome
 * via paragraph 5(1) read with paragraph 3:
 *
 *   net = grossSales + (closingStock − openingStock) − allowableDeductions
 */
export function summariseStockMovement(
  opening: AnimalSnapshot[],
  closing: AnimalSnapshot[],
  elections: ElectionRecord[],
): StockMovementSummary {
  const openingTotal = valueStockBlock(opening, elections).totalZar;
  const closingTotal = valueStockBlock(closing, elections).totalZar;
  return {
    openingStockValueZar: openingTotal,
    closingStockValueZar: closingTotal,
    deltaZar: closingTotal - openingTotal,
  };
}

// ── FarmTrack -> SARS class mapper ───────────────────────────────────────────

export interface MapInput {
  farmTrackCategory: string;
  species: string;
  birthDate: string | null;
  asOfDate: Date;
}

const MS_PER_YEAR = 365.2425 * 24 * 60 * 60 * 1000;

function ageYears(birthDate: string | null, asOfDate: Date): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  const ms = asOfDate.getTime() - birth.getTime();
  return ms / MS_PER_YEAR;
}

/**
 * Map a FarmTrack `Animal.category` + species + birthDate to the SARS
 * gazetted livestock class. Throws UnknownLivestockClassError when the
 * category cannot be resolved — the caller (IT3 PDF renderer) surfaces those
 * head-counts as "uncategorised — taxpayer to value" rather than silently
 * dropping or defaulting them.
 *
 * Game is passed through verbatim: any species==="game" maps to game/<cat>
 * which the standard-value lookup turns into a R0 nil entry.
 */
export function mapFarmTrackCategoryToSarsClass(input: MapInput): LivestockClass {
  const cat = input.farmTrackCategory.trim();
  const species = input.species.toLowerCase();

  if (species === "game") {
    return { species: "game", ageCategory: cat };
  }

  if (species === "cattle") {
    if (cat === "Bull") return { species: "cattle", ageCategory: "Bulls" };
    if (cat === "Cow") return { species: "cattle", ageCategory: "Cows" };
    if (cat === "Ox") return { species: "cattle", ageCategory: "Oxen" };
    if (cat === "Calf") return { species: "cattle", ageCategory: "Calves" };
    if (cat === "Heifer") {
      const yrs = ageYears(input.birthDate, input.asOfDate);
      if (yrs === null) {
        // Unknown age — default to the more conservative 1-2 year band.
        return { species: "cattle", ageCategory: "Tollies & heifers 1-2 years" };
      }
      if (yrs < 1) return { species: "cattle", ageCategory: "Calves" };
      if (yrs < 2) return { species: "cattle", ageCategory: "Tollies & heifers 1-2 years" };
      if (yrs < 3) return { species: "cattle", ageCategory: "Tollies & heifers 2-3 years" };
      return { species: "cattle", ageCategory: "Cows" };
    }
    throw new UnknownLivestockClassError({ species: "cattle", ageCategory: cat });
  }

  if (species === "sheep") {
    if (cat === "Ram") return { species: "sheep", ageCategory: "Rams" };
    if (cat === "Ewe" || cat === "Maiden Ewe" || cat === "Ewe Lamb") {
      // Ewe Lambs are weaned but not yet served — treat as weaned lambs
      // unless they have explicitly aged into the Ewe category.
      if (cat === "Ewe Lamb") {
        return { species: "sheep", ageCategory: "Weaned lambs" };
      }
      return { species: "sheep", ageCategory: "Ewes" };
    }
    if (cat === "Wether") return { species: "sheep", ageCategory: "Wethers" };
    if (cat === "Lamb" || cat === "Hogget") return { species: "sheep", ageCategory: "Weaned lambs" };
    throw new UnknownLivestockClassError({ species: "sheep", ageCategory: cat });
  }

  if (species === "goats") {
    if (cat === "Kid") return { species: "goats", ageCategory: "Weaned kids" };
    return { species: "goats", ageCategory: "Fully grown" };
  }

  // For any other species, pass the category through and let the lookup throw
  // if the (species, category) pair isn't gazetted.
  return { species: species as SarsSpecies, ageCategory: cat };
}
