/**
 * lib/server/species-scoped-prisma.ts
 *
 * Species-scoped Prisma facade — PRD #222 / issue #224.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Why this file exists
 * ──────────────────────────────────────────────────────────────────────
 *
 * FarmTrack is a multi-species app. On a multi-species tenant DB the
 * `Animal`, `Camp`, `Mob`, and `Observation` tables hold rows for cattle,
 * sheep, and game side-by-side. Every per-species surface (admin tables,
 * dashboards, mob pickers, etc.) reads the active mode from the
 * `farmtrack-mode-<slug>` cookie via `getFarmMode(slug)` and is expected
 * to filter Prisma reads by that mode.
 *
 * Pre-#224, every per-species callsite did this manually:
 *
 *     const mode = await getFarmMode(farmSlug);
 *     const animals = await prisma.animal.findMany({
 *       where: { species: mode, status: "Active" },
 *     });
 *
 * The bug class: a developer adds a new per-species surface, forgets the
 * `species: mode` predicate, and ships a page that silently leaks rows
 * from every species onto the tenant's cattle dashboard. Same bug class
 * as PRD #128's `Animal.species` schema drift, but rooted in *call-site
 * ergonomics* instead of *schema drift*. Code review can't catch it
 * reliably — the call still typechecks and still returns rows.
 *
 * This facade is the structural cure. Callers do not (and cannot) write
 * `prisma.animal.findMany(...)` on a per-species surface. They write:
 *
 *     const mode = await getFarmMode(farmSlug);
 *     const animals = await scoped(prisma, mode).animal.findMany({});
 *
 * `mode: SpeciesId` is a required positional argument — forgetting it is
 * a compile error, not a runtime bug. The sibling lint guard
 * (`scripts/audit-species-where.ts`) enforces the structural rule across
 * the codebase: any `prisma.animal.findMany` (and friends) that lacks
 * a top-level `species:` predicate fails CI.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Contract — what the facade injects
 * ──────────────────────────────────────────────────────────────────────
 *
 * - **Animal reads (`findMany`, `findFirst`, `findUnique`, `groupBy`)**
 *   inject `{ species, status: "Active" }`. The dominant per-species
 *   surface (admin animal list, camp animal panel) wants Active-only by
 *   default. Callers who need inactive rows (e.g. tax exports, historical
 *   reports) override by passing `where: { status: "Sold" }` — the
 *   facade's spread merge ensures caller-supplied keys WIN over defaults,
 *   so `species` injection is preserved but `status` is replaced.
 *
 * - **Animal count** injects `species` only. `count()` is used for both
 *   "Active head" (where caller adds `status: "Active"`) and "All head
 *   including inactive" (where caller leaves status off). Forcing
 *   status into the predicate would silently narrow the second case.
 *
 * - **Animal mutations (`update`/`delete`/`updateMany`/`deleteMany`)**
 *   inject `species` only. Mutations like "mark all sheep in camp X as
 *   Sold" must touch both Active and inactive rows of the species; a
 *   `status: "Active"` injection would silently exclude already-Sold or
 *   Dead rows of the species (rare but legitimate corrective updates).
 *
 * - **Camp / Mob** inject `species` always. Both tables have a NOT NULL
 *   `species` column (migrations 0010 / 0011, see ADR for #28).
 *
 * - **Observation** injects `species` against the denormalised column
 *   added by migration 0003 (Phase I.3). The column is nullable to
 *   tolerate orphan rows (animalId references a deleted animal) and
 *   pre-backfill data — rows where `species IS NULL` are intentionally
 *   excluded from per-species feeds. A future cross-species observation
 *   feed (e.g. farm-wide audit log) goes through `prisma.observation`
 *   directly with an `audit-allow-species-where:` pragma.
 *
 *   Note (per #224 brief): an earlier draft of the facade routed
 *   observation filtering through `where: { animal: { species: mode } }`
 *   (relation JOIN) because the column hadn't been backfilled. As of
 *   migration 0003 the column exists and is populated; we filter on it
 *   directly. The JOIN form is recoverable by writing the predicate
 *   explicitly outside the facade — `prisma.observation.findMany({
 *   where: { animal: { species: mode } } })` — with an
 *   `audit-allow-species-where: relation join needed for orphan rows`
 *   pragma if you genuinely need the JOIN semantics.
 *
 * ──────────────────────────────────────────────────────────────────────
 * What the facade does NOT do
 * ──────────────────────────────────────────────────────────────────────
 *
 * - It does NOT manage transactions. Callers use `prisma.$transaction`
 *   directly and pass the tx-bound client into `scoped(tx, mode)`.
 * - It does NOT wrap creates. Creating an animal/camp/mob/observation
 *   requires a `species` value in the row data, and conflating
 *   `create({ data: ... })` with the facade's species axis would let
 *   a caller create cattle while mode is sheep — a different bug class
 *   than this audit covers. Use `prisma.<model>.create` directly; the
 *   lint guard does not flag creates.
 * - It does NOT wrap `findUniqueOrThrow` / `findFirstOrThrow`. They are
 *   strict lookups (typically by primary key) that don't benefit from
 *   species injection — a row either exists or it doesn't. Use raw
 *   `prisma.<model>.findUniqueOrThrow` if you genuinely need it.
 *
 * The facade is intentionally narrow: animal/camp/mob/observation, the
 * dominant read paths and the mutation paths that span result-sets. Any
 * other call goes through raw `prisma` unchanged.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { SpeciesId } from '@/lib/species/types';
import { ACTIVE_STATUS } from '@/lib/animals/active-species-filter';

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Merge a facade-injected `where` predicate with the caller's args.
 * Caller-supplied keys WIN over the injected defaults. This is the
 * "default + override" merge pattern used elsewhere in the codebase
 * (see `lib/notification-generator.ts` for the same shape).
 */
