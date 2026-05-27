// Issue #440 — Slice 6: CampVisitCompletenessLabel observation-aware copy.
//
// Replaces the old `campConditionDoneLabel(grazingQuality)` helper which was
// grazing-only. The old function had no awareness of whether animal-level
// observations were logged during the visit, so a farmer who logged 5
// observations still saw "Done — no animals flagged" — copy that reads as
// "nothing notable happened" rather than "5 things were logged but no animal
// was individually flagged".
//
// The new function `getCampVisitCompletenessLabel` is a pure function with no
// side effects. It accepts all three inputs that matter for visit completeness
// and returns both the label (copy) and a severity token that drives banner
// styling on the call site.
//
// 5-row acceptance matrix (from #440):
//
// | grazingQuality       | observationCount | flaggedCount | label                                           | severity   |
// |----------------------|------------------|--------------|-------------------------------------------------|------------|
// | Good (or nullish)    | 0                | 0            | "Done — visit complete"                         | good       |
// | Good (or nullish)    | >0               | 0            | "Done — {N} observation[s] · all animals normal"| good       |
// | Good (or nullish)    | *                | >0           | "Done — {N} animals flagged"                    | attention  |
// | Fair/Poor/Overgrazed | *                | 0            | "Veld needs attention — {N} observations today" | attention  |
// | Fair/Poor/Overgrazed | *                | >0           | "Veld + {N} animal concerns"                    | critical   |
//
// Lives in `_lib/` (underscore folder = not routed by Next.js) so the
// page.tsx file only re-exports React/page concerns and stays compliant
// with Next 16's page export contract.

export type CampVisitSeverity = "good" | "attention" | "critical";

export interface CampVisitCompletenessResult {
  label: string;
  severity: CampVisitSeverity;
}

export interface CampVisitCompletenessInput {
  grazingQuality: string | null | undefined;
  observationCount: number;
  flaggedCount: number;
}

/**
 * Pure function — no imports, no side effects.
 *
 * Returns the banner label + severity for the "complete visit" button on the
 * camp inspection page, reflecting veld condition AND any observations/flags
 * logged during the visit.
 */
export function getCampVisitCompletenessLabel({
  grazingQuality,
  observationCount,
  flaggedCount,
}: CampVisitCompletenessInput): CampVisitCompletenessResult {
  const normalised = (grazingQuality ?? "").toLowerCase();
  const isDegradedVeld =
    normalised === "fair" ||
    normalised === "poor" ||
    normalised === "overgrazed";

  if (isDegradedVeld) {
    // Rows 4 & 5 — veld is degraded; severity escalates when animals are also flagged.
    if (flaggedCount > 0) {
      // Row 5: veld degraded + animal concerns
      return {
        label: `Veld + ${flaggedCount} animal concerns`,
        severity: "critical",
      };
    }
    // Row 4: veld degraded, no animal flags
    return {
      label: `Veld needs attention — ${observationCount} observations today`,
      severity: "attention",
    };
  }

  // Good veld (or nullish/unknown — "Good" is the safe default)
  if (flaggedCount > 0) {
    // Row 3: animals flagged even on Good veld
    const animalWord = flaggedCount === 1 ? "animal" : "animals";
    return {
      label: `Done — ${flaggedCount} ${animalWord} flagged`,
      severity: "attention",
    };
  }

  if (observationCount > 0) {
    // Row 2: observations logged but no flags
    const obsWord = observationCount === 1 ? "observation" : "observations";
    return {
      label: `Done — ${observationCount} ${obsWord} · all animals normal`,
      severity: "good",
    };
  }

  // Row 1: clean visit — no observations, no flags, good veld
  return {
    label: "Done — visit complete",
    severity: "good",
  };
}
