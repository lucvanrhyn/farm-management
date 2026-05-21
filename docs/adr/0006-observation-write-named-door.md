# Observation writes: one named door, no raw `prisma.observation.create`

**Status:** proposed (2026-05-21)

## Context

ADR-0004 made `Observation.species` a nullable column denormalised
from the owning entity at write time, with point 4 of its decision
declaring: *"the `Observation` create / update paths in
`lib/server/observations.ts` (or wherever the canonical write helpers
live) require a `species` argument and refuse to construct a row
without it."* The intent was that the species-stamping invariant lives
at the application layer — the column allows `NULL` only as cover for
the migration window between the column add and the backfill.

ADR-0005 lines 95–104 explicitly carved out the observation-write seam
as the **separate** deepening that ADR-0005 deliberately did not do:
*"the observation-write species-stamping convention (ADR-0004 point 4;
the `createObservation` vs hand-rolled `prisma.observation.create` split
in `app/api/animals/[id]/photos`) is tracked as the **separate**
write-seam deepening. ADR-0005 makes reads/mutations unforgeable; the
write seam makes writes unforgeable; they cite each other and stay
distinct so the filter/data confusion the facade warns about is never
reintroduced."*

An audit on 2026-05-21 found **three** non-test call sites that bypass
`createObservation`:

- `app/api/animals/[id]/photos/route.ts:140` — raw
  `prisma.observation.create` with a hand-set `species: animal.species`.
- `lib/domain/tasks/update-task.ts` — raw `tx.observation.create` inside
  a `prisma.$transaction`, with the species-from-animal denormalisation
  re-implemented inline (and the same defensive `species ?? null`
  fallback the canonical door carried).
- `lib/domain/mobs/move-mob.ts` — **two** raw `tx.observation.create`
  calls for source-camp and dest-camp `mob_movement` rows. **No
  `species` field set at all.** Every mob movement since the column
  landed has produced two `NULL`-species rows on the
  `Observation_species_observedAt_idx` index.

The canonical door itself has the same hole (`create-observation.ts:109`:
`species = animal?.species ?? null`) — a missing animal silently
becomes a `NULL` row rather than throwing.

The consequence: ADR-0004 §5's NULL-tolerant read predicate
(`scoped(mode).observation.findMany` resolves to
`where: { OR: [{ species: mode }, { species: null }] }`) was supposed
to exist only for "the short window between the column add and the
backfill landing." The backfill has landed; the predicate cannot be
removed because three call sites plus the canonical door's defensive
fallback keep producing fresh `NULL` rows. The temporary cover has
become permanent because the seam was opt-in.

This is the same structural shape ADR-0005 cured for reads: an
invariant that exists by convention at a single call site, the
discipline-driven enforcement degrading to a permanent blind spot,
and the cure being a structural test that makes "forgot to scope" a
*compile-or-CI* error rather than a *production-NULL-row* error.

`CONTEXT.md` ("Observation writes") pins the vocabulary this ADR uses.

## Decision

Adopt a **single-named-door** architecture for `Observation` creation
on any tenant code path.

1. **`createObservation(client, input)`** is *the* writer. Signature
   change: `client: PrismaClient` becomes
   `client: ObservationWriter`, where `ObservationWriter` is
   `PrismaClient | TxClient` (`TxClient` being the
   `$transaction`-callback client type already derived inline in
   `update-task.ts`). The door is therefore callable both inline
   and inside a `$transaction` block — the load-bearing case for
   `move-mob.ts` and `update-task.ts`, which both need the
   observation create to be atomic with their sibling mutations.

