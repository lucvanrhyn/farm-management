# `Observation.species`: nullable column + backfill from owning Animal, denormalised for fast filters

**Status:** accepted (2026-05-12)

## Context

PRD #222 closes the cosmetic-toggle gap. Most of the affected surface (animals list, camps, mobs, dashboard counts, map markers, logger camp tiles) filters via `Animal.species`, which already exists as a non-null `STRING DEFAULT 'cattle'` with `@@index([species, status])` from the Phase A multi-species migration. Adding a species filter to those queries is a one-liner against the facade introduced in #224.

`Observation` is the one model where the filter is **not** a one-liner. An observation belongs to an animal (or a mob, or a camp) and inherits its species from there — but `Observation.species` is not stored on the row, so a query like "show me every sheep health observation in May" has to JOIN through `Animal` (or `MobMembership` → `Animal`) every time. Three of the implementation slices (#231 `/sheep/observations` parity, #233 map filter, #234 logger camp-tile filter) all want a cheap species predicate on `Observation`. The schema decision is: do we keep the JOIN, or denormalise?

The four candidates considered:

1. **Status quo — JOIN on read.** Every observation list/map/tile filter joins through `Animal` or `MobMembership`.
2. **Add `Observation.species` as a non-null column with `DEFAULT 'cattle'`.** Matches the `Animal.species` pattern exactly. Backfill historical rows from the owning Animal.
3. **Add `Observation.species` as a nullable column.** Same as (2), but skip the backfill ordering pain. Filters use `species IS NULL OR species = ?` (or just enforce on writes going forward and treat NULL as "legacy cattle").
4. **Polymorphic species resolver in the application layer.** A `getObservationSpecies(obs)` helper that walks the FK chain in TS, possibly with a per-request cache. No schema change.

(1) loses on performance and ergonomics — every observation query in the new sheep namespace pays a JOIN tax forever, and the facade (#224) can't lint it because the species predicate lives in a JOIN clause rather than as a column-level `where`. (4) loses for the same reason and adds a cache-invalidation surface we don't need. The choice is between (2) and (3).

The deciding factor is **migration risk**. Adding a non-null column with a default to a 5-figure-row table on Turso is cheap on paper but has bitten us before (`feedback-vercel-cached-prisma-client.md` — Vercel function instances cache the Prisma client across cold starts; a column addition that's "applied" against the DB can still 500 for minutes against stale fn instances). A nullable column with a default-on-write enforced at the application layer gives us:

- A backwards-compatible migration: old code that doesn't write `species` keeps working; new code writes it explicitly.
- A trivial backfill that can run in a follow-up migration without blocking the column add.
- An easy invariant test (#231's TDD agent writes a vitest that asserts every new observation row has `species` populated).

## Decision

1. **Add `Observation.species` as a nullable `STRING` column.** No default at the DB layer. New writes populate it from the owning Animal's species (or the Mob's species, for mob-level observations).
2. **Backfill historical rows.** A single follow-up migration (`migrations/00NN_backfill_observation_species.sql`) populates `species` from `Animal.species` (via `animalId` FK) for the 99% case, and from `MobMembership.Animal.species` for mob-level observations where `animalId IS NULL`. Rows where neither resolution works (legacy orphan observations, if any exist) are left NULL and surfaced by a follow-up audit script.
3. **Add a covering index `@@index([species, observedAt])`** on `Observation`, matching the access patterns of #231 (sheep observations list, ordered by date) and #234 (recent observations per camp tile).
4. **Application layer enforces `species` on write.** The `Observation` create / update paths in `lib/server/observations.ts` (or wherever the canonical write helpers live) require a `species` argument and refuse to construct a row without it. The species-scoped Prisma facade from #224 routes the predicate through cleanly: `scoped(mode).observation.findMany(...)` injects `where: { species: mode }` automatically, just like it does for `Animal`.
5. **Reads tolerate NULL.** Until the backfill migration lands and any orphan-NULL rows are audited, `scoped(mode).observation.findMany(...)` resolves to `where: { OR: [{ species: mode }, { species: null }] }`. The NULL-tolerant branch is removed in a follow-up cleanup wave (out of scope for #231) once the audit confirms zero orphan rows in prod.

## Why nullable instead of `DEFAULT 'cattle'` non-null

We've been bitten three times this year by "default to cattle" assumptions:
- Phase A multi-species (#28) had to add the species column to `Animal` with `DEFAULT 'cattle'` and immediately spawned the audit that became `audit-species-where` (#224's lint guard) because every existing query silently filtered out sheep.
- The Observation feed was the original site of the cosmetic-toggle bug — the dashboard counts the user saw on `mode=sheep` were "cattle counts that happened to be observation-filtered correctly somewhere else." Defaulting `Observation.species` to `'cattle'` would re-introduce the exact failure mode #224 is designed to prevent: a row that *appears* to have a real species value, doesn't, and silently gets included in cattle-mode queries.
- The Trio B Boerdery walkthrough during the 2026-05-12 stress test surfaced `—` placeholders rendering because the farm hadn't picked a species — defaulting their data to cattle would have hidden the configuration gap rather than surfacing it.

A NULL column tells reads "this row's species hasn't been resolved yet, decide explicitly how to treat it." A `DEFAULT 'cattle'` column lies. The application-layer enforcement on writes (point 4 above) means we never *create* NULL rows going forward; the NULL-tolerant read predicate (point 5) exists only for the short window between the column add and the backfill landing.

## Why a covering index and not just `[species]`

`Observation.observedAt` is in the order-by clause of every observation list view that matters (`/admin/observations`, `/sheep/observations`, the logger camp-tile recent-observations stripe, the dashboard alert feed). A single-column `[species]` index forces the planner to read the species slice and then sort by `observedAt` — fine on a small farm, expensive on a large one as the observation table grows. The `[species, observedAt]` covering index lets the planner walk the slice in already-sorted order.

This mirrors the `Animal.[species, status]` covering index from Phase A multi-species, which exists for the same reason (animals list is filtered by species and ordered by status).

## Migration sequence

Issue #231 owns the implementation. The schema delta lands in two migrations to keep the column-add and backfill atomically separated (so a rollback of the backfill doesn't drop the column, and vice versa):

1. **`migrations/00NN_observation_species_column.sql`** — `ALTER TABLE Observation ADD COLUMN species TEXT;` + `CREATE INDEX Observation_species_observedAt_idx ON Observation(species, observedAt);` + `prisma/schema.prisma` update (`species String?` with `@@index([species, observedAt])`).
2. **`migrations/00NN+1_backfill_observation_species.sql`** — `UPDATE Observation SET species = (SELECT species FROM Animal WHERE Animal.id = Observation.animalId) WHERE species IS NULL AND animalId IS NOT NULL;` plus the mob-fallback variant. Audit script (`scripts/audit-observation-species.ts`, new) reports any remaining NULL rows.

Both migrations soak on the wave's branch clone before promote (per CLAUDE.md §branching-workflow — soak gate currently 0h since Wave 179, but the per-branch clone validation still runs).

## Implementation consequences for #231 and downstream slices

- **#231 (`/sheep/observations` parity)** consumes this ADR as its plan. The slice ships both migrations, the application-layer enforcement, the NULL-tolerant read predicate, and the new page itself in one PR. The TDD agent writes failing tests against `Observation.species` first (column exists, writes populate it, reads filter correctly), then implements.
- **#233 (map filter)** and **#234 (logger camp tiles)** can ship before #231 lands. They filter by `Animal.species` via the facade — the `Observation.species` column isn't on their critical path. They consume this ADR only as a forward-reference: "once #231 lands, the map's recent-observations marker can additionally filter by `Observation.species` for an extra speedup."
- **The facade (#224)** doesn't need to know about `Observation.species` yet when it ships in Wave 1. The facade adds species predicates for models that have a `species` column, and at Wave 1 time `Observation` doesn't. Once #231 lands the migrations, the facade picks up `Observation` automatically — the `audit-species-where` lint extends to it without code change because the lint checks "models that have a species column must have it in their where clause."

## Rollout

ADR-0004 ships as a single PR off `wave/230-adr-observation-species`. No code changes; documents the schema decision so #231's agent has a concrete plan to consume rather than re-deriving the trade-offs.

The migration itself ships with #231 (Wave 5 in the wave plan, blocked by #224 + ADR-0003 #223 + the Wave 3 sheep namespace bundle).
