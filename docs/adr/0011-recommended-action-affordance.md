# Recommended Action: an action affordance on existing signals, not a nudge pipeline

**Status:** accepted (2026-06-14)

## Context

Quick win #2 ("Proactive AI nudges", propose-only) surfaces a recommended
*action* the farmer can take in one tap — "move mob to Camp 7", "weigh
these animals", "file the IT3 election now". The action opens a **prefilled**
form the human confirms and submits (propose-only; no auto-write).

Detection for these already exists three times over:

- the Phase-J notification engine — ~13 generators under `lib/server/alerts/*`
  emitting `AlertCandidate { type, category, severity, payload, message, href,
  … }` through dedup → dispatch → digest-email;
- aggregate **Alerts** (`composeAlerts`, ADR-0005);
- per-animal **Attention Items** (ADR-0010).

What none of them carry is an *action*: today an `AlertCandidate.href` lands
the user on a **page** (`/admin/tax/it3`), where they still do the work by
hand. The `Task` model, meanwhile, already encodes actions — `taskType`
(`weighing | treatment | camp_move | water_point_service | …`), `campId` /
`animalId`, templates, recurrence.

Hard constraint: the codebase **already has two notification pipelines**
(`notification-generator.ts` and `lib/server/alerts/*`) — flagged tech debt.
A nudge feature must not become a third.

Three ways to model a nudge:

1. **Recommended Action affordance** on the signals that already exist.
2. **Proposed Tasks** — AI writes `status:"proposed"` Tasks to accept/dismiss.
3. **A new Nudge entity** with its own generators and feed.

## Decision

Adopt **(1)**. A **Recommended Action** is an optional structured field on an
existing signal (`AlertCandidate` / Alert / Attention Item):
`{ taskType, target: { campId? | animalId? }, prefill, label }`. It upgrades
the signal's `href` from "navigate to a page" to "open a prefilled action."

- **Action mapping** — a deterministic table from a signal's `type` to its
  Recommended Action. `taskType` reuses the `Task` vocabulary; `target` and
  `prefill` are resolved from **existing engines** (the rotation engine
  supplies the next camp for a `camp_move`), **never from the LLM**. Einstein
  ranks and narrates; it does not invent action targets (mirrors ADR-0010's
  rules-detect / LLM-narrate split).
- **Nudge feed** = the ranked set of signals that carry a Recommended Action,
  shown in a "do next" surface. "Nudge" is the UX word; Recommended Action is
  the model term.
- **Propose-only** — accepting opens the prefilled form to confirm + submit.
  "Do later" materialises a `Task` (status `pending`) from the same
  `{ taskType, target, prefill }`. Execute-on-approval (writing without the
  form) is the deferred Autopilot capstone, out of scope.
- **v1 catalog = 6 mappings** with unambiguous targets: `weighing-stale →
  weighing`, `shearing/crutching → shearing`, `water-service →
  water_point_service`, `overdue-inspection → camp_inspection`,
  `rotation-move-due → camp_move`, `tax-deadline → IT3/SARS`. Info-only
  signals (LSU-overstock, predator-spike) carry no action.

## Why not proposed Tasks (2)

A `Task` is the "do later" *output* of accepting a nudge, not the nudge
itself. Modelling every nudge as a proposed Task pollutes the task list with
machine rows, forces a proposed→accepted lifecycle and dedup against real
tasks, and mismodels nudges meant for immediate action (you don't schedule a
one-tap weigh-now for later by default).

## Why not a new Nudge entity (3)

It is precisely the **third notification pipeline** the architecture notes
warn against: it would re-detect what the alert engine already detects, and
the three would drift. The affordance approach adds the "do" to detection
that already exists exactly once per signal.

## Implementation consequences

- Extend `AlertCandidate` (and the Alert / Attention Item view models) with an
  optional `action`. A new mapping module (e.g. `lib/server/nudges/action-map.ts`)
  holds the type→action table and prefill resolvers (thin wrappers over the
  rotation engine, weighing history, tax module).
- The "do next" feed extends the existing notification center / bell
  (`scope-href.ts` deep-link scoping, #559) rather than a new surface.
- **Dedup against tasks**: if a matching `pending` Task already exists for the
  target, the nudge renders "already scheduled" instead of a duplicate action.
- Offline: show last-synced nudges; observation-backed actions ride the
  existing offline queue (`SyncKind`); Task creation is online-only in v1.
- Ranking reuses the Triage urgency family (severity + category weight +
  due-date proximity).

## Rollout

Single TDD wave `wave/nudges-v1` when build resumes. Order: action-map table
tests (type→taskType/target) → prefill resolvers → feed query + ranking →
accept (open prefilled form) / "do later" (create Task) / snooze-dismiss →
task-dedup → Einstein narration. Detection generators are untouched
(affordance is additive), so their existing coverage regression-guards them.
