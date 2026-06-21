# FarmTrack — Domain Vocabulary

This file captures the precise meaning of terms used across FarmTrack code,
docs, and reviews. New PRDs append sections; existing sections are revised
in-place when a term's meaning changes. Architectural decisions live in
`docs/adr/`.

Single-context: `CLAUDE.md` is the authoritative agent-instruction file.
`CONTEXT.md` is read-only background for grilling/design sessions — it does
not override `CLAUDE.md`.

---

## Sync (offline queue)

PRD #194 introduces a typed facade (`lib/sync/queue.ts`) over the offline
sync subsystem. The terms below pin the contract so future callers cannot
re-introduce the caller-must-remember class of bug that broke the "last
synced" indicator twice (Codex audit C1 and C3).

### Sync kind

One of four typed offline-queue domains: `observation`, `animal`, `photo`,
`cover-reading`. Each kind has its own IndexedDB object store
(`pending_observations`, `pending_animal_creates`, `pending_photos`,
`pending_cover_readings`), its own server endpoint, and its own per-row
sync state machine. The facade dispatches on a `SyncKind` token so a single
coordinator can drive all four uniformly.

### Sync truth

The canonical `SyncTruth` record returned by `getCurrentSyncTruth()`. Shape:
`{ pendingCount, failedCount, lastAttemptAt, lastFullSuccessAt }`. The UI
MUST read this record — never the underlying IDB getters
(`getPendingCount`, `getLastSyncedAt`, etc.) — because the consistency of
the four fields is enforced only by this function. Reading the underlying
getters and assembling them in the UI is the exact pattern that produced
C1/C3.

### Sync attempt

A single coordinator cycle — one invocation of `syncAndRefresh`. The
coordinator processes all four kinds (in parallel for the three direct
kinds; photos run after observations resolve their server IDs), then emits
exactly one `recordSyncAttempt({ timestamp, perKindResults })` call. That
call is the ONLY place `lastAttemptAt` and `lastFullSuccessAt` can move.

### Last full success

The `lastFullSuccessAt` field of `SyncTruth`. Derived field — ticks only
when the most recent `recordSyncAttempt` had `failed === 0` for every kind.
A partial-success cycle (e.g. observations all-synced but one photo failed)
does NOT tick this field, even though it ticks `lastAttemptAt`. This is the
truthfulness invariant: the UI "Synced just now" badge is the user's
guarantee that everything they queued reached the server.

### Sync failure (row-level)

