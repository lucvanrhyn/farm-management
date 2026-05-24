/**
 * lib/observations/camp-inspection-types.ts
 *
 * Issue #407 — single-source-of-truth for the set of observation types that
 * count as "the farmer inspected this camp today".
 *
 * The producer side (`app/[farmSlug]/logger/[campId]/page.tsx`) emits ONE of
 * these types every time the logger surface records a camp visit:
 *
 *   - `"camp_check"`        — All Normal — Camp Good button branch
 *                              (`handleCompleteVisit`).
 *   - `"camp_condition"`    — full CampConditionForm submit
 *                              (`handleConditionSubmit`).
 *
 * The consumer side (`lib/server/camp-status.ts` → `getLatestCampConditions`
 * and `countInspectedToday`) reads back the latest row whose `type` is in
 * this set so the Logger / Dashboard tiles can render the "last visit"
 * badge.
 *
 * Pre-#407 each side hand-coded the literal pair `["camp_condition",
 * "camp_check"]`. Adding a third camp-inspection branch (say,
 * `"all_normal_quick"`) would have updated the producer but silently
 * orphaned the consumer's read — the bug class ADR-0006's "named door"
 * doctrine exists to prevent. Importing this constant on both sides makes
 * the contract structurally impossible to drift.
 *
 * `as const` makes this a readonly tuple; `readonly` lets it satisfy
 * Prisma's `where.type.in: string[]` shape via spread.
 */
export const CAMP_INSPECTION_OBSERVATION_TYPES = [
  "camp_condition",
  "camp_check",
] as const;

/** Union of the literal type strings counted as a camp inspection. */
export type CampInspectionObservationType =
  (typeof CAMP_INSPECTION_OBSERVATION_TYPES)[number];
