# Attention Item: a per-animal read model distinct from the aggregate Alert

**Status:** accepted (2026-06-14)

## Context

Herd Triage (the first "AI-leader" quick win — an on-import "herd at a
glance" plus a ranked per-animal attention list with reasons) needs a
per-animal signal: *"these 6 animals need your eyes, and here's why."*

The app already has an alert system, but it is **aggregate by
construction**. `DashboardAlert` / `SpeciesAlert` are
`{ id, severity: "red" | "amber", icon, message, count, href, species }` —
a count plus a link, with **no `animalId`**. The detectors compute
per-animal data internally (the cattle `getAlerts` builds a `byAnimal`
weighing map to find poor doers) and then **collapse it** to
`{ id: "poor-doers", count: 7, href: … }`. The per-animal identity Triage
needs is produced and discarded on every pass.

`composeAlerts` (ADR-0005, dashboard-alert-composition) is a pure, total
function with a **monotonicity / partial-pass invariant** designed for one
specific consumer: the offline dashboard header badge, which runs the same
engine with a subset of sources and must show a number that is always a
real subset of the canonical count.

Two ways to give Triage its per-animal items:

1. **Overload `DashboardAlert`** with an optional `animalId` + `rank`;
   Triage becomes the filtered animal-subject view.
2. **A new per-animal read model** that reuses the same detectors.

## Decision

Introduce **Attention Item** as a distinct per-animal read model:
`{ animalId, reasons[], urgency, severity, species }`, keyed to a single
`Animal` and carrying one or more **Reasons**.

- **Alert and Attention Item are two projections of one detection.** A
  Reason id is shared with the Alert that counts the same finding — Alert
  `poor-doers` is the herd-level roll-up of every Attention Item carrying
  the `poor-doer` Reason. Detection thresholds are defined **once** and
  projected two ways: group-by-reason (Alert, a count) and group-by-animal
  (Attention Item, a list of reasons). This is the structural guarantee
  that "7 poor doers" on the dashboard and the 7 animals in Triage can
  never disagree.
- **Rules detect and rank; the LLM only narrates.** `urgency` is a
  deterministic composite of reason severity/weight. Farm Einstein turns
  an Attention Item's structured reasons into prose and answers follow-ups
  but never invents a reason (see CONTEXT.md → Triage narration).
- **Snapshot vs history reasons** solve cold-start. Snapshot reasons are
  computable from imported `Animal` attributes alone, so the list is
  populated on day-1 import; history reasons unlock as observations accrue
  (see CONTEXT.md → Snapshot reason).
- **Species-aware via the existing per-species modules**, not a parallel
  cattle-only path (avoids the `getReproStats` hard-scope regression class,
  #356).

## Why not overload `DashboardAlert`

`count` and `href` have no per-animal meaning; an Attention Item's natural
fields (`animalId`, `reasons[]`, `urgency`) have no aggregate meaning.
Merging them produces a type where half the fields are null for half the
instances. More importantly, the ADR-0005 monotonicity/partial-pass
invariant was scoped to the offline header badge — extending `Alert` would
silently drag per-animal ranking under an invariant it was never designed
for, and the offline header would have to reason about animal-level rows it
never displays. Two clean projections beat one overloaded contract.

## Why "projections of one detection" instead of a second detector set

A separate Triage detector would re-implement the poor-doer / open-cow /
withdrawal thresholds and drift from the Alert versions — the dashboard and
the triage list would eventually report different populations for the same
condition. Sharing the Reason id forces a single source of truth for "what
counts as a poor doer," exactly as `composeAlerts` is the single source for
"what counts as an alert."

## Implementation consequences

- A new per-animal projection (e.g. `lib/server/triage/` or
  `lib/domain/triage/`) that consumes the detectors' **pre-collapse**
  per-animal findings. The cleanest path is to have detectors emit
  per-animal findings once, with both `composeAlerts` (count) and the
  triage projection (group-by-animal) consuming them — refactoring the
  detectors so the per-animal data is no longer thrown away.
- CONTEXT.md terms landed ahead of this ADR (Attention Item, Reason,
  Snapshot reason, Urgency, Triage narration).
- Detection + ranking run offline (rules over synced IndexedDB data);
  narration is online with a templated offline fallback.
- Multi-species via the existing species modules' detectors.

## Note: ADR numbering

`docs/adr/` currently has **two** `0005-*.md` files
(`0005-dashboard-alert-composition` and `0005-species-access-named-doors`).
This ADR takes the next free integer, **0010**. The 0005 collision should
be resolved in a separate housekeeping pass (renumber the dashboard-alert
ADR and fix inbound references); it is out of scope here.

## Rollout

Single TDD wave when implementation resumes (GitHub access currently
paused). TDD order: table tests for snapshot-reason detection on
attribute-only fixtures → the per-animal projection (green) → urgency
ranking → wire Einstein narration with the templated fallback → the
"same population" invariant test (every Attention Item's Reason id appears
in the corresponding Alert's roll-up and vice versa).
