/**
 * lib/calculators/sars-livestock-values.ts
 *
 * Standard livestock values for South African farming income tax under the
 * First Schedule to the Income Tax Act 58/1962, paragraph 5(1) read with
 * paragraph 6(1)(b)(ii)/(c)(ii)/(d)(ii) (±20% election band) and paragraph 7
 * (election lock-in for subsequent years).
 *
 * Source pack — verified 2026-05-01:
 *   - GN R105 (Government Gazette 1011, 22 January 1965)
 *   - As amended by GN R1814 (Government Gazette 5309, 8 October 1976)
 *   - Reproduced verbatim in SARS Guide IT35 (13 October 2023), Annexure
 *     pp. 71-72 (the "Schedule of Standard Values").
 *   - Also reproduced in the SARS ITR12 Live-stock-values reference.
 *
 * The values are nominal 1976 Rand and have not been updated since — this is
 * by design: the First Schedule lets the taxpayer adopt their own value
 * within ±20% (para 6) so the gazetted figure is a reference anchor, not a
 * market valuation.
 *
 * Game has NO gazetted standard value — IT35 §3.4.2 (read with Interpretation
 * Note 69) accepts a nil entry. lookupStandardValue() returns 0 for game.
 *
 * Pure module — no I/O, no Prisma, no side effects.
 *
 * Class-of-bug guard: every R-value below was cross-checked against IT35 (2023)
 * Annexure to prevent a recurrence of the wave/26 fabricated SARS-codes
 * incident (see feedback-regulatory-output-validate-against-spec.md).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type SarsSpecies =
  | "cattle"
  | "sheep"
  | "goats"
  | "pigs"
  | "horses"
  | "donkeys"
  | "mules"
  | "ostriches"
  | "poultry"
  | "chinchillas"
  | "game";

export interface LivestockClass {
  species: SarsSpecies;
  ageCategory: string;
}

export interface StandardValue {
  class: LivestockClass;
  zar: number;
  source: string;
}

export interface ElectionRecord {
  species: string;
  ageCategory: string;
  electedValueZar: number;
  electedYear: number;
  /** Required when re-electing a different value in a later year (para 7). */
  sarsChangeApprovalRef?: string | null;
}

export class UnknownLivestockClassError extends Error {
  constructor(cls: LivestockClass) {
    super(
      `No SARS standard value gazetted for species="${cls.species}" ageCategory="${cls.ageCategory}". ` +
        `If this is a real class, add a row to STANDARD_VALUES with a citation.`,
    );
    this.name = "UnknownLivestockClassError";
  }
}

export class ElectionExceedsTwentyPercentBandError extends Error {
  constructor(standard: number, elected: number, cls: LivestockClass) {
    super(
      `Elected value R${elected} for ${cls.species}/${cls.ageCategory} exceeds the ±20% band ` +
        `around the gazetted standard value R${standard}. First Schedule paragraph 6(1) requires ` +
        `adopted values to fall within ±20% of the gazetted figure.`,
    );
    this.name = "ElectionExceedsTwentyPercentBandError";
  }
}

export class ElectionLockInError extends Error {
  constructor(cls: LivestockClass) {
    super(
      `Re-election of a different value for ${cls.species}/${cls.ageCategory} requires SARS ` +
        `change approval (paragraph 7 of the First Schedule). Set sarsChangeApprovalRef on the ` +
        `new ElectionRecord once approval is obtained.`,
    );
    this.name = "ElectionLockInError";
  }
}

// ── Source metadata ──────────────────────────────────────────────────────────

export const STANDARD_VALUES_GAZETTED_DATE = "1976-10-08";
export const STANDARD_VALUES_SOURCE =
  "GN R105 (GG 1011, 1965-01-22) as amended by GN R1814 (GG 5309, 1976-10-08); reproduced in SARS Guide IT35 (2023-10-13) Annexure pp. 71-72";

const CITATION = STANDARD_VALUES_SOURCE;

// ── Gazetted standard-value table ────────────────────────────────────────────

/**
 * The full gazetted standard-value table. Order: as it appears in IT35 (2023)
 * Annexure pp. 71-72. Do NOT mutate — every value is a regulatory anchor.
 */
