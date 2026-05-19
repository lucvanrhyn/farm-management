# Species access: two named doors, no raw prisma on the four species models

**Status:** accepted (2026-05-19)

## Context

PRD #222 / issue #224 introduced `scoped(prisma, mode)`
(`lib/server/species-scoped-prisma.ts`) — a real seam: `mode: SpeciesId`
is a required positional argument, so a per-species surface that forgets
the species predicate is a *compile* error rather than a silent
all-species leak. The sibling lint `scripts/audit-species-where.ts` plus
`.audit-species-where-baseline.json` was meant to drag every existing
call site onto the seam over time (a one-way-shrinking ratchet).

Eighteen months of organic growth later the baseline holds **170
grandfathered call sites**. Their composition (audited 2026-05-18):

- ~73 `lib/server/*` (analytics, breeding, cached, dashboard-alerts),
  ~11 `lib/species/*` internals, plus the whole-path-skipped
  `lib/einstein/*` and `lib/inngest/*` — these **legitimately span
  species**. Scoping them to one mode would be a bug (a farm-wide audit
  log that silently drops sheep).
- ~25 `app/[farmSlug]/admin/*` pages, ~26 `app/api/*` routes, 14
  `lib/domain/*` — these are **per-species surfaces that were never
  migrated onto `scoped()`**. Not filtering them *is* the exact bug
  class the facade header (lines 24–29) says the facade exists to kill.

The defect is not that the seam is weak. It is that the seam is
**opt-in**, and the contract for "how to be species-correct" is smeared
across four surfaces — the facade, the inline `audit-allow-species-where:`
pragma vocabulary, the whole-path `CROSS_SPECIES_ALLOWLIST_PATHS` skip
list, and the 170-entry baseline JSON. The baseline is a single
*undifferentiated* suppression list that conflates two semantically
opposite intents: "this MUST span species" and "this FORGOT to scope."

The consequence: CI's "no new offenders" guarantee is hollow for the
second category. A genuinely buggy unscoped query on a new per-species
page is indistinguishable — to CI and to a reviewer reading the baseline
— from a legitimate cross-species roll-up. The species contract has no
**locality**, and the enforcement has a permanent semantic blind spot.
This is the same caller-must-remember failure mode ADR-0002 redrew the
sync boundary to eliminate; it is structurally the same problem and
takes the same cure.

`CONTEXT.md` ("Species scoping") pins the vocabulary this ADR uses.

## Decision

Adopt a **two-named-door** architecture for tenant reads of the four
species-bearing models (`Animal`, `Camp`, `Mob`, `Observation`):

1. **`scoped(prisma, mode)`** — unchanged. The named door for a
   *per-species surface*. `mode: SpeciesId` required-positional; injects
   `{ species: mode }` (+ `status: ACTIVE_STATUS` on animal reads).

