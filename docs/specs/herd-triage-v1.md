# Herd Triage v1 — build-ready spec

**Wave:** `wave/herd-triage-v1` (off `main`)
**Status:** specced 2026-06-14 (grilling session); build paused pending GitHub access
**Terms:** CONTEXT.md → Herd Triage. **Decision:** ADR-0010 (Attention Item read model).

## Why (one line)
The first "AI-leader" quick win and the 7-day-trial aha: the moment a farmer
imports their herd, FarmTrack shows a "herd at a glance" + a ranked list of
**which animals need attention and why** — on day-1 data, deepening as they log.

## What ships
1. **Attention Item** per-animal read model `{ animalId, reasons[], urgency, severity, species }`
   (ADR-0010). Reuses existing detectors' per-animal findings (currently
   collapsed to Alert counts) + new snapshot detectors.
2. **5 snapshot reasons** (net-new, attribute-only, fire on import):
   `no-camp`, `missing-id` (no tag *and* no brand), `missing-dob`,
   `age-for-category` (species-aware DOB×category), `no-weight-on-record`.
3. **History reasons via reuse** (project existing cattle/sheep detectors
   per-animal — no new detection logic): `poor-doer`, `open-cow`,
   `in-withdrawal`, `overdue-inspection`, sheep `dosing-overdue` / `famacha`.
   These are the "unlock more" set.
4. **Urgency ranking** — `urgency = Σ(reason weight)`; item `severity` = max
   reason severity (any red → red); tie-break by reason count then animalId.
   Reason weights reuse `AlertThresholds`; red reasons (e.g. `in-withdrawal`)
   dominate amber.
5. **Surfacing** — dashboard "Needs attention" hero panel (top 5 + Einstein
   one-liner) → dedicated **Triage** screen (ranked, filter by reason/severity,
   tap-through to animal). Cross-links with the aggregate `/admin/alerts` page.
6. **Herd-at-a-glance** — Einstein-narrated summary atop Triage.
7. **"Unlock more"** strip — greyed history-reason categories with
   "log X to unlock" prompts (trial-engagement driver).
8. **Narration** — Einstein turns structured reasons into prose + answers
   follow-ups; never invents reasons. Online, with deterministic templated
   fallback so detection/ranking stay fully offline.

## Scope boundaries
- **Cattle + sheep only.** Game is population/census-based (no per-animal
  records) → stays on the aggregate Alert lens.
- **No new history detectors** (weight-drop, calving-interval deferred to v1.1).
- **Propose-only** — Triage tap-through opens the animal/prefilled screen;
  it does NOT auto-act (true Autopilot is a later capstone).
- Detection runs through the existing **per-species modules** (no cattle-only
  hard-scope — guards the #356 regression class).

## Reuse leverage (why this is a ~1–2wk quick win)
- Detectors already compute per-animal data (`byAnimal` in cattle `getAlerts`)
  then discard it → extract pre-collapse, project group-by-animal.
- `AlertThresholds`, species modules, Einstein, offline IndexedDB sync,
  dashboard alert patterns all already exist.
- Net-new: 5 snapshot detectors, the per-animal projection, urgency sort,
  Triage screen + hero panel, narration wiring, unlock strip, tests.

## TDD order (when build resumes)
1. Table tests: snapshot-reason detection on attribute-only Animal fixtures.
2. Per-animal projection (green) — detectors emit findings once; Alert count
   and Attention Item list both consume them.
3. Urgency ranking + severity rollup.
4. Einstein narration + templated offline fallback.
5. Invariant test: every Attention Item's reason id appears in the matching
   Alert roll-up and vice versa (the "same population" guarantee of ADR-0010).
6. UI: Triage screen, dashboard hero panel, unlock strip.