export const STANDARD_VALUES: ReadonlyArray<StandardValue> = Object.freeze([
  // Cattle
  { class: { species: "cattle", ageCategory: "Bulls" }, zar: 50, source: CITATION },
  { class: { species: "cattle", ageCategory: "Oxen" }, zar: 40, source: CITATION },
  { class: { species: "cattle", ageCategory: "Cows" }, zar: 40, source: CITATION },
  { class: { species: "cattle", ageCategory: "Tollies & heifers 2-3 years" }, zar: 30, source: CITATION },
  { class: { species: "cattle", ageCategory: "Tollies & heifers 1-2 years" }, zar: 14, source: CITATION },
  { class: { species: "cattle", ageCategory: "Calves" }, zar: 4, source: CITATION },
  // Sheep
  { class: { species: "sheep", ageCategory: "Rams" }, zar: 6, source: CITATION },
  { class: { species: "sheep", ageCategory: "Ewes" }, zar: 6, source: CITATION },
  { class: { species: "sheep", ageCategory: "Wethers" }, zar: 6, source: CITATION },
  { class: { species: "sheep", ageCategory: "Weaned lambs" }, zar: 2, source: CITATION },
  // Goats
  { class: { species: "goats", ageCategory: "Fully grown" }, zar: 4, source: CITATION },
  { class: { species: "goats", ageCategory: "Weaned kids" }, zar: 2, source: CITATION },
  // Pigs
  { class: { species: "pigs", ageCategory: "Over 6 months" }, zar: 12, source: CITATION },
  { class: { species: "pigs", ageCategory: "Under 6 months" }, zar: 6, source: CITATION },
  // Horses
  { class: { species: "horses", ageCategory: "Stallions over 4 years" }, zar: 40, source: CITATION },
  { class: { species: "horses", ageCategory: "Mares over 4 years" }, zar: 30, source: CITATION },
  { class: { species: "horses", ageCategory: "Geldings over 3 years" }, zar: 30, source: CITATION },
  { class: { species: "horses", ageCategory: "Colts/fillies 3 years" }, zar: 10, source: CITATION },
  { class: { species: "horses", ageCategory: "Colts/fillies 2 years" }, zar: 8, source: CITATION },
  { class: { species: "horses", ageCategory: "Colts/fillies 1 year" }, zar: 6, source: CITATION },
  { class: { species: "horses", ageCategory: "Foals under 1 year" }, zar: 2, source: CITATION },
  // Donkeys
  { class: { species: "donkeys", ageCategory: "Jacks/jennies over 3 years" }, zar: 4, source: CITATION },
  { class: { species: "donkeys", ageCategory: "Jacks/jennies under 3 years" }, zar: 2, source: CITATION },
  // Mules
  { class: { species: "mules", ageCategory: "4 years and over" }, zar: 30, source: CITATION },
  { class: { species: "mules", ageCategory: "3 years" }, zar: 20, source: CITATION },
  { class: { species: "mules", ageCategory: "2 years" }, zar: 14, source: CITATION },
  { class: { species: "mules", ageCategory: "1 year" }, zar: 6, source: CITATION },
  // Ostriches
  { class: { species: "ostriches", ageCategory: "Fully grown" }, zar: 6, source: CITATION },
  // Poultry — only layers/breeders ≥9mo are gazetted; broilers are produce-on-hand
  // and out of scope per the wave-26b research recommendation.
  { class: { species: "poultry", ageCategory: "Over 9 months" }, zar: 1, source: CITATION },
  // Chinchillas
  { class: { species: "chinchillas", ageCategory: "All ages" }, zar: 1, source: CITATION },
]);

const KNOWN_SPECIES = new Set<SarsSpecies>([
  "cattle",
  "sheep",
  "goats",
  "pigs",
  "horses",
  "donkeys",
  "mules",
  "ostriches",
  "poultry",
  "chinchillas",
  "game",
]);

// ── Lookups ──────────────────────────────────────────────────────────────────

/**
 * Return the gazetted standard value for a livestock class.
 *
 *   - Game returns 0 (SARS-accepted nil per IT35 §3.4.2 + IN 69).
 *   - Unknown species or unknown age-category throws UnknownLivestockClassError.
 *
 * No fabricated values: classes not in STANDARD_VALUES throw rather than
 * silently defaulting. This is the spec-validation gate that prevents the
 * fabricated-SARS-codes class-of-bug from recurring.
 */
