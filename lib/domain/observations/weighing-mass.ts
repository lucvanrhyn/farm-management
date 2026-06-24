// lib/domain/observations/weighing-mass.ts
//
// SINGLE source of truth for reading a weighing observation's mass in kg.
//
// Weighings are persisted under TWO key conventions because two write paths
// build the `details` JSON independently:
//   - logger / admin modal  → snake_case  { weight_kg: <n> }
//       (app/[farmSlug]/logger/[campId]/page.tsx)
//   - task-completion        → camelCase   { weightKg:  <n> }
//       (lib/tasks/observation-mapping.ts)
//
// A reader that knows only one key silently drops every weighing written by the
// other path. That "snake-only reader" bug has recurred across poor-doer,
// profitability, weight-analytics, financial-analytics and cog-breakeven — the
// root cause was each reader hand-rolling its own parse. This module is the one
// place that owns the convention; every reader delegates here.
//
// Accepted-value semantics are byte-identical to the on-write validator
// `weighingDetailsSchema` (details-schemas.ts), so a reader counts EXACTLY the
// weighings the validator accepts: a finite number OR a finite numeric string.
// A ≤0 value is returned verbatim — the ">0" business rule belongs to the
// caller (cog-breakeven skips ≤0; analytics treat it as a real reading), matching
// the historical reader code this helper replaces.

/**
 * Read the weighing mass (kg) from an already-parsed `details` object.
 * Returns a finite number, or `null` when the mass is absent / non-numeric /
 * non-finite. Canonical key is `weight_kg`; `weightKg` is the camelCase
 * fallback. A numeric string ("287.5") is coerced.
 */
export function weighingMassKg(
  details: Record<string, unknown> | null | undefined,
): number | null {
  if (!details) return null;
  const raw = details.weight_kg ?? details.weightKg;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Read the weighing mass (kg) from a raw `details` JSON string (the shape every
 * Prisma `Observation.details` read returns). Never throws: malformed JSON, or
 * JSON that is not an object, yields `null`.
 */
export function parseWeighingMassKg(rawDetails: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawDetails);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  return weighingMassKg(parsed as Record<string, unknown>);
}
