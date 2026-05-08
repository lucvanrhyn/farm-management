# Wave G2 — rotation slug-aware extraction (ADR-0001 7/8 part 2)

## Mission

Migrate the 5 routes under `app/api/[farmSlug]/rotation/**` onto the slug-aware
adapters (`tenantReadSlug`, `tenantWriteSlug`, `adminWriteSlug`) introduced by
Wave G1 (#165). Extract route business logic into `lib/domain/rotation/*` with
typed errors, and reduce `lib/server/rotation-engine.ts` (the existing
read-side engine) to a re-export shim so its 4 outside consumers keep working
unchanged.

This is Wave G2 of ADR-0001 ([docs/adr/0001-route-handler-architecture.md](../docs/adr/0001-route-handler-architecture.md)).
The pattern was proven by Waves A–F (subdomain) and G1 (slug, NVD).

## Branch

`wave/166-rotation-slug` (24 chars, under the 36-char Turso budget).

## Strict file allow-list — DO NOT touch anything outside this list

**Routes (migrate to slug adapters):**
- `app/api/[farmSlug]/rotation/route.ts`
- `app/api/[farmSlug]/rotation/plans/route.ts`
- `app/api/[farmSlug]/rotation/plans/[planId]/route.ts`
- `app/api/[farmSlug]/rotation/plans/[planId]/steps/route.ts`
- `app/api/[farmSlug]/rotation/plans/[planId]/steps/[stepId]/execute/route.ts`

**New domain modules:**
- `lib/domain/rotation/get-status.ts` (read; wraps existing rotation-engine logic)
- `lib/domain/rotation/list-plans.ts`
- `lib/domain/rotation/get-plan.ts`
- `lib/domain/rotation/create-plan.ts`
- `lib/domain/rotation/update-plan.ts`
- `lib/domain/rotation/delete-plan.ts`
- `lib/domain/rotation/add-step.ts`
- `lib/domain/rotation/reorder-steps.ts`
- `lib/domain/rotation/execute-step.ts`
- `lib/domain/rotation/errors.ts`
- `lib/domain/rotation/index.ts` (barrel)
- `lib/domain/rotation/__tests__/*.test.ts` (one per op file)

**Existing module — reduce to re-export shim:**
- `lib/server/rotation-engine.ts` — keep in place, re-export from
  `lib/domain/rotation/get-status.ts` so existing consumers don't break:
  - `lib/server/dashboard-alerts.ts` (line 7)
  - `lib/server/cached.ts` (line 33)
  - `app/[farmSlug]/tools/rotation-planner/page.tsx` (line 9)
  - `app/[farmSlug]/admin/camps/[campId]/page.tsx` (line 10)
  These four outside consumers MUST NOT be edited; the shim covers them.

**Wire-up & glue:**
- `lib/server/api-errors.ts` — extend `mapApiDomainError` with the rotation
  error mappings (per **HTTP wire shapes** below).

**Coverage tests:**
- `__tests__/api/route-handler-coverage.test.ts` — remove the 5 rotation
  exempts at lines 86–90 (the routes will be using approved adapter names
  after migration).

**Existing tests that may need updates because of mock-shape changes:**
- `__tests__/admin/species-filter-pages.test.tsx` (line 63) — `vi.mock("@/lib/server/rotation-engine", …)` factory; if the shim still exports `getRotationStatusByCamp` with the same signature, no change needed. If the test fails due to a missing export, dual-mock with `importActual` (see Wave G1 NVD test pattern).
- `__tests__/perf/multi-farm-cache.test.ts` (line 126) — same mock as above.
- `__tests__/perf/db-call-savings.test.ts` (line 99) — same mock as above.
- `__tests__/auth/admin-write-routes-check-role.test.ts` lines 59-60, 101 — these list the rotation routes for ADMIN-role assertion. Adapter migration must keep the assertion passing; verify the asserted role-gate still fires.

Anything else is out of scope. If you discover scope creep is needed, STOP and
report — do not silently expand.

## Routes table — wire-shape preservation contract

All routes use `getFarmContextForSlug(farmSlug, req)` today. After migration
they MUST keep emitting the same envelopes for the same conditions.

| Route | Method | Adapter | Status quo behaviour |
|---|---|---|---|
| `/api/[farmSlug]/rotation` | GET | `tenantReadSlug` | 401 `{error:"Unauthorized"}` → adapter emits `AUTH_REQUIRED`. 200 `RotationPayload`. |
| `/api/[farmSlug]/rotation/plans` | GET | `tenantReadSlug` | 401 → `AUTH_REQUIRED`. 200 `RotationPlan[]`. |
| `/api/[farmSlug]/rotation/plans` | POST | `adminWriteSlug` | 401 → `AUTH_REQUIRED`, 403 → `FORBIDDEN`, 400 `{error:"name is required"}` etc., 201 `RotationPlan`. |
| `/api/[farmSlug]/rotation/plans/[planId]` | GET | `tenantReadSlug` | 401, 404 `{error:"Plan not found"}` → `PLAN_NOT_FOUND`, 200 `RotationPlan`. |
| `/api/[farmSlug]/rotation/plans/[planId]` | PATCH | `adminWriteSlug` | 401, 403, 404 `PLAN_NOT_FOUND`, 400 `INVALID_STATUS`/`BLANK_NAME`/`INVALID_DATE`, 200 plan. |
| `/api/[farmSlug]/rotation/plans/[planId]` | DELETE | `adminWriteSlug` | 401, 403, 404 `PLAN_NOT_FOUND`, 200 `{success:true}`. |
| `/api/[farmSlug]/rotation/plans/[planId]/steps` | POST | `adminWriteSlug` | 401, 403, 404 `PLAN_NOT_FOUND`, 400 `MISSING_FIELD`/`INVALID_PLANNED_START`/`INVALID_PLANNED_DAYS`, 201 step. |
| `/api/[farmSlug]/rotation/plans/[planId]/steps` | PUT | `adminWriteSlug` | 401, 403, 404 `PLAN_NOT_FOUND`, 400 `INVALID_ORDER`, 200 steps[]. |
| `/api/[farmSlug]/rotation/plans/[planId]/steps/[stepId]/execute` | POST | `adminWriteSlug` | 401, 403, 404 `STEP_NOT_FOUND`, 409 `STEP_ALREADY_EXECUTED`, 400 `MISSING_MOB_ID`, 404 `MOB_NOT_FOUND` (re-thrown from `performMobMove`), 409 `MOB_ALREADY_IN_CAMP`, 200 `{step, move:{…}}`. |

**CRITICAL — wire-shape preservation table for the bare-string error bodies:**

The existing routes return `{error: "<sentence>"}` for many failures. The new
adapter-emitted envelope is `{error: CODE, message: "<sentence>"}`. This is a
breaking change unless we preserve the legacy bare-string shape for callers
that key on `error`. Two options:

**Option A (preferred — match the Wave G1 NVD pattern):** Use SCREAMING_SNAKE
codes, and accept the `error`-string change. Audit `app/[farmSlug]/tools/rotation-planner/**` client code first; if the client only displays the human message OR if it keys on the new code, ship Option A.

**Option B (if Option A is too risky):** Keep the legacy sentence as the `error`
field via the `MobHasAnimalsError`-style pattern in `mapApiDomainError`. Tag
each error class with `code` and `message`; the mapper uses `err.message` for
the body's `error` field on those specific classes.

Pick Option A unless you find a client component that explicitly depends on
the sentence form. Verify by grep: `rg -n "error: \"Plan not found\"|\"plannedStart is invalid\"|\"name is required\"" app/ components/`. If grep returns 0 hits in client code, Option A is safe.

## Typed errors (new in `lib/domain/rotation/errors.ts`)

| Class | code | HTTP |
|---|---|---|
| `PlanNotFoundError` | `PLAN_NOT_FOUND` | 404 |
| `StepNotFoundError` | `STEP_NOT_FOUND` | 404 |
| `StepAlreadyExecutedError` | `STEP_ALREADY_EXECUTED` | 409 (carry `currentStatus`) |
| `InvalidStatusError` | `INVALID_STATUS` | 400 (carry `field: "status"`, `allowed: [...]`) |
| `BlankNameError` | `BLANK_NAME` | 400 |
| `InvalidDateError` | `INVALID_DATE` | 400 (carry `field`) |
| `MissingFieldError` | `MISSING_FIELD` | 400 (carry `field`) |
| `InvalidPlannedDaysError` | `INVALID_PLANNED_DAYS` | 400 |
| `InvalidOrderError` | `INVALID_ORDER` | 400 (carry `expected`, `actual`) |
| `MissingMobIdError` | `MISSING_MOB_ID` | 400 |
| `MobAlreadyInCampError` | `MOB_ALREADY_IN_CAMP` | 409 |

Re-throw `MobNotFoundError` from `lib/domain/mobs/move-mob` unchanged — the
existing mapper already handles it (404 `Mob not found`). The execute-step
op should catch the legacy `Error` with `"already in camp"` substring and
re-throw as `MobAlreadyInCampError`.

## Adapter wiring patterns

**Read (rotation status, list-plans, get-plan):**
```ts
export const GET = tenantReadSlug({
  handle: async (ctx, _req, params) => {
    const result = await getPlan(ctx.prisma, params.planId);
    return NextResponse.json(result);
  },
});
```

**Write (admin-only — POST plan, PATCH plan, DELETE plan, POST/PUT step, execute):**
```ts
export const POST = adminWriteSlug<CreatePlanBody, { farmSlug: string }>({
  schema: createPlanSchema,
  revalidate: revalidateRotationWrite,
  handle: async (ctx, body, _req, _params) => {
    const result = await createPlan(ctx.prisma, body);
    return NextResponse.json(result, { status: 201 });
  },
});
```

The `verifyFreshAdminRole` defence-in-depth must remain inside `adminWriteSlug`
(it's a property of the adapter; do not re-implement in handlers).

## TDD discipline (per module)

For each new domain module:

1. **Red:** write failing unit test in `__tests__/<module>.test.ts` covering
   happy path + each typed error.
2. **Green:** implement the minimum to pass.
3. **Refactor:** clean up, ensure types are exported, doc comment at top.

For each route:

1. Migrate route file to call adapter + new domain function.
2. Run `npx tsc --noEmit` from worktree root — must be clean.
3. Run `pnpm vitest run __tests__/api/rotation-*` (if tests exist) and
   `pnpm vitest run __tests__/lib/domain/rotation` — must be green.
4. Run `pnpm vitest run` for the full suite — no regressions.

## 8-gate demo-ready checklist (before requesting PR review)

- [ ] `pnpm build --webpack` green from worktree root (NEVER use Turbopack).
- [ ] `npx tsc --noEmit` green.
- [ ] `pnpm vitest run` all 2766+ existing tests still pass + new rotation tests pass.
- [ ] `pnpm lint` clean.
- [ ] No edits outside the file allow-list (`git diff --name-only origin/main..HEAD` should match the list above).
- [ ] `lib/server/rotation-engine.ts` is now a re-export shim; the 4 outside consumers still resolve.
- [ ] `__tests__/api/route-handler-coverage.test.ts` no longer exempts rotation routes.
- [ ] `mapApiDomainError` extended with all 9-11 new rotation error mappings (per the table above).

## Hand-off

When complete, push the branch and report:
- branch SHA
- commit count + +/-
- Vitest pass count
- The `git diff --name-only origin/main..HEAD` listing
- Confirmation that the 4 outside consumers of `rotation-engine.ts` still resolve

Open the PR with title:
`feat(rotation): extract domain ops + migrate routes onto slug adapters (Wave G2, ADR-0001 7/8 part 2)`

Reference: PR #165 (Wave G1, NVD/slug-adapter precedent), tasks/wave-165-nvd.md.
