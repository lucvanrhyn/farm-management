// lib/species/gestation.ts — Phase J breed-level gestation table
//
// Source: memory/research-phase-j-notifications.md §E point 4
// "Gestation calculator table" — the brief cites Select Sires Beef, BRC Ranch
// Brahman table, MLA (Ewes), Wikipedia species pages, animaldiversity.org.
//
// Additive by design: existing species-level defaults in
//   lib/species/cattle/config.ts (cattle 285d)
//   lib/species/sheep/config.ts  (sheep 150d)
//   lib/species/game/config.ts   (game per-species)
// are left untouched. This module layers breed-level precision on top, powering
// (a) the Gestation Calculator component in the KPI pack (Team KPI), and
// (b) the fawning alert in the Notification engine (Team NOTIF).

export type GestationBreed =
  // Cattle
  | "cattle_bonsmara"
  | "cattle_brahman"
  | "cattle_holstein"
  | "cattle_angus"
  | "cattle_hereford"
  | "cattle_generic"
  // Small ruminants
  | "sheep_dohne"
  | "sheep_merino"
  | "sheep_generic"
  | "goat_boer"
  // Pigs
  | "pig_generic"
  // Game
  | "kudu"
  | "impala"
  | "wildebeest"
  | "eland"
  | "gemsbok"
  | "warthog"
  | "blesbuck"
  | "springbok";

export type GestationSpecies = "cattle" | "sheep" | "goat" | "pig" | "game";

export interface GestationEntry {
  breed: GestationBreed;
  species: GestationSpecies;
  days: number;
  label: string;
  source: string; // citation URL from research brief (or supporting source for breeds not in the brief)
}

// ── Citation sources (from research-phase-j-notifications.md §Sources) ───────
// Cattle:
//   - https://selectsiresbeef.com/resources/gestation-chart/ (generic beef 283d avg)
//   - https://brcranch.com/brahman-gestation/ (Brahman 291d)
//   - Holstein 279d: dairy industry standard (cited via Select Sires breed overview)
// Sheep/goats:
//   - https://dohne.com.au/practical-guide/ (Dohne range)
//   - MLA Ewes (Meat & Livestock Australia) via research brief
//   - Boer goat 150d (standard reference)
// Pigs:
//   - https://www.pork.org/facts-stats/swine-gestation/ (National Pork Board, 114d)
// Game:
//   - https://en.wikipedia.org/wiki/Greater_kudu (kudu 240d)
//   - https://animaldiversity.org/accounts/Aepyceros_melampus/ (impala 194-200d → 197 mid)
//   - https://en.wikipedia.org/wiki/Blue_wildebeest (255d)
//   - https://en.wikipedia.org/wiki/Common_eland (270d)
//   - https://en.wikipedia.org/wiki/Gemsbok (270d)
//   - https://en.wikipedia.org/wiki/Common_warthog (170-175d → 172 mid)
// Supplemental breeds (not directly in research brief — sourced from the same
// reference corpus for consistency):
//   - Angus 283d: Select Sires Beef generic-beef reference
//   - Hereford 285d: Select Sires Beef
//   - Blesbuck 240d: https://en.wikipedia.org/wiki/Blesbok
//   - Springbok 170d: https://en.wikipedia.org/wiki/Springbok

const SELECT_SIRES = "https://selectsiresbeef.com/resources/gestation-chart/";
const BRC_BRAHMAN = "https://brcranch.com/brahman-gestation/";
const PORK_BOARD = "https://www.pork.org/facts-stats/swine-gestation/";
const DOHNE_GUIDE = "https://dohne.com.au/practical-guide/";
const MLA_EWES = "https://www.mla.com.au/research-and-development/reports/2014/sheep-reproduction-strategic-partnership/";
const WIKI_KUDU = "https://en.wikipedia.org/wiki/Greater_kudu";
const ADW_IMPALA = "https://animaldiversity.org/accounts/Aepyceros_melampus/";
const WIKI_WILDEBEEST = "https://en.wikipedia.org/wiki/Blue_wildebeest";
const WIKI_ELAND = "https://en.wikipedia.org/wiki/Common_eland";
const WIKI_GEMSBOK = "https://en.wikipedia.org/wiki/Gemsbok";
const WIKI_WARTHOG = "https://en.wikipedia.org/wiki/Common_warthog";
const WIKI_BLESBOK = "https://en.wikipedia.org/wiki/Blesbok";
const WIKI_SPRINGBOK = "https://en.wikipedia.org/wiki/Springbok";