2. **`crossSpecies(prisma, reason)`** — new. The named door for
   *cross-species access*. Same builder shape as `scoped()` (same four
   model builders, same `find*/count/groupBy/updateMany/deleteMany`
   surface, same return-type-inference trade-off — see "Why the builder
   shape" below) but injects **no** species predicate. `reason` is a
   **typed union** of sanctioned purposes, not a free string:

   ```ts
   type CrossSpeciesReason =
     | 'einstein-rag'
     | 'analytics-rollup'
     | 'notification-cron'
     | 'farm-wide-audit'
     | 'species-registry-internal';
   ```

   The typed reason is the whole point: the *classification* the old
   baseline could not express ("is this site supposed to span species?")
   now lives in the type system at the call site. Adding a new reason is
   a deliberate, reviewable type edit, not a silent baseline append.

3. **The species access invariant.** Raw
   `prisma.{animal,camp,mob,observation}` is forbidden on any tenant
   code path. The *only* legal accessors are the two doors. The
   exemption is **structural, not per-call**: the two door modules
   themselves, `migrations/`, `prisma/`, `scripts/` seed/maintenance,
   and test files. No `audit-allow-species-where:` pragma. No baseline.
   No `CROSS_SPECIES_ALLOWLIST_PATHS`.

4. **Enforcement moves from content-inspection to structure.** The
   ~600-line `scripts/audit-species-where.ts` (which parses each call's
   `where` body looking for a `species:` key, then consults a baseline)
   is replaced by a single architecture test modelled on
   `__tests__/architecture/sync-truth-no-direct-callers.test.ts`
   (ADR-0002's invariant): walk every non-exempt `.ts`/`.tsx`, fail CI
   on a `prisma.<species-model>.<op>` that is not lexically inside a
   door module. Presence of a *named door*, not presence of a
   *where key*. No baseline to grandfather; the test is binary.

5. **Writes are out of scope and stay a separate seam.** The facade
   deliberately excludes `create` (its header, lines 93–98: conflating
   the species *filter* axis with the create *data* axis is its own bug
   class). The observation-write species-stamping convention
   (ADR-0004 point 4; the `createObservation` vs hand-rolled
   `prisma.observation.create` split in `app/api/animals/[id]/photos`)
   is tracked as the **separate** write-seam deepening. ADR-0005 makes
   *reads/mutations* unforgeable; the write seam makes *writes*
   unforgeable; they cite each other and stay distinct so the
   filter/data confusion the facade warns about is never reintroduced.

## Why two doors, not one configurable accessor

A single `access(prisma, { mode } | { crossSpecies: reason })` collapses
to one module with a discriminated switch — the reader (human or agent)
must cross-reference the switch to know what a given call enforces, the
same readability loss ADR-0001 rejected for a `defineRoute({ mode })`
factory. Two named doors expose the contract at the call site:
`scoped(prisma, mode)` vs `crossSpecies(prisma, 'analytics-rollup')`
each read as a one-line statement of intent. The codebase already
prefers named seams over configurable ones (`getFarmContext` vs
`getFarmContextForSlug`; ADR-0001's four adapters vs a factory;
ADR-0002's facade) — this is the same call made a third time.

## Why a typed reason, not a free string or a registry file

A free-string `reason` documents intent but the type system can't see
it — it degrades to the baseline's blind spot in a different file. A
separate "cross-species registry" module (the pragmatic-locality option
considered and rejected during the 2026-05-18 design session) fixes
*locality* but the registry is still a human-maintained list, not a
type — a forgotten entry is still a silent bug. A typed union makes the
classification structural: a per-species surface cannot accidentally
acquire cross-species reach without a reviewer seeing a new literal in
the union or a `crossSpecies(...)` call appear in the diff.

## Why the builder shape, not a Prisma `$extends` client extension

`$extends` would restore the `select`/`include` return-type narrowing
the hand-rolled builder punts on (facade header lines 127–143). It is
deliberately not adopted: #224 already shipped the builder shape against
the libSQL adapter, the seam's load-bearing contract is the *where
axis* (not return narrowing), and swapping the mechanism mid-rollout
across ~170 sites multiplies risk for an ergonomic the team already
accepted. `crossSpecies()` inherits the same wart for consistency. A
future ADR may revisit the mechanism once the two-door surface is
stable; it is a cheaper migration then (one mechanism swap behind two
already-universal doors) than bundled into this rollout.

## Rollout

Mirrors ADR-0002's template (deepen the boundary → migrate consumers →
delete the old surface → lock the invariant). Each wave is a `wave/*`
branch, promote-gated, independently shippable. **Architectural — needs
Luc's explicit promote sign-off per the arch-PR exception; CI-green +
open PR, then present.**

- **Wave 1** — introduce `crossSpecies(prisma, reason)` + the
  `CrossSpeciesReason` union beside `scoped()`. No call-site changes;
  `audit-species-where` + baseline unchanged. Pure addition.
- **Waves 2..N — one area per wave**, in this order (least to most
  domain judgement): `lib/server/*` analytics & cached → `lib/domain/*`
  & `lib/einstein/*` & `lib/inngest/*` → `app/api/*` routes →
  `app/[farmSlug]/*` pages. Each wave classifies its baselined sites
  **per the rule** (per-species surface → `scoped()`; cross-species
  access → `crossSpecies(reason)`) and shrinks the baseline by exactly
  that wave's keys. **The classification is domain judgement and MUST
  be in the wave's dispatch brief, not left to the TDD agent** — the
  ~25 admin-page / ~26 api-route sites are almost all bugs-in-waiting
  that belong on `scoped()`; the `lib/server` analytics sites are
  mostly genuine `crossSpecies`. Misclassifying a per-species page as
  cross-species silently reintroduces the original bug, so each wave's
  brief enumerates its sites with the intended door pre-decided.
- **Final wave** — baseline ratchet hits zero. Delete
  `.audit-species-where-baseline.json`, replace
  `scripts/audit-species-where.ts` with the structural architecture
  test, delete `CROSS_SPECIES_ALLOWLIST_PATHS` and the
  `audit-allow-species-where:` pragma handling. Lock the invariant.

No code ships with this ADR — it documents the decision so the
implementation waves cite it and future architecture reviews do not
re-litigate two-doors vs one-accessor / typed-reason vs registry.
