// Wave C / U1 — Codex audit P2 polish.
//
// Maps a camp's current grazing quality to the copy on the "complete
// visit" button when zero animals have been flagged. Previously hardcoded
// to "All Normal — Camp Good", which lied on Fair / Poor / Overgrazed
// camps — the visit can legitimately end with no individual animal alerts
// even when the veld itself is in trouble, but the button must not claim
// the camp is good when it isn't.
//
// Lives in `_lib/` (underscore folder = not routed by Next.js) so the
// page.tsx file only re-exports React/page concerns and stays compliant
// with Next 16's page export contract.

export function campConditionDoneLabel(
  grazingQuality: string | null | undefined,
): string {
  const normalised = (grazingQuality ?? "").toLowerCase();
  if (normalised === "fair" || normalised === "poor" || normalised === "overgrazed") {
    return "Done — no animals flagged";
  }
  return "All Normal — Camp Good";
}