function mergeWhere<W extends object>(
  injected: Partial<W>,
  callerArgs: { where?: W | undefined } | undefined,
): W {
  return { ...injected, ...(callerArgs?.where ?? {}) } as W;
}

// ─── Builder shapes ───────────────────────────────────────────────────
//
// Each method on the builder takes the Prisma operation's args type and
// returns whatever the underlying delegate returns. We DON'T try to mirror
// Prisma's full `<T extends Args>` generic form because that machinery
// exists to refine the return type from `select`/`include` choices on the
// args. The facade preserves caller-supplied `select`/`include` verbatim
// (it spreads `...args` into the dispatched call), so the underlying
// Prisma client still narrows the return type at the call site.
//
// The trade-off: callers that want the refined return shape can `await
// scoped(prisma, mode).animal.findMany({ select: { id: true } })` and
// destructure with `(a) => a.id` (which compiles because Prisma's client
// inference fires when the dispatched call resolves), but TS at the
// facade boundary returns `ReturnType<delegate['findMany']>` —
// i.e. the broadest possible Prisma return shape. For the contract this
// audit cares about (the `where` axis), that's fine.

type AnimalDelegate = PrismaClient['animal'];
type CampDelegate = PrismaClient['camp'];
type MobDelegate = PrismaClient['mob'];
type ObservationDelegate = PrismaClient['observation'];

interface AnimalBuilder {
  findMany(args?: Prisma.AnimalFindManyArgs): ReturnType<AnimalDelegate['findMany']>;
  findFirst(args?: Prisma.AnimalFindFirstArgs): ReturnType<AnimalDelegate['findFirst']>;
  findUnique(args: Prisma.AnimalFindUniqueArgs): ReturnType<AnimalDelegate['findUnique']>;
  count(args?: Prisma.AnimalCountArgs): ReturnType<AnimalDelegate['count']>;
  groupBy(args: Prisma.AnimalGroupByArgs): ReturnType<AnimalDelegate['groupBy']>;
  updateMany(args: Prisma.AnimalUpdateManyArgs): ReturnType<AnimalDelegate['updateMany']>;
  deleteMany(args?: Prisma.AnimalDeleteManyArgs): ReturnType<AnimalDelegate['deleteMany']>;
}

interface CampBuilder {
  findMany(args?: Prisma.CampFindManyArgs): ReturnType<CampDelegate['findMany']>;
  findFirst(args?: Prisma.CampFindFirstArgs): ReturnType<CampDelegate['findFirst']>;
  count(args?: Prisma.CampCountArgs): ReturnType<CampDelegate['count']>;
  updateMany(args: Prisma.CampUpdateManyArgs): ReturnType<CampDelegate['updateMany']>;
  deleteMany(args?: Prisma.CampDeleteManyArgs): ReturnType<CampDelegate['deleteMany']>;
}

interface MobBuilder {
  findMany(args?: Prisma.MobFindManyArgs): ReturnType<MobDelegate['findMany']>;
  findFirst(args?: Prisma.MobFindFirstArgs): ReturnType<MobDelegate['findFirst']>;
  count(args?: Prisma.MobCountArgs): ReturnType<MobDelegate['count']>;
  updateMany(args: Prisma.MobUpdateManyArgs): ReturnType<MobDelegate['updateMany']>;
  deleteMany(args?: Prisma.MobDeleteManyArgs): ReturnType<MobDelegate['deleteMany']>;
}