A `SyncFailure` record — `{ reason, attempts, lastAttemptAt }` — describing
why a single queued row failed. Wave 1 (PRD #194 slice 1/3) defines the
type but does not yet thread per-row reasons through the four pending
stores; wave 2 (issue #196) wires it in and migrates UI consumers.

---

## Species scoping

ADR-0005 makes the species axis on the four species-bearing models
(`Animal`, `Camp`, `Mob`, `Observation`) reachable only through two
*named doors*, so the type system can distinguish the two opposite
intents the old `audit-species-where` baseline could not. The terms
below pin that contract.

### Per-species surface

A read or set-spanning mutation whose result MUST be limited to the
active FarmMode species (the `farmtrack-mode-<slug>` cookie resolved via
`getFarmMode(slug)`). Admin tables, dashboards, mob pickers, the logger
camp tiles. An unscoped query on a per-species surface is the
"silently leak every species onto the cattle dashboard" bug class —
the reason the `scoped()` facade (#224) exists.

### Cross-species access

A read that MUST intentionally span every species — Farm Einstein RAG,
farm-wide analytics roll-ups, notification crons, the `lib/species`
registry's own internals. Scoping a cross-species access to one mode is
the *inverse* bug (a farm-wide audit log that silently drops sheep).
"Per-species surface" and "cross-species access" are mutually
exclusive and exhaustive for any tenant read of the four models.

### Species scope (`scoped`)

The named door for per-species surfaces: `scoped(prisma, mode)`
(`lib/server/species-scoped-prisma.ts`). `mode: SpeciesId` is a required
positional argument — omitting it is a compile error. Injects
`{ species: mode }` (plus `status: ACTIVE_STATUS` on animal reads) with
caller keys winning the merge.

### Cross-species door (`crossSpecies`)

The named door for cross-species access: `crossSpecies(prisma, reason)`.
`reason` is a typed union of sanctioned purposes (e.g.
`'einstein-rag' | 'analytics-rollup' | 'notification-cron' |
'farm-wide-audit' | 'species-registry-internal'`) — NOT a free string —
so the classification lives in the type system, not in a JSON baseline.
Injects no species predicate. A site that needs cross-species access
without a sanctioned reason is a design question, not a pragma.

### Species access invariant

The four species models may be reached on a tenant code path ONLY via
`scoped()` or `crossSpecies()`. Raw `prisma.{animal,camp,mob,observation}`
is forbidden outside a small *structural* exemption (the two door
modules themselves, `migrations/`, `scripts/` seed/maintenance, `prisma/`,
test files). Enforced by a structural architecture test in the shape of
`__tests__/architecture/sync-truth-no-direct-callers.test.ts`
(ADR-0002's invariant) — presence of a named door, NOT presence of a
`species:` key. There is no per-call baseline and no
`audit-allow-species-where:` pragma; both are retired by ADR-0005's
final rollout wave.

---

## Observation writes

ADR-0006 makes `Observation` creation reachable only through a single
named door so the species-stamping invariant ADR-0004 §4 declares cannot
be re-broken at a new write site. The terms below pin that contract.
The door is the *write* counterpart to ADR-0005's two *read* doors;
they cite each other and stay distinct so the filter/data confusion the
species-scoped facade header warns about is never reintroduced.

### Observation write door (`createObservation`)

The single named door for observation creation:
`createObservation(client, input)` (`lib/domain/observations/create-observation.ts`).
`client` is typed as `ObservationWriter` — the union of `PrismaClient`
and the transaction-callback client returned by `prisma.$transaction`'s
inner type — so the door is callable both inline and inside a
`$transaction` block (the load-bearing case for mob-movement and
task-completion writes, which must be atomic with their sibling
mutations).

### Observation write invariant

`Observation` may be created on a tenant code path ONLY via
`createObservation`. Raw `prisma.observation.create` /
`tx.observation.create` is forbidden outside a *structural* exemption
(the door module itself, `migrations/`, `prisma/`, `scripts/` seed and
maintenance, test files). Enforced by an architecture test in the same
shape as ADR-0002's `sync-truth-no-direct-callers.test.ts` and
ADR-0005's `species-access-no-direct-prisma.test.ts` — presence of the
door, not presence of a `species:` key on the call.

### Species-stamping waterfall

The rule the door uses to populate `Observation.species` (ADR-0004 §4 —
species is denormalised onto the row at write time so per-species
filters hit the covering index without a JOIN):

1. `animal_id` supplied → animal's species. Throws `AnimalNotFoundError`
   if the lookup fails (an FK violation, not a legitimate null).
2. Else `mob_id` supplied → mob's species. Throws `MobNotFoundError`
   on lookup miss.
3. Else if the resolved camp carries a species → camp's species.
4. Else → `null`. Back-compat for legacy camp-only observations on
   single-species data; once the backfill audit (`scripts/audit-observation-species.ts`)
   confirms zero NULL rows in prod the read side drops its
   NULL-tolerant predicate (ADR-0004 §5 closure).

The waterfall is "most-specific source wins." Disagreement between
layers (e.g. an animal's species ≠ its mob's species) is a schema
invariant, enforced by tests — not a runtime cost on every write. The
pre-ADR-0006 fallback (`animal?.species ?? null` on a missing-animal
read) silently wrote NULLs that the species-scoped read predicate's
OR-branch had to tolerate; the throw closes that hole.

---

## Alerts

ADR-0005 (dashboard-alert-composition) pins how a farm's red/amber alert
set is derived. This section was specified by that ADR's grilling session
(2026-05-17) but had drifted out of the file; it is restored here so the
Herd Triage terms below have a canonical contract to contrast against.

### Alert

A `DashboardAlert` — an **aggregate**, farm- or species-level operational
signal: `{ id, severity: "red" | "amber", icon, message, count, href,
species }`. It answers *"how is the farm doing?"* An Alert **counts**, it
never **identifies** an individual animal (e.g. `{ id: "poor-doers",
count: 7, href: … }`). The per-animal data that produced the count is
computed inside the detector and then collapsed away at the Alert boundary.

### Alert source

One of the eight independently-optional inputs to `composeAlerts`:
species-module alerts, animals-in-withdrawal, camp-conditions, rotation
status, veld summary, feed-on-offer, drought, and camp count (drives
stale-inspection). An **absent source contributes nothing** — "not
fetched" and "clean" are indistinguishable in the output, by design.

### Alert composition (`composeAlerts`)

The pure, total, deterministic function (`lib/server/alerts/compose.ts`)
that decides every severity, message, and count. The **only** place those
decisions live. `getDashboardAlerts` is the thin fetch shell that fans out
the eight sources and calls it.

### Partial alert pass

`composeAlerts` called with a *subset* of sources — the offline dashboard
header badge, which has only camp-conditions available locally.
**Monotonicity invariant:** for any input bag, a partial pass yields a
prefix of the full pass — every emitted id ⊆ the full pass's ids, and
`partial.totalCount <= full.totalCount`. The header number is always a
real subset of the canonical number, never a different formula.

---

## Herd Triage

PRD (Herd Triage, grilling session 2026-06-14) introduces a per-animal
lens that complements the aggregate Alert. Alert answers *"how is the
farm?"*; Triage answers *"which animals need me right now?"* The two are
**projections of the same detection** — Alert groups detector findings by
reason and shows a count; the Attention Item groups them by animal and
shows the reasons. See ADR (Attention Item read model).

### Attention Item

The per-animal counterpart to an Alert: `{ animalId, reasons[], urgency,
severity, species }`, keyed to a single `Animal`. Carries one or more
**reasons**. Distinct from Alert (aggregate) — an Attention Item is the
group-by-animal residue of the same detection an Alert counts by reason.
Never overloaded onto `DashboardAlert` (whose `count`/`href` have no
per-animal meaning, and whose partial-pass monotonicity invariant was not
designed to govern per-animal ranking).

### Reason

A single detector finding attached to an Attention Item — e.g.
`poor-doer`, `open-cow`, `overdue-inspection`, `calving-interval-long`,
`no-weight-on-record`, `no-camp`. A Reason id is shared with the Alert that
counts the same finding (Alert `poor-doers` is the herd-level roll-up of
every Attention Item carrying the `poor-doer` Reason), so detection logic
and thresholds are defined once and projected two ways.

### Snapshot reason

A Reason computable from **imported animal attributes alone** (DOB/age,
sex, breed, last-calving, current weight, camp assignment) with no logged
observation history. Snapshot reasons guarantee the Triage list is
populated on day-1 import — the acquisition-critical "aha" of the 7-day
trial. Contrast **history reasons** (weight-drop, overdue-inspection,
withdrawal) which require accrued observations and therefore *unlock* as
the farmer logs ("unlock more").

### Urgency

The deterministic ordering key for the Triage list — a composite of each
reason's severity/weight. **Rules decide urgency, not the LLM.** Two
Attention Items with the same reasons rank identically regardless of
narration.

### Triage narration

The LLM layer (Farm Einstein) that turns an Attention Item's structured
reasons into natural language and answers follow-ups. It **never invents
reasons** — it narrates only what the rules detected. Narration is online
with a deterministic templated fallback offline, so detection and ranking
stay fully offline-capable; only the prose degrades without connectivity.

---

## Recommended Actions (Nudges)

PRD (Proactive AI nudges, grilling session 2026-06-14). Detection already
exists — the Phase-J alert generators (`lib/server/alerts/*`), plus Alerts
and Attention Items. A Recommended Action is the **do** affordance layered
on top, deliberately **not** a new notification pipeline (adding one would
be the third pipeline; the dual-pipeline debt is already noted). See ADR
(Recommended Action affordance).

### Recommended Action

An optional structured action attached to an existing signal (Notification
/ Alert / Attention Item): `{ taskType, target: { campId? | animalId? },
prefill, label }`. It upgrades the signal's deep-link `href` from "navigate
to a page" to "open a **prefilled** action." `taskType` reuses the `Task`
vocabulary (`weighing | treatment | camp_move | water_point_service | …`).
A signal with no sensible action carries none (info-only).

### Nudge

The UX surface and user-facing synonym: a signal that carries a Recommended
Action, shown in a ranked "do next" feed. "Nudge" is the word the farmer
sees; **Recommended Action** is the precise model term.

### Propose-only execution

Accepting a nudge **opens the prefilled action form** for the human to
confirm and submit — it never auto-writes. "Do later" materialises a `Task`
(status `pending`) from the same `{ taskType, target, prefill }`. True
execute-on-approval (writing without opening the form) is the deferred
Autopilot capstone, explicitly out of scope.

### Action mapping

The deterministic table from a signal's `type` to its Recommended Action
(`taskType` + how to resolve `target` / `prefill`). Targets and prefill
values come from existing engines (e.g. the rotation engine supplies the
next camp for a `camp_move`), **never from the LLM** — mirroring Triage's
rules-detect / LLM-narrate split. Einstein ranks and narrates nudges; it
does not invent action targets.

---

## Farm Briefing

PRD (Weekly AI digest, grilling session 2026-06-14). Upgrades the daily
mechanical digest into an AI-narrated periodic summary. Reuses the existing
digest machinery (`digestMode`, `digestDispatchedAt`, the Inngest
dispatcher, `sendDailyDigest`'s send path) — not a new scheduler.

### Farm Briefing

An AI-narrated periodic summary of the farm — *what changed, what to watch,
what to do* — composed from a deterministic **briefing payload**: recent
notifications, top Attention Items (Triage), top Recommended Actions
(nudges), and key changes (weights logged, repro events, deaths/sales,
veld/rotation, drought). Einstein narrates the payload and never invents
facts. Delivered by the weekly **Digest** (email) and an in-app "This week"
surface.

### Digest

The scheduled delivery of farm signals, governed by the per-farm
`digestMode`: `realtime` (per-event push), `daily` (the J4b
category-grouped unread-notification roll-up email), and `weekly` (the AI
**Farm Briefing**). `digestDispatchedAt` stamps the last send
(stamp-before-flush idempotency, `dispatch.ts`). The mechanical daily
digest remains for farms that want raw alerts; the weekly mode carries a
Briefing.

### Briefing payload

The deterministic, structured aggregation the Farm Briefing narrates
(sources above). Rules aggregate; the LLM narrates; a templated fallback
renders the payload without the LLM, so a Briefing always sends even when
Einstein is unavailable.

---

## Camp Profitability

PRD (Profit-Per-Camp lite, grilling session 2026-06-14). Rolls the existing
finance calculators (`getCostPerCamp`, `calcProfitabilityByAnimal`,
`CogByCampRow`) up to the camp, per-LSU and per-hectare level. ADR-0012 pins
the income-attribution rule. The farm-level P&L (`getFinancialKPIs`) remains
the authoritative total; camp profitability is a reporting attribution, not a
second accounting truth.

### Camp profitability

Income minus expenses attributed to a camp over a period:
`profit(camp) = Σ income attributed to camp − Σ costs attributed/allocated to
camp`. Costs reuse the existing attribution (`Transaction.campId`, or
camp-tagged costs allocated across the camp's animals by
`calcProfitabilityByAnimal`). Income uses the income-attribution rule below.

### Income attribution (last-camp rule)

A sale's income is credited to the camp the sold animal was in at sale time
(its `currentCamp` / last camp before sale) — "where it was finished". For
batch sales (`animalIds[]`), each animal's share credits its own last camp.
This is the income counterpart to the already-existing cost attribution.
Chosen over campId-only (most sales are animal-tagged → empty camps) and
cost-only (no profit). **Known limitation:** an animal moved to a dedicated
sale/holding camp just before sale credits income there, not to the
production camp that did the value-add; v1 accepts this, future refinement
may credit the prior production camp. See ADR-0012.

### Per-LSU / per-hectare margin

Camp profitability normalised for comparability: `profit(camp) ÷ camp LSU`
(merged-LSU from the species registry) and `÷ camp sizeHectares`. Lets a
small high-value camp be compared against a large extensive one.

### Unallocated finance

Transactions with neither `animalId` nor `campId` (farm overhead: salaries,
licences, general fuel). Shown as a separate "unallocated" line, **never
spread across camps by a formula** — keeps camp profitability honest rather
than arbitrarily allocated. (Contrast camp-tagged costs, which ARE allocated
to the camp's animals.)

---

## Animal & Mob Profitability

PRD (Animal/Mob Profitability, grilling session 2026-06-19). Extends the
existing per-animal (`calcProfitabilityByAnimal`) and per-camp
(`rollUpProfitByCamp`) views, which already ship but are **un-feedable** — the
transaction form has no animal picker, so every animal-tagged figure is empty.
This feature makes profitability feedable (purchase price + animal-tagging),
adds a **projected** margin for animals still on the farm, surfaces it in a
discoverable place, and flags underperformers. Terms below pin the contract.

### Purchase price

The acquisition cost of an animal, held as a first-class **`Animal.purchasePrice`**
(`Float?` — the first money column on `Animal`) **+ `purchaseDate` (`String?`,
"YYYY-MM-DD")** attribute. NB the date is `String?` not `DateTime?` — FarmTrack
stores every user-facing event date on tenant tables as a `String` (`Transaction.date`,
`Animal.dateOfBirth`/`dateAdded`/`deceasedAt`); `DateTime` is reserved for system
timestamps. Settable at herd import (one CSV column) and on the
animal form — so day-1 profitability is populated from imported attributes alone
(the Triage "snapshot reason" philosophy), not from N hand-keyed transactions.
For a home-bred animal `purchasePrice` is null (its cost is its accrued rearing
expenses, not an acquisition). Distinct from a purchase **Transaction**
(`category: "Animal Purchases"`), which is the ledger event.

### Purchase-price reconciliation (column-wins)

The dedupe rule that keeps **one** accounting truth. An animal's opening cost in
the profitability view is `purchasePrice` when the column is set; **else** it
falls back to the sum of that animal's `animalId`-tagged `"Animal Purchases"`
expense transactions — **never both** (counting both double-charges the animal,
since a tagged purchase expense already flows into `expenses` today). The
farm-level P&L (`getFinancialKPIs`) stays the authoritative ledger total;
profitability remains a reporting attribution. The one legitimate divergence —
purchase prices captured as attributes but never journalled — is documented, not
reconciled away.

### Profitability section

The dedicated, discoverable home for animal/mob/category profitability: a
top-level `/admin/profitability` route, **gated exactly like finance**:
`creds?.tier === "basic"` → `UpgradePrompt` (there is **no "premium" tier** —
`FarmTier` is `basic | advanced | consulting`), and registered in the **"Finance"**
nav group of `components/admin/nav-model.tsx` with `premiumOnly: true` (the flag the
nav converts to `locked` for basic), English label **"Profitability"**. It hosts the
**grouping toggle** and the underperformer panel. It is *reuse, not rebuild* — but
note the mounting nuance: `ProfitPerCampSection` mounts directly on `finansies`
(safe to relocate), whereas `CategoryProfitability` is nested inside
`FinancialKPISection` (do **not** gut the KPI section — reuse the component / extract
it cleanly, and add a per-animal section via `getProfitabilityByAnimal`). Leave a
"See Profitability →" link on `finansies` for discoverability. The farm P&L,
the transaction ledger, budget-vs-actual, and cost-of-gain stay on
`/admin/finansies`; profitability is the "which animals/groups make money"
lens, kept separate from the "what were my transactions" ledger.

### Grouping axis

The Profitability section's toggle. Three axes ship because they have data on
day one and shipped calculators: **Animal** (per-head list, reuses
`getProfitabilityByAnimal`), **Category** (Bull/Cow/Heifer/Calf, reuses
`CategoryProfitability`), and **Camp** (reuses `rollUpProfitByCamp` last-camp
attribution). **Mob** is a deferred 4th axis that *unlocks* once a farm tags
animals into mobs — 0% adoption on the reference farm (875 animals, 0 mobs), so
a mob-first toggle would render blank. The mob rollup is the same per-animal
calc grouped by `mobId`, so it is purely additive. No axis ever shows an empty
primary screen on a populated farm.

### Estimated sale value (projected margin)

The value driver for animals **still on the farm**. Realised margin needs a real
sale `Transaction`; until then margin is *projected* against an estimate. The
estimate is a **two-tier** model, cheapest input first, so it is populated on a
zero-weights farm and sharpens as data accrues:

1. **Per-species-per-category R/kg × latest logged weight** — the farmer sets an
   R/kg assumption **keyed by species _and_ category** (`Record<SpeciesId,
   Record<category, number>>`), NOT a flat per-category map: `Animal.category` is
   free-text and species-agnostic, so a flat map silently merges species. Reuse the
   already-species-keyed **`marketPricePerKg`** shape + name from
   `FarmSettings.speciesAlertThresholds` (a *sale* price; do not reuse
   `purchasePricePerKg`, which is a purchase price). Weight gain is **not a separate
   line** — more kg × R/kg is a higher projected value, so gain enters the margin
   through this term.
2. **Per-category flat R/head fallback** — used when an animal has no weight on
   record (the trio-b reality: Cost-of-Gain renders empty, weights are sparse).
   Guarantees a populated projection on day one.
3. **Per-animal override** — a single typed value for the known exception (a stud
   bull worth R80k), wins over both tiers for that animal.

Two invariants: **realised always wins** — once an animal is sold its actual sale
`Transaction` replaces the estimate (projection is only for live animals); and
**projected ≠ realised** — projected margin is shown distinctly from banked
margin and is never silently summed with real money (same honesty discipline as
the [Profitability section] reporting-attribution rule and ADR-0012).

### Underperformer flag

The "which animals/groups need attention" output. It is **not** a new AI system —
it rides the existing **Triage** read-model (`lib/server/triage/`), which already
does *rules-detect → rank → narrate*: a `REASON_REGISTRY` (`reasons.ts`) tags each
animal with `Reason`s, `project.ts` ranks by `urgency = Σ weight` / `severity =
max`, and narration is deterministic offline (`narrate.ts`) with an **optional
online Einstein one-liner that already falls back to the templates on
no-key/error**. The AI only narrates the likely cause — it never decides the flag
and never invents numbers (rules-detect / LLM-narrate).

The feature is **additive**: four reasons cover the farmer's themes, two existing,
two net-new.

| Theme | Reason id | Status |
|---|---|---|
| gaining weight too slowly | `poor-doer` (ADG < `adgPoorDoerThreshold`) | exists — reuse |
| failing to breed | `open-cow` (days-open > limit) | data in `repro-engine.ts`; **promote** to a triage reason |
| consuming money | `unprofitable` | **net-new** (this feature's calc) |
| getting repeated treatments | `repeated-treatments` | **net-new** (no frequency rule today) |

Two definitions pinned:

- **`unprofitable` = margin in the bottom quartile *of its own category*, or
  negative.** Category-relative, not an absolute Rand cutoff, so it self-calibrates
  per farm (a R200 margin is fine for a calf, alarming for a stud bull). A
  **group** (category / camp / mob) is flagged when it holds a cluster of flagged
  animals **or** its aggregate margin is bottom-quartile / negative — this is the
  "which animal *groups* consume money" answer.
- **`repeated-treatments` = ≥ N treatment/health observations in a rolling
  window** (default ≥3 in 90 days), threshold living in `AlertThresholds` beside
  `adgPoorDoerThreshold` (the established config pattern).

All four are **amber** management signals; **red** stays reserved for food-safety
(`in-withdrawal`). Honesty carry-over from [Estimated sale value (projected
margin)]: an `unprofitable` flag computed on a *projected* margin is labelled
**projected/advisory** — an animal is never accused of losing money on an estimate
as if it were banked; realised-margin flags are firm.

### Feed mechanism (how the data gets in)

The fix that makes the whole feature non-empty — today the per-animal/category
views ship but are starved because `TransactionModal` tags nothing. The transaction
**API already accepts** `animalId` **and** `campId` (`app/api/transactions/route.ts:130-131`);
the modal simply never sets them. Three inputs:

1. **Two optional taggers in `TransactionModal`** — a **searchable animal picker**
   (typeahead by tag/name; must be search, not a dropdown — 875 head) setting
   `animalId`, and a **camp picker** (dropdown, ~19 camps) setting `campId`. The
   camp tag is the **feed/lick/dip allocation mechanism**: `calcProfitabilityByAnimal`
   already splits camp expenses evenly across the camp's active animals, so a
   "Lick — camp D" expense reaches every animal in D with no extra plumbing. Both
   optional; untagged = the existing **unallocated** line. Shown on every category.
2. **Purchase price as a stored attribute** — new `Animal.purchasePrice` +
   `purchaseDate` columns via one **numbered tenant migration** (all 5 prod tenants,
   the established pattern), surfaced on the animal create/edit form and as **one
   optional `purchasePrice` import column**. Day-1 populated from import; the
   [Purchase-price reconciliation (column-wins)] rule blocks double-counting.
3. **Bulk sales stay aggregate in v1** — tag the camp (or keep the existing
   quantity/avg-mass aggregate); per-animal multi-select (`animalIds`) is **deferred
   to v2** (an 875-head multi-select is heavy UI and camp-tagging already attributes
   the money correctly).

Entry point: the picker in `TransactionModal` is the core (the general finance flow
needs it anyway). Fast-follow (not v1-critical): the animal detail **Investment**
tab grows an "Add cost / income" button that opens the *same* modal pre-tagged to
that animal — same component, no new form.

### Consistency audit (2026-06-19) — implementation deltas

Two parallel sub-agent audits (backend + UX) confirmed **every design decision fits
existing FarmTrack patterns**; the corrections were implementation-level and are
folded into the terms above. The remaining "which files / which gotcha" deltas:

- **Migration:** next free tenant migration is **`0030`** (latest is
  `0029_task_water_point_id.sql`). Pure nullable `ALTER TABLE "Animal" ADD COLUMN`,
  double-quoted identifiers, no default/backfill. Then regenerate
  `lib/farm-schema.ts` (`pnpm db:gen-schema`) or the governance-gate freshness check
  fails; promote-time `checkPrismaColumnParity` + `verifyMigrationApplied` also guard.
- **Realised-margin roster:** `getProfitabilityByAnimal` filters `status: 'Active'`
  only — it drops sold/deceased animals **and their banked sale income**. A realised
  per-animal/category view MUST use the disposed-inclusive roster
  (`status ∈ {Active,Sold,Deceased,Culled}`, as `getProfitPerCamp` already does), or
  banked sale margin never appears. Projected view stays Active-only (live animals).
- **Projected-value plumbing is real, not a tweak:** `calcProfitabilityByAnimal` /
  `getProfitabilityByCategory` derive everything from realised `Transaction` rows.
  The projected value (weight × R/kg) is a NEW input that must be threaded through
  `AnimalProfitabilityInput` → the domain fetch; it is purely additive (no caller
  breaks) but is new wiring.
- **Triage = FIVE files per new reason, not three:** `reasons.ts` (registry entry,
  weight `AMBER_BASE + N` < 100 to hold the band-invariant test), `narrate.ts`
  (`REASON_PHRASES`, compile-mandatory), **`labels.ts`** (add to `HISTORY_REASON_IDS`
  + `REASON_LABELS` + `UNLOCK_HINTS` — exhaustiveness tests fail otherwise), and
  **`get-triage.ts`** (the actual detector — the real work for `open-cow` /
  `unprofitable` / `repeated-treatments`). `types.ts` needs **no** edit (`ReasonId` is
  registry-derived). The projected/advisory flag rides the finding/narration payload,
  not the registry (which only stores severity+weight).
- **`repeatedTreatments*` thresholds:** for per-farm parity with the existing five
  (`adgPoorDoerThreshold`, `daysOpenLimit`, …) add two **`FarmSettings` columns**
  (fold into the same `0030` migration) + API validation + admin `SettingsForm` field;
  there is no shared default const, so the literal fallback (`?? 90` / `?? 3`) must be
  set at each load site. (Code-only defaults avoid the migration but break parity —
  columns is the clean-arch choice.)
- **Pickers — reuse, don't hand-roll:** the animal typeahead is the existing
  **`components/observations/AnimalPicker.tsx`** (debounced → `GET /api/animals?search=`,
  already `--ft-*`-themed, scales to 875). The ⌘K palette is **nav-only** — not a
  reusable typeahead. The camp `<select>` is genuinely net-new: copy the markup from
  legacy `components/admin/TransactionForm.tsx` (already matches the modal's inline
  `fieldStyle`). Wire an `animalId` prop into `TransactionModal`'s POST payload (the
  same change the Investment-tab fast-follow needs — do them together; the modal is a
  server-data consumer so the Investment tab needs a small client wrapper +
  transaction-category fetch).
- **Animal form + import gotchas:** edit form = `EditAnimalModal` `FIELDS` array;
  create = `RecordBirthButton` / `create-animal.ts`. **`update-animal.ts` has a field
  allowlist (~line 95) — a new column silently drops on PATCH unless added there.**
  Import = the canonical `IMPORT_ROW_FIELDS` + `ImportRow` lock-step
  (`lib/onboarding/`); a **second legacy importer** (`AnimalImporter` /
  `api/animals/import`) exists — decide whether the column is needed there too.
  Admin animal create/edit are **online-only** (no offline-store impact).
- **Design system:** wrap in `AdminPage` + `PageHeader` (`@/components/ds`), `--ft-*`
  tokens only; exemplar to copy is `app/[farmSlug]/admin/reports/page.tsx`. Serif is
  **DM Serif Display** (inherited via PageHeader) — Fraunces is legacy-fallback only.
