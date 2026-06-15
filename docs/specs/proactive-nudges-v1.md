# Proactive AI Nudges v1 — build-ready spec

**Wave:** `wave/nudges-v1` (off `main`)
**Status:** specced 2026-06-14 (grilling session); build paused pending GitHub access
**Terms:** CONTEXT.md → Recommended Actions (Nudges). **Decision:** ADR-0011.

## Why (one line)
The "AI proposes, you act" layer and quick win #2: turn the signals FarmTrack
already detects into a ranked "do next" feed where each item is one tap from a
**prefilled** action — the AI-leader wedge without execution liability.

## What ships
1. **Recommended Action** — optional `{ taskType, target, prefill, label }`
   on the existing `AlertCandidate` / Alert / Attention Item (ADR-0011). No new
   pipeline.
2. **Action mapping (6, v1)** — deterministic `type → action`, targets from
   existing engines (never the LLM):
   - `NO_WEIGHING_90D` / weighing-stale → `weighing`
   - shearing/crutching due → `shearing`
   - water-service due → `water_point_service`
   - overdue-inspection → `camp_inspection`
   - rotation-move-due → `camp_move` (target camp from the rotation engine)
   - `TAX_DEADLINE_IT3` → IT3 / SARS election (prefilled export)
3. **"Do next" feed** — ranked (severity + category weight + due-date
   proximity), surfaced as a dashboard panel + the existing notification
   center/bell. Card = the "why" (Einstein-narrated) + primary one-tap action +
   snooze/dismiss + "add as task".
4. **Propose-only execution** — accept → opens prefilled form to confirm +
   submit; "do later" → creates a `pending` Task from the same payload.
5. **Task dedup** — a matching `pending` Task ⇒ render "already scheduled".
6. **Narration** — Einstein ranks + writes "why now"; deterministic templated
   fallback offline.

## Scope boundaries
- **6 mappings only.** Info-only signals (LSU-overstock, predator-spike) stay
  info-only — ambiguous targets excluded.
- **Propose-only.** Never auto-writes; execute-on-approval is the deferred
  Autopilot capstone.
- **No third pipeline.** Affordance is additive to existing generators.
- Task creation online-only in v1; observation-backed actions use the existing
  offline queue.

## Reuse leverage (why this is a ~1–2wk quick win)
- All detection already exists (13 Phase-J generators + Alerts + Attention
  Items); v1 adds only the *action* affordance.
- `Task` taskType vocabulary, rotation engine (camp_move target), tax module
  (IT3), notification center + `scope-href.ts`, Einstein, offline queue all
  exist.
- Net-new: the `action` field, the 6-row mapping + prefill resolvers, the feed
  query/ranking, accept/snooze/dismiss + task-dedup, narration wiring, tests.

## Dependencies / sequencing
- Builds naturally on **Herd Triage** (`wave/herd-triage-v1`): the Attention
  Item tap-through IS a nudge surface, and both share the urgency-ranking family.
- Build order: Triage (#1) → Nudges (#2).

## TDD order (when build resumes)
1. action-map table tests (type → taskType + target resolution).
2. prefill resolvers (rotation/weighing/tax) — green.
3. feed query + ranking.
4. accept (open prefilled form) / "do later" (create Task) / snooze-dismiss.
5. task-dedup invariant (no duplicate action when a pending Task matches).
6. Einstein narration + templated offline fallback.
7. UI: "do next" panel + notification-center integration.
