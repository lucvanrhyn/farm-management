# Dashboard alerts: one pure composition core, total over optional sources

**Status:** accepted (2026-05-17)

## Context

`getDashboardAlerts` (`lib/server/dashboard-alerts.ts`, 422 lines) is the
richest piece of branching logic in the app: it composes a farm's
red/amber alert set from **eight independent sources** — species-module
alerts, animals-in-withdrawal, camp-conditions, rotation status, veld
summary, feed-on-offer, drought (an Open-Meteo call), and camp count
(drives stale-inspection). It has **five callers**: the `/admin/alerts`
page, three sites in `lib/server/cached.ts`, `lib/server/notification-generator.ts`,
and `lib/server/alerts/legacy-dashboard.ts`.

It has **zero tests**. The only way into the severity/message/count logic
is `(prisma, farmSlug, thresholds)`, so exercising it requires a fully
seeded multi-species tenant. The single most complex derivation in the
codebase is unverifiable through its own interface.

Worse, the dashboard *header* badge does not consume it at all.
`components/dashboard/DashboardClient.tsx:267-274` computes its own
"open alerts" number with a bespoke formula —
`grazing_quality === "Poor" || fence_status !== "Intact"` — over the
offline `liveConditions` prop. This formula inspects `fence_status`, which
the canonical engine **never looks at**, and ignores withdrawal, rotation,
veld, feed-on-offer, drought and stale-inspection, which the canonical
engine *does* count. The header badge and the `/admin/alerts` page can
report wildly different numbers for the same farm at the same instant.
There is no single definition of "what counts as an alert."

The constraint that shapes the fix: of the eight sources, only
**camp-conditions** is available offline (it lives in `liveConditions` /
IndexedDB). Rotation, veld, feed-on-offer, drought, withdrawal, and the
species-module fan-out are all server-only. The header therefore *cannot*
run the full engine offline — but it must not run a *different* engine
either.

## Decision

Adopt a two-module split at one seam, mirroring the pattern ADR-0002 used
for `SyncTruth`:

1. **`composeAlerts(inputs: AlertInputs): DashboardAlerts`** — a pure,
   total, deterministic function. `AlertInputs` is a bag of
   **independently-optional** source inputs (`campConditions?`,
   `withdrawalAnimals?`, `rotationPayload?`, `veldSummary?`,
   `feedOnOfferPayload?`, `droughtPayload?`, `speciesAlerts?`,
   `totalCamps?`) plus required config (`thresholds`, `farmSlug`, `now`).
   An **absent source contributes nothing** — "we didn't fetch rotation"
   and "rotation is clean" are indistinguishable in the output, by design.
   This is today's lines 172–421, lifted out whole. It is the **only**
   place alert severity, messages, and counts are decided.

2. **`getDashboardAlerts(prisma, farmSlug, thresholds, preFetched?, mode?)`**
   — the full-pass fetch shell. Performs the eight-way `Promise.all`
   exactly as today, then `return composeAlerts(...)`. **Its signature is
   unchanged**, so all five existing callers are untouched.

3. **The header badge becomes a partial pass.**
   `DashboardClient` deletes its two bespoke formulas and instead builds a
   partial `AlertInputs` bag from what it has offline —
   `{ campConditions: <from liveConditions>, totalCamps: camps.length,
   thresholds, farmSlug, now }` — and calls the *same* `composeAlerts`.
   The displayed count is `.totalCount`; `inspectedToday` is derived the
   same way.

4. **A new fence alert type is added to the engine.** A camp with
   `fence_status !== "Intact"` is a real operational alert (farm-wide,
   amber), derived from the camp-conditions source — the same input class
   as poor-grazing, so it remains offline-computable. Both the header and
   `/admin/alerts` gain it; the header's pre-existing fence-awareness is
   preserved rather than dropped.

The result is a **monotonicity invariant**: a partial pass is a *prefix*
of the full pass — every alert id the offline header emits also appears in
the full server pass, and `partial.totalCount <= full.totalCount`. The
header number is always a real subset of the canonical number, never a
different formula. After sync brings the full data, the number can only
grow toward the canonical value; it can never contradict it.

## Why a pure core, not just adding tests to `getDashboardAlerts`

You cannot table-test `getDashboardAlerts` without a Prisma double and a
seeded tenant — its interface *is* `(prisma, farmSlug, thresholds)`. Tests
written at that interface are integration tests of the fetch fan-out, not
of the 250 lines of severity logic that actually carry the bugs. Extracting
the pure core makes the testable unit `composeAlerts(bag)` — every severity
threshold, the red/amber split, message pluralisation, the per-source
gating — exercised with plain data. The fetch shell keeps thin integration
coverage; the logic gets exhaustive unit coverage. This is the same reason
ADR-0001 extracted domain operations rather than deepening `route.ts`.

## Why "absent source contributes nothing" instead of required inputs

If every source were required, the offline header could not call the core
at all (it has one of eight). Making each source optional, with absence
meaning "no contribution," is what lets the *same definition* run with
partial data. The alternative — a separate cheap formula for the header —
is exactly the divergence this ADR exists to kill. The cost is that an
absent source and a clean source produce the same output; this is
acceptable because the consumer of a partial pass (the header badge) is
explicitly showing "at least N alerts," not "exactly N."

## Why a monotonicity property test, not just example tests

Example tests pin individual cases; they do not prevent a future PR from
re-introducing a header-specific shortcut or a non-monotone source. The
architecture test asserts the structural guarantee directly: for any input
bag, `composeAlerts(subset)` yields ids ⊆ `composeAlerts(superset)` and
`totalCount(subset) <= totalCount(superset)`. This is the same role
`__tests__/architecture/sync-truth-no-direct-callers.test.ts` plays for
ADR-0002 — it makes the divergence *class* structurally impossible, not
just the one instance we found.

## Implementation consequences

- `lib/server/dashboard-alerts.ts` keeps `getDashboardAlerts` (now a thin
  shell) and gains `composeAlerts` + `AlertInputs`. No new file is
  strictly required, but the pure core may move to
  `lib/server/alerts/compose.ts` if the file exceeds the 400-line guidance
  after the split — the shell shrinks to ~60 lines, so this is unlikely.
- The five server callers are untouched (signature preserved).
- `DashboardClient.tsx` loses ~8 lines of bespoke formula and gains a
  `composeAlerts` call. A `liveConditions → campConditions` adapter is
  needed (the offline shape uses `grazing_quality` / `fence_status` /
  `last_inspected_at`; the engine's `LiveCampStatus` shape is close —
  the adapter pins the mapping in one place).
- `lib/server/notification-generator.ts` (the highest-bug-risk caller, and
  candidate 2 of the architecture review) consumes the same core for free.
- CONTEXT.md gains an **Alerts** section (Alert, Alert source, Alert
  composition, Partial alert pass) — landed with the grilling session
  2026-05-17, ahead of this ADR.

## Rollout

Ships as a single `wave/306-dash-alert-compose` branch off `main` (issue #306)
per CLAUDE.md §branching-workflow. One TDD wave, file allow-list:
`lib/server/dashboard-alerts.ts`, `lib/server/alerts/compose.ts` (if
split), `components/dashboard/DashboardClient.tsx`, the new test files,
`docs/adr/0005-*.md`, `CONTEXT.md`. TDD order: failing property +
table tests against `composeAlerts` → extract the pure core (green) →
add fence alert (red→green) → migrate `DashboardClient` → lock the
monotonicity invariant test. The five server callers are regression-guarded
by their existing integration coverage plus the unchanged signature.