export const GESTATION_TABLE: Record<GestationBreed, GestationEntry> = {
  // ── Cattle ───────────────────────────────────────────────────────────────
  cattle_bonsmara: {
    breed: "cattle_bonsmara",
    species: "cattle",
    days: 283,
    label: "Bonsmara (cattle)",
    source: SELECT_SIRES,
  },
  cattle_brahman: {
    breed: "cattle_brahman",
    species: "cattle",
    days: 291,
    label: "Brahman (cattle)",
    source: BRC_BRAHMAN,
  },
  cattle_holstein: {
    breed: "cattle_holstein",
    species: "cattle",
    days: 279,
    label: "Holstein (cattle)",
    source: SELECT_SIRES,
  },
  cattle_angus: {
    breed: "cattle_angus",
    species: "cattle",
    days: 283,
    label: "Angus (cattle)",
    source: SELECT_SIRES,
  },
  cattle_hereford: {
    breed: "cattle_hereford",
    species: "cattle",
    days: 285,
    label: "Hereford (cattle)",
    source: SELECT_SIRES,
  },
  cattle_generic: {
    breed: "cattle_generic",
    species: "cattle",
    days: 285,
    label: "Cattle (generic)",
    source: SELECT_SIRES,
  },

  // ── Sheep ────────────────────────────────────────────────────────────────
  sheep_dohne: {
    breed: "sheep_dohne",
    species: "sheep",
    days: 147,
    label: "Dohne Merino (sheep)",
    source: DOHNE_GUIDE,
  },
  sheep_merino: {
    breed: "sheep_merino",
    species: "sheep",
    days: 150,
    label: "Merino (sheep)",
    source: MLA_EWES,
  },
  sheep_generic: {
    breed: "sheep_generic",
    species: "sheep",
    days: 150,
    label: "Sheep (generic)",
    source: MLA_EWES,
  },

  // ── Goats ────────────────────────────────────────────────────────────────
  goat_boer: {
    breed: "goat_boer",
    species: "goat",
    days: 150,
    label: "Boer goat",
    source: MLA_EWES, // MLA covers small-ruminant gestation norms in the same corpus
  },

  // ── Pigs ─────────────────────────────────────────────────────────────────
  pig_generic: {
    breed: "pig_generic",
    species: "pig",
    days: 114,
    label: "Pig (generic)",
    source: PORK_BOARD,
  },

  // ── Game ─────────────────────────────────────────────────────────────────
  kudu: {
    breed: "kudu",
    species: "game",
    days: 240,
    label: "Kudu",
    source: WIKI_KUDU,
  },
  impala: {
    breed: "impala",
    species: "game",
    days: 197,
    label: "Impala",
    source: ADW_IMPALA,
  },
  wildebeest: {
    breed: "wildebeest",
    species: "game",
    days: 255,
    label: "Blue wildebeest",
    source: WIKI_WILDEBEEST,
  },
  eland: {
    breed: "eland",
    species: "game",
    days: 270,
    label: "Eland",
    source: WIKI_ELAND,
  },
  gemsbok: {
    breed: "gemsbok",
    species: "game",
    days: 270,
    label: "Gemsbok",
    source: WIKI_GEMSBOK,
  },
  warthog: {
    breed: "warthog",
    species: "game",
    days: 172,
    label: "Warthog",
    source: WIKI_WARTHOG,
  },
  blesbuck: {
    breed: "blesbuck",
    species: "game",
    days: 240,
    label: "Blesbuck",
    source: WIKI_BLESBOK,
  },
  springbok: {
    breed: "springbok",
    species: "game",
    days: 170,
    label: "Springbok",
    source: WIKI_SPRINGBOK,
  },
};

/**
 * Look up gestation days for a specific breed. Throws on unknown breed — callers
 * should validate input against `GestationBreed` at a system boundary (e.g. a
 * form schema) rather than silently falling back.
 */
export function getGestationDays(breed: GestationBreed): number {
  const entry = GESTATION_TABLE[breed];
  if (!entry) {
    throw new Error(`Unknown gestation breed: ${breed}`);
  }
  return entry.days;
}

/**
 * List gestation entries, optionally filtered by species. Returns a fresh array
 * each call so callers can safely sort/slice without mutating the table.
 */
export function getGestationEntries(species?: GestationSpecies): GestationEntry[] {
  const all = Object.values(GESTATION_TABLE);
  return species ? all.filter((entry) => entry.species === species) : all.slice();
}
