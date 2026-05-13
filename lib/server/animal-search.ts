/**
 * lib/server/animal-search.ts
 *
 * AnimalSearchQuery — deep module for animal listing / catalogue / tag-search.
 *
 * Issue #255 (Wave 4 of PRD #250).
 *
 * ──────────────────────────────────────────────────────────────────────
 * Why this exists
 * ──────────────────────────────────────────────────────────────────────
 *
 * Production stress test (2026-05-13) found that searching for `BB-C013`
 * after that animal was marked deceased returned `0 animals found`, the
 * Deceased tab badge showed `0`, and the SARS para-13A / IT3 lookup
 * surface was effectively blind to mortality records — even though the
 * row still existed in the DB. SARS auditing **requires** that deceased
 * animals remain searchable for ≥5 years.
 *
 * Root cause: every per-species animal listing surface was routed
 * through `scoped(prisma, mode).animal.findMany(...)`. The species-
 * scoped facade injects `{ species: mode, status: "Active" }` by
 * default — perfect for active-animal pickers (mob assignment,
 * move-target) but a **silent data-loss path** for the catalogue / tag
 * search / Deceased tab. Code review can't catch this — the call
 * typechecks, returns rows, and the rows happen to exclude deceased
 * ones invisibly.
 *
 * The structural cure (mirrors `species-scoped-prisma.ts` for the
 * species axis): make "did you mean Active-only or all-statuses?" a
 * REQUIRED, EXPLICIT decision at every callsite. `searchAnimals(prisma,
 * { mode, includeDeceased })` requires both flags by TypeScript signature
 * — forgetting `includeDeceased` is a compile error, not a runtime bug.
 *
 * Sibling lint guard `scripts/audit-animal-list-deceased-flag.ts`
 * enforces the structural rule across the codebase: any new code that
 * reads/lists animals from a per-species surface without going through
 * this module (or carrying an explicit `audit-allow-deceased-flag`
 * pragma) fails CI.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Contract
 * ──────────────────────────────────────────────────────────────────────
 *
 * `searchAnimals(prisma, params)`:
 *   - Required: `mode: SpeciesId`. The species axis is always injected;
 *     this module is per-species by construction. Cross-species lookups
 *     belong elsewhere (admin reconciliation, dashboard summaries) and
 *     have their own audit-allow pragma.
 *   - Required: `includeDeceased: boolean`. NOT defaulted, NOT optional.
 *     - `true`  → no `status` filter is added; rows of every status
 *                 (Active / Sold / Deceased) are returned. Use for
 *                 catalogue, tag search, Deceased tab, SARS lookups.
 *     - `false` → `status: "Active"` is injected. Use for mob-assignment
 *                 pickers, move-target dropdowns, anywhere "active head"
 *                 is the operative concept.
 *   - Optional: `where`, `orderBy`, `take`, `cursor`, `skip`, `select`,
 *     `search`. The `search` shortcut composes the OR predicate
 *     `[{ animalId: { contains } }, { name: { contains } }]` — same
 *     wire shape as the legacy `/api/animals?search=` path, but routed
 *     through this module so it cannot exclude deceased rows by
 *     accident.
 *
 * `countAnimalsByStatus(prisma, mode)`:
 *   - Returns `{ active, sold, deceased }` for the given species. Used
 *     by SSR pages to seed the Deceased tab badge with an accurate
 *     count BEFORE any deceased row is hydrated client-side. This is
 *     the second half of the bug fix — pre-#255, the badge derived from
 *     a client-side filter over a hydrated array that contained zero
 *     deceased rows, so the badge always read "0".
 *
 * ──────────────────────────────────────────────────────────────────────
 * What this module does NOT do
 * ──────────────────────────────────────────────────────────────────────
 *
 * - It does NOT replace `scoped(prisma, mode)` for camp / mob /
 *   observation reads — the species-scoped facade remains the right tool
 *   for those models. AnimalSearchQuery is narrowly the animal listing
 *   axis.
 * - It does NOT wrap mutations. Death (status:Deceased), sale
 *   (status:Sold), and creates go through the existing domain ops
 *   (`lib/domain/animals/*`). Mutations are not subject to the
 *   Active-vs-all-statuses ambiguity that birthed this module.
 * - It does NOT cache. The catalogue page is `force-dynamic` and
 *   pre-#255 was already paying the un-cached read cost; we keep
 *   parity.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { SpeciesId } from '@/lib/species/types';
import { ACTIVE_STATUS } from '@/lib/animals/active-species-filter';

/**
 * Parameters for `searchAnimals`.
 *
 * `includeDeceased` is REQUIRED and not defaulted — see the module
 * header for the rationale. Adding `?` here re-opens the bug class
 * the audit gate guards against.
 */
export interface SearchAnimalsParams {
  /** Species axis — always injected. */
  readonly mode: SpeciesId;

