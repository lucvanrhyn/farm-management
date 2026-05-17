# Wave 309b — animals domain completion (`app/api/animals/[id]` GET + PATCH)

Part of #309 (ADR-0001 Wave B). **No ADR** — ADR-0001 governs. Behaviour-
preserving refactor; zero migration. Mirror `lib/domain/mobs/` +
`lib/domain/camps/` (shipped 309a) + the existing `lib/domain/animals/
create-animal.ts` style.

## Scope (tight — mirrors 309a doing only `[campId]`)

ONLY `app/api/animals/[id]/route.ts` GET + PATCH. Extract the inline logic
into pure `lib/domain/animals/` ops; route shrinks to adapter wiring (keep its
`tenantRead`/`tenantWrite` envelopes + `revalidateAnimalWrite`).

**Out of scope (do NOT touch):** `app/api/animals/route.ts` (collection
GET/POST — POST already uses `createAnimal`), `app/api/animals/reset/route.ts`,
`app/api/animals/import/route.ts`, `app/api/animals/[id]/photos/route.ts`,
`app/api/mobs/[mobId]/animals/route.ts`. No `prisma/schema.prisma` /
`migrations/**`. No `lib/auth-*`, `app/api/auth/**`, `proxy.ts`, payfast.

## Ops (mirror mobs/camps)