2. **Species-stamping waterfall (replaces the
   `animal?.species ?? null` fallback).** Input adds an optional
   `mob_id` field. Resolution rule:

   1. `animal_id` given → animal's species; throw
      `AnimalNotFoundError` on lookup miss.
   2. Else `mob_id` given → mob's species; throw `MobNotFoundError`
      on lookup miss.
   3. Else if the resolved camp carries a species → camp's species.
   4. Else → `null` (back-compat for legacy single-species
      camp-only observations; removed when the audit confirms zero
      NULL rows in prod).

   The disagreement case (animal's species ≠ its mob's ≠ its
   camp's) is a schema invariant enforced by tests, not a runtime
   cost on every write.

3. **The observation-write invariant.** Raw
   `prisma.observation.create` / `tx.observation.create` is forbidden
   on any tenant code path. The only legal accessor is
   `createObservation`. The exemption is *structural*: the door
   module itself, `migrations/`, `prisma/`, `scripts/` seed and
   maintenance, test files. No pragma. No baseline.

4. **Enforcement is structural.** A new architecture test
   `__tests__/architecture/observation-write-no-direct-callers.test.ts`
   walks every non-exempt `.ts`/`.tsx` and fails CI on a
   `prisma.observation.create` / `tx.observation.create` outside the
   door module. Cloned shape-for-shape from
   `species-access-no-direct-prisma.test.ts` (ADR-0005's lockdown)
   and `sync-truth-no-direct-callers.test.ts` (ADR-0002's lockdown).
   Presence of the door, not presence of a `species:` key on the
   call. Binary — no baseline to grandfather.

5. **Same-wave ADR-0004 §5 closure.** The wave that ships this ADR
   also:
   - Runs `scripts/audit-observation-species.ts` against the
     wave's branch clone and confirms zero remaining NULL-species
     rows after the migration step below.
   - Backfills stragglers accumulated since ADR-0004's column-add
     migration: `UPDATE Observation SET species = (...)` for the
     mob-movement rows (from the destination camp's species) and
     for any other rows the door rule would now stamp.
   - Drops the `OR: [{ species: mode }, { species: null }]`
     branch from `scoped().observation` in
     `lib/server/species-scoped-prisma.ts` so the read predicate
     becomes `{ species: mode }` like the other three models.
   - Updates ADR-0004's status to note §5 closure.

## Why one door, not two

Three non-test call sites split into "inline write" (one site) and
"in-transaction write" (two sites). A two-door split
(`createObservation` for inline + `createObservationInTransaction` for
the tx case) would force the structural test to allow-list two modules
and split the species-stamping waterfall across both. Each new write
path would have to pick a door before the species rule applied,
inverting the locality the deepening exists to create. A single door
that accepts the union type keeps the invariant test binary, keeps the
waterfall in one place, and matches how `update-task.ts` already
parametrises the writer (it derives `TxClient` inline today — we lift
the type to the door module rather than invent a second module).

## Why a throw on missing animal/mob, not a `null` fallback

The pre-ADR-0006 door wrote `species = animal?.species ?? null` when
an `animal_id` was supplied but the lookup returned nothing. The FK
constraint on `Observation.animalId` means this can only happen on a
referential-integrity violation (deleted animal, FK loosened in the
schema, race with a concurrent delete). Defaulting that case to a
`NULL` row hides the violation as a normal "orphan" observation,
which the read side's NULL-tolerant predicate then silently includes
in every per-species query — the exact silent-leak class ADR-0005
exists to prevent on the read side. A typed
`AnimalNotFoundError` / `MobNotFoundError` makes the violation visible
at the caller, fails loud in tests, and never produces a
species-ambiguous row.

## Why same-wave §5 closure, not split

The §5 read-side cleanup (drop the NULL-tolerant `OR`-branch) is the
deletion-test proof that the door is doing its job. Splitting the
write-seam wave from the read-cleanup wave would mean a soak window
where the door is closed but the temporary read-side cover is still
in place — the elegant outcome (one place enforces species, the read
side trusts the column) is unobservable until both ship. The wave is
small enough (three call sites, one new test, one migration, one
predicate change in one file) that the per-branch-clone CI validation
is the right soak.

Splitting also runs the risk that wave 2 never ships — the §5 closure
is the kind of "1-line cleanup once the door is in place" task that
sits in the backlog for six months while a new write site re-opens the
hole. Bundling forces the cleanup to happen the moment it's safe.

## Rollout

One wave, off `wave/<NNN>-observation-write-door`.

**Architectural — needs Luc's explicit promote sign-off per the
arch-PR exception in CLAUDE.md. CI-green + open PR, then present.**

File allow-list for the TDD agent:

- `lib/domain/observations/create-observation.ts` — door deepening
  (accept `ObservationWriter`, add `mob_id`, change waterfall, throw
  on FK miss).
- `lib/domain/observations/errors.ts` — `AnimalNotFoundError`,
  `MobNotFoundError`.
- `lib/domain/observations/types.ts` (new) or inline in door —
  `ObservationWriter` union type.
- `app/api/animals/[id]/photos/route.ts` — migrate to door.
- `lib/domain/tasks/update-task.ts` — migrate to door (inside
  `prisma.$transaction`).
- `lib/domain/mobs/move-mob.ts` — migrate to door (inside
  `prisma.$transaction`, two calls, with `mob_id` populated).
- `__tests__/architecture/observation-write-no-direct-callers.test.ts`
  (new) — clone of `species-access-no-direct-prisma.test.ts`.
- `migrations/00NN_backfill_observation_species_stragglers.sql`
  (new) — backfill mob-movement + any other accumulated NULLs.
- `lib/server/species-scoped-prisma.ts` — drop NULL-tolerant
  predicate from `scoped().observation`.
- `docs/adr/0004-observation-species-column.md` — mark §5 closed.
- `docs/adr/0006-observation-write-named-door.md` — this file.
- `CONTEXT.md` — already updated alongside this ADR draft.

The agent writes the structural test first (RED), then deepens the
door, then migrates the three sites (GREEN), then runs the audit on
the branch clone, then ships the backfill + predicate drop in the
same PR.

No `lib/server/*` analytics or `lib/einstein/*` files touched —
those read, they don't write. The wave is read-side-invisible until
§5 closure, at which point per-species observation queries get one
predicate cheaper.
