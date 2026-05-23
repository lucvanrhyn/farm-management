# Wave 316b — Extract `GET /api/animals` + finish `POST /api/animals`

ADR-0001 follow-up (optional cleanup #2b from the #306 architecture
session). Behaviour-preserving — every wire shape/status byte-identical.
This is the largest of the three follow-up waves: it moves prisma
call-sites that are grandfathered in **all three** audit baselines.

## Current state (`app/api/animals/route.ts`, ~197 lines on origin/main)

- **GET** — fat handler: builds `baseWhere` from query params, then either
  (a) unbounded `prisma.animal.findMany({ where, orderBy })` when no
  pagination, or (b) cursor mode: validates `limit` (400 `{ error:
  "Invalid limit" }`), `prisma.animal.findMany({ where:{...cursor}, orderBy,
  take: limit+1 })`, computes `hasMore`/`nextCursor`, returns `{ items,
  nextCursor, hasMore }`. Two `prisma.animal.findMany` call-sites.
- **POST** — already delegates persistence to `createAnimal` (#207). The
  ONLY inline logic left is the role gate
  `if (role !== "ADMIN" && role !== "LOGGER") return routeError("FORBIDDEN",
  "Forbidden", 403)` and the body-field unpack. The route comment at the
  POST docstring explicitly says this gate should move into the domain op
  when the wave-B extraction lands — that is now.

## Solution

### GET → `lib/domain/animals/list-animals.ts`

NEW `listAnimals(prisma, query)`:
- `query` = the already-parsed filter inputs from the route adapter:
  `{ camp?, category?, status, species?, search?, unassigned?, limit?,
  cursor? }` plus a `paginated: boolean` discriminator (route computes
  `paginated = limitParam !== null || cursorParam !== null`, exactly as
  today).
- The op owns: `baseWhere` construction (lifted verbatim, incl. the
  `cross-species by design` comments), the two `prisma.animal.findMany`
  calls, the `hasMore`/`nextCursor` computation.
- Return a **discriminated union**, JSON-serialisable:
  `{ mode: "all", animals }` | `{ mode: "page", items, nextCursor, hasMore }`.
  The route maps that back to the **exact legacy wire shapes**:
  `mode:"all"` → `NextResponse.json(animals)` (bare array — UNCHANGED);
  `mode:"page"` → `NextResponse.json({ items, nextCursor, hasMore })`.
  The wire is byte-identical; the discriminator never reaches the client.
- **`limit` validation stays in the route adapter** (boundary parsing —
  same rationale 316a kept `createCampSchema` in the route): the route
  parses `limitParam`, and on `!Number.isFinite || <=0` returns the legacy
  `NextResponse.json({ error: "Invalid limit" }, { status: 400 })`
  **verbatim** BEFORE calling the op. The op receives an already-clamped
  numeric `limit`. Do NOT move the "Invalid limit" literal into a domain
  error — legacy sync-manager clients pattern-match it and the comment
  explicitly defers that to a future typed-envelope wave.
- Keep the `timeAsync("query", ...)` wrapper around the findMany calls
  (perf telemetry contract) — move it INTO the op.

### POST role gate → into `createAnimal`

- Add an OPTIONAL `role?: string` to `CreateAnimalInput`. When `role` is
  provided AND not `"ADMIN"`/`"LOGGER"`, `createAnimal` throws a new
  `AnimalRoleForbiddenError`. When `role` is omitted (server-side seed
  scripts / the documented future calving auto-create flow — currently the
  ONLY non-route caller surface), the gate is skipped → back-compat
  preserved. The route always passes `role: ctx.role`.
- `AnimalRoleForbiddenError` must map to the **byte-identical** 403 the
  route emits today: `routeError("FORBIDDEN", "Forbidden", 403)`. Read the
  309b `AnimalFieldForbiddenError` arm in `lib/server/api-errors.ts` and
  the `routeError` envelope, and mint the new error's response through the
  exact same `routeError("FORBIDDEN","Forbidden",403)` call. Do NOT reuse
  `AnimalFieldForbiddenError` (semantically a field gate, not a role gate)
  — add a distinct class that produces the identical wire.
- The route POST then becomes a thin `tenantWrite` adapter: unpack body,
  `await createAnimal(ctx.prisma, { ...body, role: ctx.role })`, return the
  existing `{ success: true, animal }` 201 or map
  `CreateAnimalValidationError` → 400 (UNCHANGED) via the adapter's normal
  path.

## Audit baseline relocation — MANDATORY, THREE baselines

The GET extraction moves the two `prisma.animal.findMany` call-sites out of
`app/api/animals/route.ts` into `lib/domain/animals/list-animals.ts`. On
origin/main (post-316a) these grandfathered entries exist:

- `.audit-species-where-baseline.json`:
  `app/api/animals/route.ts::animal::findMany::0`,
  `app/api/animals/route.ts::animal::findMany::1`
- `.audit-findmany-baseline.json` (the §promote-required `audit-pagination`
  check — DO NOT miss this one):
  `app/api/animals/route.ts::animal::0`
- `.audit-findmany-no-select-baseline.json`:
  `app/api/animals/route.ts::animal::0`,
  `app/api/animals/route.ts::animal::1`

For EACH of the three baseline files: surgically remove the
`app/api/animals/route.ts::animal::*` entries and add the corresponding
`lib/domain/animals/list-animals.ts::animal::*` keys. **Derive every new
key by running the matching audit script AFTER the code move and reading
the exact offender keys it prints** (`scripts/audit-species-where.ts`,
`scripts/audit-findmany-no-take.ts`, `scripts/audit-findmany-no-select.ts`).
NEVER guess the occurrence index — the order of the two findMany in the new
file determines occIdx; confirm from the script output, not by eye. NEVER
use `--write-baseline`. Preserve each file's alphabetical/array ordering
and JSON formatting; the `git diff` for each baseline must be ONLY the
route→domain key swap. Re-run all three scripts to 0-new-offenders with the
edited baselines before committing.

The POST role-gate move touches NO prisma call-site → it does not affect
any baseline.

## File allow-list (touch NOTHING else)

- NEW `lib/domain/animals/list-animals.ts`
- NEW `lib/domain/animals/__tests__/list-animals.test.ts`
- `lib/domain/animals/create-animal.ts` (add optional `role` + throw)
- `lib/domain/animals/errors.ts` (add `AnimalRoleForbiddenError` + code)
- `lib/domain/animals/index.ts` (export new op/types/error)
- `lib/server/api-errors.ts` (add the role-forbidden arm)
- `app/api/animals/route.ts` (GET + POST → thin adapters)
- `.audit-species-where-baseline.json` (surgical 2-entry swap)
- `.audit-findmany-baseline.json` (surgical 1-entry swap)
- `.audit-findmany-no-select-baseline.json` (surgical 2-entry swap)
- `lib/domain/animals/__tests__/create-animal.test.ts` (only if an existing
  case needs a `role` added to keep it green — additive, no behaviour change)
- NEW `tasks/wave-316b-animals-list-domain.md` (this file)

## TDD

`list-animals.test.ts` RED-first: unbounded mode returns
`{ mode:"all", animals }`; filters (camp/category/status/species/search/
unassigned) build the expected `where`; cursor mode returns
`{ mode:"page", items, nextCursor, hasMore }` with correct slicing and
`take = limit+1`; `hasMore=false`/`nextCursor=null` at the tail. Add a
`createAnimal` test: `role:"VIEWER"` throws `AnimalRoleForbiddenError`;
`role:"ADMIN"`/`"LOGGER"` and `role` omitted all succeed (back-compat).
Use a minimal prisma double.

## Acceptance

1. `rm -rf .next/cache/tsbuildinfo .tsbuildinfo && npx tsc --noEmit` clean.
2. `pnpm vitest run` fully green (new tests + existing animals/api-errors
   suites, esp. any `__tests__/api/animals*`).
3. All `scripts/audit-*.ts` → **0 new offenders**; `git diff` on the THREE
   baseline files shows ONLY the route→`list-animals.ts` key swaps; no
   other baseline changes.
4. `pnpm build --webpack` green.
5. `git diff origin/main -- app/api/animals/route.ts`: GET maps the op's
   discriminated result back to the byte-identical legacy wire (bare array
   vs `{items,nextCursor,hasMore}`); the `{ error:"Invalid limit" }` 400
   still emitted from the route; POST is a thin adapter; no status/body
   change anywhere.

## Out of scope

- Migrating the `{ error: "Invalid limit" }` 400 to a typed envelope.
- Changing the bare-array vs paginated wire shapes.
- Centralising `CrossSpeciesBlockedError` (shipped in #315) or camps
  (shipped 316a).
- `--write-baseline` on any baseline.
