/**
 * @vitest-environment node
 *
 * Issue #319 (PRD #318 stress-test remediation, wave R1).
 *
 * Root cause: `components/logger/ReproductionForm.tsx` declares a local
 * `ReproType` union that includes `body_condition_score`,
 * `temperament_score`, `scrotal_circumference`. The persistence allowlist
 * `VALID_OBSERVATION_TYPES` in `lib/domain/observations/create-observation.ts`
 * did NOT contain those three. The UI enum and the write allowlist were
 * independent sources of truth with no contract test binding them, so a
 * BCS / temperament / scrotal observation passed the UI + server validation
 * but died permanently at persistence with HTTP 422 INVALID_TYPE.
 *
 * This contract test binds the two: every observation type the
 * ReproductionForm can emit MUST be a member of the persistence allowlist.
 * After the registry refactor, both derive from a single source of truth
 * (`lib/domain/observations/registry.ts`), so the two can never drift again.
 *
 * RED on main / pre-impl: fails on the 3 missing types.
 */
import { describe, expect, it } from "vitest";

import { VALID_OBSERVATION_TYPES } from "@/lib/domain/observations/create-observation";

/**
 * Every value the ReproductionForm's BASE_TYPE_OPTIONS can submit. Pulled by
 * literal string match from `components/logger/ReproductionForm.tsx` so this
 * list is the UI-side ground truth. The persistence allowlist MUST be a
 * superset.
 */
const REPRO_FORM_EMITTED_TYPES = [
  "heat_detection",
  "insemination",
  "pregnancy_scan",
  "calving",
  "body_condition_score",
  "temperament_score",
  "scrotal_circumference",
] as const;

describe("ReproductionForm -> persistence observation-type contract", () => {
  it("every type the ReproductionForm emits is in the persistence allowlist", () => {
    const missing = REPRO_FORM_EMITTED_TYPES.filter(
      (t) => !VALID_OBSERVATION_TYPES.has(t),
    );
    expect(
      missing,
      `ReproductionForm emits types the server rejects (422 INVALID_TYPE): ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("specifically includes body_condition_score", () => {
    expect(VALID_OBSERVATION_TYPES.has("body_condition_score")).toBe(true);
  });

  it("specifically includes temperament_score", () => {
    expect(VALID_OBSERVATION_TYPES.has("temperament_score")).toBe(true);
  });

  it("specifically includes scrotal_circumference", () => {
    expect(VALID_OBSERVATION_TYPES.has("scrotal_circumference")).toBe(true);
  });
});