| Op | File | Behaviour |
|---|---|---|
| `getAnimal(prisma, animalId) → animal` | `lib/domain/animals/get-animal.ts` | `prisma.animal.findUnique({where:{animalId}})`; throw `AnimalNotFoundError` if missing |
| `updateAnimal(prisma, { animalId, role, slug, body }) → animal` | `lib/domain/animals/update-animal.ts` | the entire PATCH body of the current route, lifted verbatim (role gate → enum validation → field allowlist → #28 parent guard → #98 camp guard → `prisma.animal.update`) |

- `lib/domain/animals/errors.ts`, and **extend** `lib/domain/animals/index.ts`
  to be the single public surface (re-export existing `createAnimal` +
  `CreateAnimalInput` etc. **and** the new ops/errors — mirror
  `lib/domain/mobs/index.ts`). Do NOT change `create-animal.ts` behaviour.
- `lib/domain/animals/__tests__/` — vitest per op with a mocked Prisma double.

## Cross-species error — reuse, do NOT centralise

`CrossSpeciesBlockedError` lives in `lib/domain/mobs/move-mob.ts` and is
consumed by mobs, rotation, the animals route, and `mapApiDomainError`.
Centralising it is a cross-cutting refactor (scope-creep + regression risk
across mobs/observations) and is **explicitly out of scope for 309b**. Reuse
it by importing from `@/lib/domain/mobs/move-mob` (or the `@/lib/domain/mobs`
index re-export) exactly as the route does today. Centralisation is logged as
a future optional cleanup in `tasks/issue-309-adr-0001-waveB-triage.md` — do
not action it here.

## Wire-shape contract — BYTE-IDENTICAL preservation (default: preserve)

This route carries authorization + validation; the wave is behaviour-
preserving. Every status code AND body string below must be reproduced
exactly via typed domain errors mapped in `lib/server/api-errors.ts`
`mapApiDomainError`. Do NOT adopt canonical SCREAMING_SNAKE codes here unless
an existing test proves canonical is already expected (none known — preserve).

| Surface | Current wire | Domain error → mapping |
|---|---|---|
| GET not found | 404 `{error:"Not found"}` | `AnimalNotFoundError` → `{error:"Not found"}` 404 |
| PATCH role denied (LOGGER disallowed key, or non-ADMIN non-LOGGER) | 403 via `routeError("FORBIDDEN","Forbidden",403)` | `AnimalFieldForbiddenError` → reproduce `routeError("FORBIDDEN","Forbidden",403)` byte-identical (inspect `routeError`'s exact JSON) |
| PATCH bad status | 400 `{error:"status must be one of: Active, Deceased, Sold, Culled"}` | `InvalidAnimalFieldError("status", <msg>)` → `{error:<msg>}` 400 |
| PATCH bad sex | 400 `{error:"sex must be one of: Male, Female, Unknown"}` | same error type, sex message |
| PATCH parent missing | 422 `{error:"PARENT_NOT_FOUND"}` | `ParentNotFoundError` → `{error:"PARENT_NOT_FOUND"}` 422 |
| PATCH cross-species parent | 422 `{error:"CROSS_SPECIES_BLOCKED"}` | reuse `CrossSpeciesBlockedError` (already mapped) — unchanged |
| PATCH camp guard fail | 422 `{error:"NOT_FOUND"}` or `{error:"WRONG_SPECIES"}` | `SpeciesScopedCampError(reason)` where reason ∈ NOT_FOUND\|WRONG_SPECIES → `{error:reason}` 422 |
| GET / PATCH happy | 200 the animal row / updated row | `{ ...animal }` unchanged |

Preserve every existing comment that encodes a live constraint (the `#28
Phase B` / `#98` / `TODO(#28)` blocks, the hoisted single-read rationale,
the legacy-NULL-species lenience). The op must keep: the single hoisted
child-species read; parent-guard loop ordering; camp-guard only when
`child?.species` truthy; the exact `allowed` field list and `LOGGER_ALLOWED`
set; enum sets.

## audit-species-where (309a lesson — verify, don't assume)

The `[id]` animal calls are unique-key (`where:{animalId}`) → expected
audit-exempt; `.audit-species-where-baseline.json` currently has **no**
`app/api/animals/[id]/route.ts` entries. Still: after the move, run
`pnpm tsx scripts/audit-species-where.ts` locally. If it reports ANY new
offender for the new `lib/domain/animals/*` files, relocate/add baseline
entries the same root-cause way 309a did (keys read from the audit module's
own functions, never guessed; preserve alphabetical order; remove any dead
relocated entries). Add `.audit-species-where-baseline.json` to the commit
only if it actually changed.

## In-scope edits beyond the new ops

- `app/api/animals/[id]/route.ts` — shrink GET+PATCH to adapter wiring calling
  the ops; map domain errors via `mapApiDomainError` (return its NextResponse
  if non-null else rethrow). Keep `tenantRead`/`tenantWrite`/`revalidateAnimalWrite`.
- `lib/server/api-errors.ts` — add the new animal-error arms (wire-preserving
  per the table). Same pattern as the camps/mobs arms.
- `lib/domain/animals/index.ts` — expand to full public surface.
- `__tests__/api/route-handler-coverage.test.ts` — remove `animals/[id]`
  EXEMPT entry IF present (mirror Wave C); else no-op.
- `.audit-species-where-baseline.json` — only if the local audit says so.
- `tasks/wave-309b-animals-domain.md` (this), and append the centralisation
  note + 309b status to `tasks/issue-309-adr-0001-waveB-triage.md`.

## TDD sequence

1. RED: `lib/domain/animals/__tests__/{get-animal,update-animal}.test.ts`
   (mocked Prisma) — cover every wire row above incl. the authz matrix
   (LOGGER allowed-only set; LOGGER disallowed key → forbidden; non-ADMIN
   non-LOGGER → forbidden; ADMIN full allowlist), parent-guard ordering,
   NULL-species lenience, camp-guard-only-when-species-known, hoisted single
   read. Fails (ops absent).
2. GREEN: implement ops by lifting the route logic verbatim.
3. REFACTOR: rewire route; extend `mapApiDomainError`; expand `index.ts`; add
   a route-level wire-preservation test
   (`__tests__/api/animals-id-wire-preservation.test.ts`) asserting every
   status+body in the table is byte-identical to pre-extraction (this is the
   behaviour-preservation guard, esp. for the authz path).
4. VERIFY: `rm -rf .next/cache/tsbuildinfo .tsbuildinfo && npx tsc --noEmit`;
   `pnpm tsx scripts/audit-species-where.ts` (0 new offenders);
   `pnpm vitest run lib/domain/animals __tests__/api`; full `pnpm vitest run`
   (0 failures — investigate any as pre-existing vs caused); `pnpm build
   --webpack` (NEVER turbo).

## Promote path

§promote-delegation routine documented-issue wave (#309/309b), `wave/*`
branch, no auth/payment/migration *file* surface, behaviour-preserving (incl.
the authz gate — proven byte-identical by the wire test), not the arch-PR
exception. Ship through merge on green required CI.