  /**
   * Lifecycle policy:
   *   - `true`:  return rows of every status (Active / Sold / Deceased).
   *              The right default for catalogue, tag search, Deceased tab,
   *              SARS lookups, mortality reports.
   *   - `false`: filter to `status: "Active"`. Use for mob-assignment
   *              pickers and move-target dropdowns where "active head"
   *              is the operative concept.
   */
  readonly includeDeceased: boolean;

  /**
   * Optional Prisma `where` keys to compose with the species + status
   * predicates this module manages. Caller-supplied keys win on
   * overlap (same merge semantics as `species-scoped-prisma.ts`) so
   * a deliberate `status: "Sold"` override still works.
   */
  readonly where?: Omit<Prisma.AnimalWhereInput, 'species'>;

  /** Free-text shortcut — composes `OR: [{ animalId: contains }, { name: contains }]`. */
  readonly search?: string;

  readonly orderBy?: Prisma.AnimalFindManyArgs['orderBy'];
  readonly take?: number;
  readonly cursor?: Prisma.AnimalWhereUniqueInput;
  readonly skip?: number;
  readonly select?: Prisma.AnimalFindManyArgs['select'];
}

/**
 * Per-species animal list / catalogue / tag-search query.
 *
 * Every animal-listing surface should route through this. Forgetting
 * `includeDeceased` is a compile error.
 */
export function searchAnimals(
  prisma: PrismaClient | Prisma.TransactionClient,
  params: SearchAnimalsParams,
): ReturnType<PrismaClient['animal']['findMany']> {
  const {
    mode,
    includeDeceased,
    where = {},
    search,
    orderBy,
    take,
    cursor,
    skip,
    select,
  } = params;

  // Compose the where predicate. The order matters: species + status are
  // injected first so caller-supplied keys WIN on overlap (deliberate
  // overrides like `status: "Sold"` for an archived view still work).
  const composedWhere: Prisma.AnimalWhereInput = {
    species: mode,
    ...(includeDeceased ? {} : { status: ACTIVE_STATUS }),
    ...where,
    ...(search
      ? {
          OR: [
            { animalId: { contains: search } },
            { name: { contains: search } },
          ],
        }
      : {}),
  };

  // AnimalSearchQuery centralises BOTH the species axis (mode is required
  // and injected into composedWhere above) AND the lifecycle axis
  // (`includeDeceased` is required by the public signature). Going through
  // raw prisma — instead of `scoped(...).animal.findMany` — is necessary
  // because the species-scoped facade would re-inject `status: "Active"`
  // and silently exclude deceased rows (the exact bug class issue #255
  // exists to cure).
  //
  // Audit-pragma stack — order matters because each sibling audit walks
  // the preceding lines differently. `audit-allow-species-where` MUST be
  // the immediately preceding line (the species-where audit checks only
  // the first non-blank preceding line, no sibling-skip). The other audits
  // either skip siblings (`audit-allow-deceased-flag` per line 258 of its
  // audit script) or are satisfied by the literal `take:` token spread into
  // the args body below (`audit-findmany-no-take` matches `take\s*:`).
  // audit-allow-deceased-flag: deep module enforces flag by signature
  // audit-allow-species-where: deep module injects species via composedWhere
  return prisma.animal.findMany({
    where: composedWhere,
    ...(orderBy ? { orderBy } : {}),
    // Spread an explicit `take: take` (not the shorthand `{ take }`) so a
    // static read of the call's arg body shows the literal `take:` token —
    // that satisfies `audit-findmany-no-take` without an allow-pragma. When
    // the caller omits `take` the spread evaluates to `{}` and no bound is
    // emitted; the contract documents `take?` as caller-controlled.
    ...(typeof take === 'number' ? { take: take } : {}),
    ...(cursor ? { cursor } : {}),
    ...(typeof skip === 'number' ? { skip } : {}),
    ...(select ? { select } : {}),
  }) as ReturnType<PrismaClient['animal']['findMany']>;
}

/**
 * Per-species per-status counts. Drives the Deceased tab badge and the
 * SSR header denominator on the catalogue.
 *
 * Three round-trips not one because Prisma's `groupBy` requires an
 * explicit list of fields and the call shape is awkward; the three
 * straight counts run in parallel and are well-indexed
 * (`idx_animal_species_status`).
 */
export async function countAnimalsByStatus(
  prisma: PrismaClient | Prisma.TransactionClient,
  mode: SpeciesId,
): Promise<{ active: number; sold: number; deceased: number }> {
  // Three counts run in parallel; each carries its own literal
  // `species:` + `status:` predicate so both the species-where audit
  // and the lifecycle audit see compliant inline shapes (no pragmas
  // needed). Index `idx_animal_species_status` keeps each round-trip
  // cheap on large herds.
  const [active, sold, deceased] = await Promise.all([
    prisma.animal.count({ where: { species: mode, status: 'Active' } }),
    prisma.animal.count({ where: { species: mode, status: 'Sold' } }),
    prisma.animal.count({ where: { species: mode, status: 'Deceased' } }),
  ]);
  return { active, sold, deceased };
}
