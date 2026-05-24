// Issue #406 — TB1: done-button caption.
//
// `campConditionDoneLabel` (sibling file) branches the button copy between
// "Done — no animals flagged" (Fair / Poor / Overgrazed) and "All Normal —
// Camp Good" (Good / unknown / nullish) so the button never lies about the
// veld. The branched label is correct, but the variance can read as an app
// inconsistency unless we explain WHY two camps with the same "no animals
// flagged" outcome render different button copy.
//
// This caption renders directly beneath the done-button and ties the
// wording back to the grazing quality the farmer just recorded on the same
// form. Returns `null` when grazing quality is unknown so the caption
// element hides entirely rather than rendering empty whitespace (consumer
// must guard with `caption && <p>{caption}</p>`).
//
// Normalisation matches `campConditionDoneLabel` (case-insensitive,
// nullish-safe) so the two helpers stay in lock-step on the IndexedDB-
// merged / SQL-inserted casing seen in the wild.

export function campConditionDoneCaption(
  grazingQuality: string | null | undefined,
): string | null {
  const normalised = (grazingQuality ?? "").toLowerCase();
  switch (normalised) {
    case "good":
      return "Veld is in good shape — no flags raised on this visit.";
    case "fair":
      return "Veld is fair — visit closed without animal-level concerns.";
    case "poor":
      return "Veld is poor — visit closed without animal-level concerns. The veld itself still needs attention.";
    case "overgrazed":
      return "Veld is overgrazed — visit closed without animal-level concerns. The veld itself still needs attention.";
    default:
      return null;
  }
}