interface ObservationBuilder {
  findMany(args?: Prisma.ObservationFindManyArgs): ReturnType<ObservationDelegate['findMany']>;
  findFirst(args?: Prisma.ObservationFindFirstArgs): ReturnType<ObservationDelegate['findFirst']>;
  count(args?: Prisma.ObservationCountArgs): ReturnType<ObservationDelegate['count']>;
  updateMany(args: Prisma.ObservationUpdateManyArgs): ReturnType<ObservationDelegate['updateMany']>;
  deleteMany(args?: Prisma.ObservationDeleteManyArgs): ReturnType<ObservationDelegate['deleteMany']>;
}

export interface SpeciesScopedPrisma {
  readonly animal: AnimalBuilder;
  readonly camp: CampBuilder;
  readonly mob: MobBuilder;
  readonly observation: ObservationBuilder;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Wrap a PrismaClient (or a `$transaction` tx client) so that every
 * animal/camp/mob/observation operation is filtered to the given species.
 *
 * The `mode: SpeciesId` parameter is REQUIRED — calling `scoped(prisma)`
 * without it is a TypeScript error. This is the structural contract that
 * issue #224 locks in.
 *
 * @param prisma — the underlying client (singleton or tx-bound)
 * @param mode   — the SpeciesId to filter by. Read from
 *                 `getFarmMode(farmSlug)` for cookie-driven surfaces.
 */
export function scoped(
  prisma: PrismaClient | Prisma.TransactionClient,
  mode: SpeciesId,
): SpeciesScopedPrisma {
  const animal: AnimalBuilder = {
    findMany(args) {
      // audit-allow-findmany-no-select: facade forwarder; row bound (take/where) and column projection (select/omit) are enforced at the scoped() callsite, not here. (`audit-allow-findmany-no-select` is recognised by both the no-take and no-select audits — the no-take pragma regex matches `audit-allow-findmany\b` so the longer no-select pragma satisfies both, keeping us to a single comment per forwarder.)
      return prisma.animal.findMany({
        ...(args ?? {}),
        where: mergeWhere<Prisma.AnimalWhereInput>(
          { species: mode, status: ACTIVE_STATUS },
          args,
        ),
      }) as ReturnType<AnimalDelegate['findMany']>;
    },
    findFirst(args) {
      return prisma.animal.findFirst({
        ...(args ?? {}),
        where: mergeWhere<Prisma.AnimalWhereInput>(
          { species: mode, status: ACTIVE_STATUS },
          args,
        ),
      }) as ReturnType<AnimalDelegate['findFirst']>;
    },
    findUnique(args) {
      // `where` on findUnique is `AnimalWhereUniqueInput`, a different
      // (narrower) shape than the other operations. The Prisma-generated
      // type still accepts `species` as an optional non-key filter because
      // the field exists on Animal — we cast through Partial to satisfy
      // the type checker without redeclaring the union.
      return prisma.animal.findUnique({
        ...args,
        where: mergeWhere<Prisma.AnimalWhereUniqueInput>(
          { species: mode } as Partial<Prisma.AnimalWhereUniqueInput>,
          args,
        ),
      }) as ReturnType<AnimalDelegate['findUnique']>;
    },
    // count: species only — status stays caller-controlled. See contract note.
    count(args) {
      return prisma.animal.count({
        ...(args ?? {}),
        where: mergeWhere<Prisma.AnimalWhereInput>({ species: mode }, args),
      }) as ReturnType<AnimalDelegate['count']>;
    },
    groupBy(args) {
      return (prisma.animal.groupBy as (a: Prisma.AnimalGroupByArgs) => unknown)({
        ...args,
        where: mergeWhere<Prisma.AnimalWhereInput>({ species: mode }, args),
      }) as ReturnType<AnimalDelegate['groupBy']>;
    },
    updateMany(args) {
      return prisma.animal.updateMany({
        ...args,
        where: mergeWhere<Prisma.AnimalWhereInput>({ species: mode }, args),
      }) as ReturnType<AnimalDelegate['updateMany']>;
    },
    deleteMany(args) {
      return prisma.animal.deleteMany({
        ...(args ?? {}),
        where: mergeWhere<Prisma.AnimalWhereInput>({ species: mode }, args),
      }) as ReturnType<AnimalDelegate['deleteMany']>;
    },
  };

  const camp: CampBuilder = {
    findMany(args) {
      // audit-allow-findmany-no-select: facade forwarder; row bound (take/where) and column projection (select/omit) are enforced at the scoped() callsite, not here. (`audit-allow-findmany-no-select` is recognised by both the no-take and no-select audits — the no-take pragma regex matches `audit-allow-findmany\b` so the longer no-select pragma satisfies both, keeping us to a single comment per forwarder.)
      return prisma.camp.findMany({
        ...(args ?? {}),
        where: mergeWhere<Prisma.CampWhereInput>({ species: mode }, args),
      }) as ReturnType<CampDelegate['findMany']>;
    },
    findFirst(args) {
      return prisma.camp.findFirst({
        ...(args ?? {}),
        where: mergeWhere<Prisma.CampWhereInput>({ species: mode }, args),
      }) as ReturnType<CampDelegate['findFirst']>;
    },
    count(args) {
      return prisma.camp.count({
        ...(args ?? {}),
        where: mergeWhere<Prisma.CampWhereInput>({ species: mode }, args),
      }) as ReturnType<CampDelegate['count']>;
    },
    updateMany(args) {
      return prisma.camp.updateMany({
        ...args,
        where: mergeWhere<Prisma.CampWhereInput>({ species: mode }, args),
      }) as ReturnType<CampDelegate['updateMany']>;
    },
    deleteMany(args) {
      return prisma.camp.deleteMany({
        ...(args ?? {}),
        where: mergeWhere<Prisma.CampWhereInput>({ species: mode }, args),
      }) as ReturnType<CampDelegate['deleteMany']>;
    },
  };

  const mob: MobBuilder = {
    findMany(args) {
      // audit-allow-findmany-no-select: facade forwarder; row bound (take/where) and column projection (select/omit) are enforced at the scoped() callsite, not here. (`audit-allow-findmany-no-select` is recognised by both the no-take and no-select audits — the no-take pragma regex matches `audit-allow-findmany\b` so the longer no-select pragma satisfies both, keeping us to a single comment per forwarder.)
      return prisma.mob.findMany({
        ...(args ?? {}),
        where: mergeWhere<Prisma.MobWhereInput>({ species: mode }, args),
      }) as ReturnType<MobDelegate['findMany']>;
    },
    findFirst(args) {
      return prisma.mob.findFirst({
        ...(args ?? {}),
        where: mergeWhere<Prisma.MobWhereInput>({ species: mode }, args),
      }) as ReturnType<MobDelegate['findFirst']>;
    },
    count(args) {
      return prisma.mob.count({
        ...(args ?? {}),
        where: mergeWhere<Prisma.MobWhereInput>({ species: mode }, args),
      }) as ReturnType<MobDelegate['count']>;
    },
    updateMany(args) {
      return prisma.mob.updateMany({
        ...args,
        where: mergeWhere<Prisma.MobWhereInput>({ species: mode }, args),
      }) as ReturnType<MobDelegate['updateMany']>;
    },
    deleteMany(args) {
      return prisma.mob.deleteMany({
        ...(args ?? {}),
        where: mergeWhere<Prisma.MobWhereInput>({ species: mode }, args),
      }) as ReturnType<MobDelegate['deleteMany']>;
    },
  };

  const observation: ObservationBuilder = {
    findMany(args) {
      // audit-allow-findmany-no-select: facade forwarder; row bound (take/where) and column projection (select/omit) are enforced at the scoped() callsite, not here. (`audit-allow-findmany-no-select` is recognised by both the no-take and no-select audits — the no-take pragma regex matches `audit-allow-findmany\b` so the longer no-select pragma satisfies both, keeping us to a single comment per forwarder.)
      return prisma.observation.findMany({
        ...(args ?? {}),
        where: mergeWhere<Prisma.ObservationWhereInput>({ species: mode }, args),
      }) as ReturnType<ObservationDelegate['findMany']>;
    },
    findFirst(args) {
      return prisma.observation.findFirst({
        ...(args ?? {}),
        where: mergeWhere<Prisma.ObservationWhereInput>({ species: mode }, args),
      }) as ReturnType<ObservationDelegate['findFirst']>;
    },
    count(args) {
      return prisma.observation.count({
        ...(args ?? {}),
        where: mergeWhere<Prisma.ObservationWhereInput>({ species: mode }, args),
      }) as ReturnType<ObservationDelegate['count']>;
    },
    updateMany(args) {
      return prisma.observation.updateMany({
        ...args,
        where: mergeWhere<Prisma.ObservationWhereInput>({ species: mode }, args),
      }) as ReturnType<ObservationDelegate['updateMany']>;
    },
    deleteMany(args) {
      return prisma.observation.deleteMany({
        ...(args ?? {}),
        where: mergeWhere<Prisma.ObservationWhereInput>({ species: mode }, args),
      }) as ReturnType<ObservationDelegate['deleteMany']>;
    },
  };

  return { animal, camp, mob, observation };
}
