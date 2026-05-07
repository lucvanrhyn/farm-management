# Wave 151 — Mobs domain extraction + adapter migration

Closes #151. Second wave in ADR-0001 rollout (Wave A = PR #149).

## Goal

Migrate the three `app/api/mobs/**` route files onto the Wave A transport
adapters (`tenantRead`, `adminWrite`) and extract their per-route business
logic into pure domain operations under `lib/domain/mobs/`. After this wave,
the three `mobs/*` entries come out of the EXEMPT set in the
`route-handler-coverage` invariant, locking the architectural rule onto
this surface.

## Architecture (mirrors Wave A camps + animals)

Six pure domain ops, one per route handler:

| Op | File | Adapter | Calls into |
|---|---|---|---|
| `listMobs(prisma)` | `lib/domain/mobs/list-mobs.ts` | `tenantRead` | `prisma.mob.findMany` + `prisma.animal.groupBy` |
| `createMob(prisma, input)` | `lib/domain/mobs/create-mob.ts` | `adminWrite` | `requireSpeciesScopedCamp` + `prisma.mob.create` |
| `updateMob(prisma, input)` | `lib/domain/mobs/update-mob.ts` | `adminWrite` | `performMobMove` + `prisma.mob.update` |
| `deleteMob(prisma, mobId)` | `lib/domain/mobs/delete-mob.ts` | `adminWrite` | `prisma.animal.count` + `prisma.mob.delete` |
| `attachAnimalsToMob(prisma, input)` | `lib/domain/mobs/attach-animals.ts` | `adminWrite` | `prisma.animal.updateMany` |
| `detachAnimalsFromMob(prisma, input)` | `lib/domain/mobs/detach-animals.ts` | `adminWrite` | `prisma.animal.updateMany` |

Each op:
- Accepts `(prisma, input)`, returns plain JSON-serialisable data.
- Validates its own input (throws `RouteValidationError` for shape failures).
- Throws typed errors for business-rule failures: `MobNotFoundError`,
  `WrongSpeciesError`, `NotFoundError`, `CrossSpeciesBlockedError`,
  `MobHasAnimalsError`, `EmptyAnimalIdsError`.
- The adapter's typed-error envelope maps these to the wire shape via
  `mapApiDomainError` (extended in this wave with the new error classes).

`lib/server/mob-move.ts` stays where it is — `update-mob.ts` calls
`performMobMove` from there. Re-homing is out of scope per the issue.

## Wire-shape preservation

Wave A's envelope shape is `{ error: CODE, message?, details? }`. Pre-Wave-B
mob routes used a flat `{ error: <code-or-message> }` shape with mixed
semantics (sometimes a SCREAMING_SNAKE code, sometimes a sentence).

Strategy:
- **Typed business errors** (`WRONG_SPECIES`, `NOT_FOUND`, `CROSS_SPECIES_BLOCKED`,
  `MOB_NOT_FOUND`, `MOB_HAS_ANIMALS`) flow through `mapApiDomainError`,
  which mints the bare `{ error: CODE }` JSON — wire-compatible with the
  pre-Wave-B tests that strict-equality-compared `{ error: "WRONG_SPECIES" }`.
- **Validation errors** (missing name/currentCamp/species, invalid species,
  empty animalIds array) flow through the schema-parse path and surface as
  `{ error: "VALIDATION_FAILED", message: "<field reason>", details: { fieldErrors } }`.
  This is a wire-shape change for the validation paths only — the legacy
  flat-error-string format is retired in favour of the canonical envelope.

## In-scope edits beyond the agent allow-list

1. `lib/server/api-errors.ts` — extend `mapApiDomainError` with the four
   new typed errors emitted by domain ops. Per the wave brief: "If a typed
   error needs adding to the mapper, that's a small allowed adjacent edit."
2. `__tests__/api/mobs-post-species.test.ts` and
   `__tests__/api/mobs-cross-species.test.ts` — these existing route-level
   tests assert wire shapes that change for validation paths. They are
   updated to match the new envelope (the typed-error paths stay
   wire-compatible and need no change). This is the natural extension of
   the allow-list rule "update tests for migrated routes to new envelope".

## TDD plan (red → green → refactor)

One failing test per op is written first under
`lib/domain/mobs/__tests__/`. Each test follows the `vi.hoisted` shared-mock
pattern (per `feedback-vi-hoisted-shared-mocks.md`). The op is implemented
to GREEN, then the route is rewired onto the adapter.

After all six ops land, the three `mobs/*` entries are removed from
`__tests__/api/route-handler-coverage.test.ts` EXEMPT — the invariant test
proves the migration is complete.

## Verification (gates)

1. `pnpm build` (catches Next 16 `ParamCheck<RouteContext>` and dynamic.* drift).
2. `pnpm lint`.
3. `pnpm test` (domain ops + route-level tests + invariant).
4. `npx tsc --noEmit` (with `.next/cache/tsbuildinfo` removed).

## Out of scope

- Re-homing `lib/server/mob-move.ts` (stays where it is).
- Migrations or schema changes — zero migration files in this PR.
- Other route surfaces (the remaining EXEMPT entries get migrated in
  Waves C-G per ADR-0001).
