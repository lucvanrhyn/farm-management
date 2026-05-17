# Wave 309a — camps domain extraction

Part of #309 (ADR-0001 Wave B completion). **No ADR** — ADR-0001 governs.
Behaviour-preserving refactor; zero migration. Mirror `lib/domain/mobs/`.

## Goal

`lib/domain/camps/` does not exist. Extract the inline PATCH/DELETE business
logic from `app/api/camps/[campId]/route.ts` into pure domain ops; the route
shrinks to adapter wiring (keeps its `adminWrite` envelope + `patchCampSchema`
+ `revalidateCampWrite`). Validation stays in the route-level schema-parse path
(same split Wave C used: validation → adapter parse; business rules → typed
domain errors).

## Ops (mirror mobs)

| Op | File | Calls |
|---|---|---|
| `updateCamp(prisma, { campId, patch }) → { success: true }` | `lib/domain/camps/update-camp.ts` | `prisma.camp.findFirst({where:{campId}})` then `prisma.camp.update({where:{id:camp.id}, data:<spread of provided fields>})` |
| `deleteCamp(prisma, campId) → { success: true }` | `lib/domain/camps/delete-camp.ts` | `findFirst` → `prisma.animal.count({where:{currentCamp:campId,status:"Active"}})` → `prisma.camp.delete({where:{id:camp.id}})` |

- `lib/domain/camps/errors.ts`, `lib/domain/camps/index.ts`, `lib/domain/camps/__tests__/`.
- Preserve the existing `#28 Phase A` semantics exactly: `findFirst({where:{campId}})`
  then mutate via the resolved CUID `id` (campId is no longer globally unique).
  Keep the explanatory comments — they encode a live multi-species constraint.
- The optional-field update construction (the `...(body.x !== undefined && {x})`
  spread) moves verbatim into `updateCamp`; the op accepts the already-parsed
  `PatchCampBody` (validation has already happened in the adapter).

## Error mapping (pinned decisions — do not re-litigate)

`mapApiDomainError` (`lib/server/api-errors.ts`) **already** has a
`CampNotFoundError` → `{ error: "CAMP_NOT_FOUND" }` status 404 (owned by the
observations domain; the wire code is generic and reusable).

1. **Not-found:** FIRST check whether any existing test or client depends on the
   current literal body `{ error: "Camp not found" }` (search route tests +
   `__tests__`, and the camps DELETE/PATCH client callers). 
   - If something depends on the literal string → introduce a camps-scoped
     message-bearing error so the wire stays byte-identical.
   - If nothing depends on it (expected) → reuse the existing `CampNotFoundError`
     (canonical `CAMP_NOT_FOUND` 404, already wired). This matches the
     codebase's stated ADR-0001/Wave-C direction (free-text bodies retired in
     favour of canonical codes). Document which path you took in the PR.
2. **Active-animal 409:** add `CampHasActiveAnimalsError(count)` in
   `lib/domain/camps/errors.ts`, mirroring `MobHasAnimalsError` exactly — its
   `.message` MUST be the byte-identical current string:
   `Cannot delete camp with ${count} active animal(s). Move or remove them first.`
   Extend `mapApiDomainError` with `if (err instanceof CampHasActiveAnimalsError)
   return NextResponse.json({ error: err.message }, { status: 409 })` — message
   preserved on the wire (legacy clients display it). This is **wire-preserving**.

## Route rewrite

`app/api/camps/[campId]/route.ts` PATCH/DELETE `handle` callbacks call the ops
inside `try/catch`, mapping domain errors via `mapApiDomainError` (return its
NextResponse if non-null; otherwise rethrow). Keep `adminWrite`, the schema,
`revalidateCampWrite`, and the success bodies (`{ success: true }`) exactly.
Net wire change: none (modulo the not-found code per decision 1).

## In-scope edits beyond the new domain dir

- `lib/server/api-errors.ts` — add the `CampHasActiveAnimalsError` arm (and, if
  decision 1 takes the new-error path, that arm too). Same pattern as mobs.
- `__tests__/api/route-handler-coverage.test.ts` — if `camps/[campId]` is in an
  EXEMPT set, remove it (mirror Wave C). If not present, no-op.
- `tasks/issue-309-adr-0001-waveB-triage.md`, `tasks/wave-309a-camps-domain.md`
  — already created.

## TDD sequence

1. RED: write `lib/domain/camps/__tests__/update-camp.test.ts` +
   `delete-camp.test.ts` with a mocked Prisma double — assert: update spreads
   only provided fields & mutates by resolved `id`; not-found throws the chosen
   error; delete blocks with `CampHasActiveAnimalsError(n)` when active animals
   exist and the message is byte-identical; happy-path deletes by `id`. Run —
   fails (ops don't exist).
2. GREEN: implement the ops minimally to pass.
3. REFACTOR: rewire the route onto the ops; extend `mapApiDomainError`; remove
   route-coverage EXEMPT entry if present. Add a route-level test asserting the
   wire shape is unchanged (404 + 409 bodies/status, `{success:true}` on happy
   path) — this is the behaviour-preservation guard.
4. VERIFY: `rm -rf .next/cache/tsbuildinfo .tsbuildinfo && npx tsc --noEmit`;
   `pnpm vitest run lib/domain/camps __tests__/api` (+ any camps route test);
   full `pnpm vitest run` (0 failures; investigate any as pre-existing vs
   caused); `pnpm build --webpack` (NEVER turbo).

## Out of scope (do NOT touch)

- `app/api/camps/route.ts` (the collection GET/POST/reset) — only `[campId]`.
- Any other domain dir, `prisma/schema.prisma`, `migrations/**`.
- `proxy.ts`, auth/payfast/webhooks — none involved.
- The observations-domain `CampNotFoundError` definition — reuse only, do not
  move or rename it.

## Promote path

§promote-delegation routine documented-issue wave (#309/309a), `wave/*` branch,
no auth/payment/migration/architectural surface, behaviour-preserving, not
incident/hotfix. Ship through merge when the required CI checks are green.
