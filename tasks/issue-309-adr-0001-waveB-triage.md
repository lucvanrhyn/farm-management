# Issue #309 — ADR-0001 Wave B completion (camps + animals) — program triage

**Not a new decision.** ADR-0001 already names camps + animals as Wave B
domain-extraction areas and defines the pattern (`lib/domain/<area>/` pure ops
on `(prisma, input)`, typed errors mapped by `mapApiDomainError`, routes shrink
to adapter wiring). The canonical mirror is `lib/domain/mobs/` (Wave B #151);
the most recent precedent is `lib/domain/observations/` (Wave C, see
`tasks/wave-156-observations-domain.md`). **No new ADR.**

Decomposed into independent, behaviour-preserving sub-waves. Per the §per-wave
dispatch convention these are **never bundled** — one TDD agent each, shipped
and merged before the next starts.

## Sub-waves

### 309a — camps domain (this wave; zero coverage today → highest gap)
`lib/domain/camps/` does not exist. `app/api/camps/[campId]/route.ts` (140 L,
`adminWrite` adapter) carries inline PATCH (existence check + optional-field
update construction) and DELETE (existence + active-animal 409 guard).
→ Extract `updateCamp` / `deleteCamp` + `errors.ts` + `index.ts` + tests;
route shrinks to adapter wiring. Plan: `tasks/wave-309a-camps-domain.md`.

### 309b — animals domain completion
`lib/domain/animals/` has only `create-animal.ts`. `app/api/animals/[id]/
route.ts` (144 L) carries inline GET + PATCH with ~70 L business logic: the
LOGGER/ADMIN field allowlist, the #28 cross-species parent guard, the #98
cross-species camp guard (via `requireSpeciesScopedCamp` +
`CrossSpeciesBlockedError`). → Add `update-animal` / `delete-animal` /
`get-animal` (+ `list-animals` if a list route exists), `errors.ts`,
`index.ts`, tests. The cross-species guard becomes the explicit test surface
and is reusable by the CSV importer / Inngest workers (ADR-0001's stated reuse
goal). Note: `CrossSpeciesBlockedError` currently lives oddly in
`lib/domain/mobs/move-mob` — 309b should evaluate centralising it. Separate
plan written at 309b dispatch time.

### 309c — profitability-by-animal domain extraction (folded from #310)
`lib/server/profitability-by-animal.ts` (single-caller fetch + tagged-vs-camp
transaction partition → forwards to `lib/calculators/profitability-per-animal`)
sits behind an already-migrated `tenantReadSlug` route (Wave G4 #168).
Inlining into the route would contradict ADR-0001's thin-adapter principle;
correct treatment is extraction to `lib/domain/` (likely
`lib/domain/transactions/` — confirm at dispatch). Behaviour zero-change;
re-home its test. Separate plan at 309c dispatch time.

## Shared conventions (all sub-waves)

- Mirror `lib/domain/mobs/` exactly: ops as `(prisma, input)` → JSON-serialisable
  data, throw typed errors; `index.ts` re-export surface; `__tests__/` vitest
  per op with a mocked Prisma double.
- Typed errors map via `lib/server/api-errors.ts` `mapApiDomainError`. Reuse
  existing error classes where the wire code already matches; only add new ones
  for genuinely new failure modes.
- **Behaviour-preserving.** Zero wire change unless an existing test/client
  proves the canonical-envelope direction is already expected for that route.
  Default: preserve current status codes + response bodies exactly. Message-
  bearing 409s mirror `MobHasAnimalsError` (message preserved on the wire).
- Zero migrations / no `prisma/schema.prisma` change in any sub-wave.
- Each route that becomes fully adapter-wired comes out of any EXEMPT set in
  `__tests__/api/route-handler-coverage.test.ts` (mirror Wave C).
- §promote-delegation **routine documented-issue path** applies (no ADR, no
  auth/payment/migration surface, behaviour-preserving) — NOT the arch-PR
  explicit-signoff exception. Ship through merge on green required CI.

## Sub-wave status

- **309a — camps domain** — ✅ SHIPPED (PR #312, merged into origin/main
  @ 3b52376).
- **309b — animals domain completion** — ✅ DONE.
  `app/api/animals/[id]` GET+PATCH extracted into
  `lib/domain/animals/{get-animal,update-animal}.ts` + `errors.ts`;
  `index.ts` expanded to the full public surface (re-exports the existing
  `createAnimal` + the new ops/errors, mirroring `lib/domain/mobs/index.ts`).
  Route shrank to `tenantRead` / `tenantWrite` adapter wiring (kept
  `revalidateAnimalWrite`). **Wire byte-identical** — incl. the LOGGER/ADMIN
  authz 403 envelope (`{error:"FORBIDDEN",message:"Forbidden"}`, reproduced
  via the same `routeError` minter), the legacy 404 `{error:"Not found"}`,
  the free-text 400 enum messages, `PARENT_NOT_FOUND`/`NOT_FOUND`/
  `WRONG_SPECIES` 422 literals, and the reused `CROSS_SPECIES_BLOCKED` 422 —
  pinned by `__tests__/api/animals-id-wire-preservation.test.ts` and the
  pre-existing `__tests__/api/animals-parent-cross-species.test.ts` (still
  green through the new adapter). `audit-species-where`: 0 new offenders,
  baseline UNCHANGED (the `[id]` calls are unique-key `findUnique`/`update`,
  exempt by construction). `animals/[id]` was never in the
  `route-handler-coverage` EXEMPT set → the "remove from EXEMPT" step was a
  confirmed no-op.
- **309c — profitability-by-animal** — ✅ DONE.
  `lib/server/profitability-by-animal.ts` moved **verbatim** into
  `lib/domain/transactions/profitability-by-animal.ts` (same Prisma
  `transaction.findMany`/`animal.findMany` + selects, same tagged-vs-camp
  partition, same `calcProfitabilityByAnimal` forward, same
  `AnimalProfitabilityRow` return; "cross-species by design" comment kept);
  re-exported from `lib/domain/transactions/index.ts`; old `lib/server/`
  file deleted. Sole caller `app/api/[farmSlug]/profitability-by-animal/
  route.ts` re-pointed to `@/lib/domain/transactions` (all bespoke route
  logic — ADVANCED_TIERS gate, getFarmCreds 404, 403/400/500 envelopes,
  force-dynamic — kept byte-identical; stale "many consumers" comment
  corrected). grep re-confirmed the route is the only importer
  (`multi-farm-overview.ts:55` is a comment). `audit-species-where`: the
  single `animal::findMany::0` baseline entry relocated
  `lib/server/profitability-by-animal.ts` →
  `lib/domain/transactions/profitability-by-animal.ts` (surgical 1-add/
  1-remove, alphabetical order preserved); local audit "no new offenders",
  exit 0. New `lib/domain/transactions/__tests__/profitability-by-animal.test.ts`
  (mocked Prisma) pins the partition/lowercase/tagNumber/dateRange contract
  the shallow `lib/server/` module never had. **This closes the #309
  program** (309a + 309b + 309c all shipped).

## Future optional cleanup (NOT actioned by 309b — explicitly out of scope)

`CrossSpeciesBlockedError` lives in `lib/domain/mobs/move-mob.ts` and is
consumed cross-domain (mobs, rotation, the animals `[id]` route +
`mapApiDomainError`). Centralising it (e.g. to a shared
`lib/domain/species/` or `lib/domain/errors/`) is a cross-cutting refactor
with regression surface across mobs/rotation/observations and was
deliberately deferred — 309b reuses it by importing from
`@/lib/domain/mobs/move-mob` exactly as the pre-extraction route did. Log
as a low-priority follow-up; it should be its own scoped wave, not folded
into a behaviour-preserving extraction.
