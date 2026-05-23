// components/admin/observations-log/parseDetails.ts
// Pure functions for turning a raw `details` JSON string into a human-
// readable summary line. Tolerates camelCase / snake_case because the
// Logger and importers have historically used both.
//
// Issue #394 (PRD #389 W5)
// ────────────────────────
//   For every persistence-canonical type (`OBSERVATION_TYPE_LIST`) the
//   summary logic lives in `./registry.ts`. This file:
//
//     - re-exports `parseDetails(raw, type)` as the historical entry
//       point used by existing tests + the legacy aliases (`fawning`,
//       `rainfall`, `predator_loss`, `camp_move`, `joining`, `heat`,
//       `famacha`, `fostering`, `camp_cover`) that are NOT in the
//       canonical persistence list but still flow through the admin UI
//       from imports / older Logger versions.
//
//   The dead `"Details recorded"` placeholder that used to leak through
//   for unknown types has been removed (#394). The generic fallback now
//   sweeps any recognisable keys into a `key: value` line — see
//   `parseObservationDetails` in `./registry.ts`.

import { parseObservationDetails } from "./registry";

/**
 * Pull the first non-empty value from a set of candidate keys on an
 * observation details object. Returns `undefined` if no candidate has a
 * meaningful (non-null/non-empty) value.
 */
function pick(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return undefined;
}

export function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Legacy aliases — observation types that are NOT in the canonical
 * `OBSERVATION_TYPE_LIST` but still appear in imported / older-Logger
 * records. The registry covers the canonical set; this set covers the
 * tail. Either path returns a non-placeholder summary.
 */
const LEGACY_ALIASES = new Set<string>([
  "camp_move",
  "fawning",
  "rainfall",
  "predator_loss",
  "joining",
  "heat",
  "famacha",
  "fostering",
  "camp_cover",
]);

function parseLegacyAlias(raw: string, type: string): string | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) obj = {};
  } catch {
    return raw.slice(0, 120);
  }

  switch (type) {
    case "camp_move": {
      const animalId = pick(obj, "animalId", "animal_id", "mobId", "mob_id") ?? "?";
      const src = pick(obj, "sourceCampId", "source_camp_id", "from_camp", "fromCamp");
      const dest = pick(obj, "destCampId", "dest_camp_id", "to_camp", "toCamp") ?? "?";
      return src
        ? `🔄 ${animalId} moved: ${src} → ${dest}`
        : `🔄 Moved to Camp ${dest}`;
    }
    case "fawning": {
      const species = pick(obj, "species", "game_species", "animal_species");
      const fawnCount = pick(obj, "fawn_count", "fawnCount");
      const parts: string[] = [];
      if (species) parts.push(`Species: ${species}`);
      if (fawnCount) parts.push(`Fawns: ${fawnCount}`);
      return parts.length ? `👶 Fawning — ${parts.join(" · ")}` : "👶 Fawning recorded";
    }
    case "rainfall": {
      const mm = pick(obj, "mm", "rainfall_mm", "rainfallMm", "amount_mm");
      return mm ? `🌧️ ${mm} mm` : "🌧️ Rainfall recorded";
    }
    case "predator_loss": {
      const predator = pick(obj, "predator_species", "predatorSpecies", "predator");
      const count = pick(obj, "count", "animals_lost", "animalsLost");
      const parts: string[] = [];
      if (predator) parts.push(`Species: ${predator}`);
      if (count) parts.push(`Lost: ${count}`);
      return parts.length ? `🦁 Predator loss — ${parts.join(" · ")}` : "🦁 Predator loss";
    }
    case "joining": {
      const method = pick(obj, "method") ?? "Service";
      const sire = pick(obj, "sire_id", "sireId", "ramId", "ram_id");
      return sire ? `💉 ${method} — Sire: ${sire}` : `💉 ${method}`;
    }
    case "heat": {
      const intensity = pick(obj, "intensity", "method", "strength") ?? "observed";
      return `❤️ Heat detected — ${intensity}`;
    }
    case "famacha": {
      const score = pick(obj, "score", "famacha_score");
      return score ? `FAMACHA score: ${score}` : "FAMACHA scored";
    }
    case "fostering": {
      const foster = pick(obj, "foster_mother", "fosterMother", "to_mother");
      return foster ? `Fostered to ${foster}` : "Fostering recorded";
    }
    case "camp_cover": {
      const kg = pick(obj, "cover_kg_ha", "coverKgHa", "kg_ha");
      return kg ? `Cover: ${kg} kg DM/ha` : "Cover reading";
    }
    default:
      return null;
  }
}

/**
 * Historical entry point preserved for callers that import `parseDetails`
 * from `@/components/admin/ObservationsLog`. New code should call
 * `parseObservationDetails(type, raw)` from `./registry.ts` directly.
 *
 * Resolution order:
 *   1. Legacy alias (not in `OBSERVATION_TYPE_LIST`) — handled here.
 *   2. Canonical type — delegated to the registry.
 *   3. Malformed JSON for an unknown type — truncate the raw string.
 *
 * #394 — the dead `"Details recorded"` generic-fallback string has been
 * removed; the registry's fallback sweeps recognisable keys instead.
 */
export function parseDetails(raw: string, type?: string): string {
  if (type && LEGACY_ALIASES.has(type)) {
    const out = parseLegacyAlias(raw, type);
    if (out !== null) return out;
  }
  // Validate JSON shape up front so an unknown type with malformed JSON
  // matches the historical "truncated raw" behaviour rather than the
  // registry's heuristic sweep.
  let isValidObj = false;
  try {
    const parsed = JSON.parse(raw);
    isValidObj = !!parsed && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    isValidObj = false;
  }
  if (!isValidObj) return raw.slice(0, 120);

  return parseObservationDetails(type ?? "", raw);
}