export function lookupStandardValue(input: LivestockClass): number {
  if (input.species === "game") {
    return 0;
  }
  if (!KNOWN_SPECIES.has(input.species)) {
    throw new UnknownLivestockClassError(input);
  }
  const found = STANDARD_VALUES.find(
    (r) => r.class.species === input.species && r.class.ageCategory === input.ageCategory,
  );
  if (!found) {
    throw new UnknownLivestockClassError(input);
  }
  return found.zar;
}

/**
 * True iff `elected` falls within ±20% of `standard` (inclusive at both ends).
 * Both ends inclusive — "10% above or below" includes exactly 20%.
 */
export function withinTwentyPercentBand(standard: number, elected: number): boolean {
  if (standard === 0) {
    return elected === 0;
  }
  const lo = standard * 0.8;
  const hi = standard * 1.2;
  return elected >= lo - 1e-9 && elected <= hi + 1e-9;
}

// ── Election application ─────────────────────────────────────────────────────

export interface EffectiveValueInput {
  class: LivestockClass;
  /** Election for the current year (if any). */
  election?: ElectionRecord | null;
  /**
   * Defence-in-depth: a previous-year election for the same class.
   *
   * **Paragraph 7 lock-in is NOT primarily enforced here.** Per the SARS
   * First Schedule paragraph 7 ("Once an option is exercised it shall be
   * binding in respect of all subsequent returns rendered by the farmer
   * and may not be varied without the consent of the Commissioner"), the
   * binding effect is achieved operationally by the combination of:
   *
   *   (a) `SarsLivestockElection` rows being unique on
   *       `(species, ageCategory, electedYear)` — a re-election creates a
   *       *new* row with `sarsChangeApprovalRef` set, never silently
   *       overwriting the historical value.
   *   (b) `loadElectionsForYear(taxYear)` returning the *latest* election
   *       per class whose `electedYear <= taxYear`. Until SARS approves a
   *       new election, the original row remains the latest, so every
   *       subsequent year's IT3 keeps using it. That IS the lock-in.
   *
   * Because the data layer + latest-wins resolver already encode the rule,
   * `getIt3Payload` always passes ONE election per class and never supplies
   * `priorElection`. The parameter therefore has no effect on the production
   * flow — it is preserved as a defence-in-depth assertion that would still
   * fire if a future caller ever fed two elections for the same class
   * without a `sarsChangeApprovalRef`. Internal tests in
   * `sars-livestock-values.test.ts` continue to exercise this defensive
   * path; the operational Para 7 contract is pinned by
   * `sars-livestock-values-para7.test.ts`.
   */
  priorElection?: ElectionRecord | null;
}

/**
 * Resolve the per-class value to use on the IT3 stock schedule, applying any
 * paragraph-6 ±20% election. Paragraph 7 lock-in is enforced upstream by the
 * data layer plus `loadElectionsForYear` (see `priorElection` JSDoc).
 *
 * Throws:
 *   - UnknownLivestockClassError — class not in STANDARD_VALUES.
 *   - ElectionExceedsTwentyPercentBandError — election outside ±20%.
 *   - ElectionLockInError — defensive only; fires when a caller explicitly
 *     supplies a conflicting `priorElection` without `sarsChangeApprovalRef`.
 *     Production callers do not exercise this branch.
 */
export function effectiveValue(input: EffectiveValueInput): number {
  const standard = lookupStandardValue(input.class);

  if (!input.election) {
    return standard;
  }

  const elected = input.election.electedValueZar;
  if (!withinTwentyPercentBand(standard, elected)) {
    throw new ElectionExceedsTwentyPercentBandError(standard, elected, input.class);
  }

  // Defence-in-depth: not the primary lock-in mechanism (see `priorElection`
  // JSDoc). Production callers do not supply `priorElection`; this branch
  // exists to fail loudly if a future caller ever passes two conflicting
  // elections for the same class without a SARS approval ref.
  if (
    input.priorElection &&
    input.priorElection.species === input.election.species &&
    input.priorElection.ageCategory === input.election.ageCategory &&
    input.priorElection.electedValueZar !== input.election.electedValueZar &&
    !input.election.sarsChangeApprovalRef
  ) {
    throw new ElectionLockInError(input.class);
  }

  return elected;
}
