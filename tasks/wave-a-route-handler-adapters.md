# Wave A — Route handler adapters (build + camps/animals proof migration)

Implements [ADR-0001](../docs/adr/0001-route-handler-architecture.md). First of two architectural waves: this one builds the transport layer (four named adapters + typed-error envelope + CI invariant) and migrates the camps and animals route trees as the proof that the seam holds. Wave B+ extracts domain operations area by area.

**Branch:** `wave/148-route-handler-adapters`
**Worktree:** `.worktrees/route-handler-adapters/`
**Issue title:** Wave A — Route handler adapters: transport layer + camps/animals migration

## Goal

Lock the contract for "what an API route is" so the next P0.1-class incident (stale Prisma client throw → empty 500 → cascading admin-page outage) is structurally impossible across all routes, not patched per-route after the fact.

After this wave:

- Every migrated route file is ≤ 30 lines.
- A single CI test (`route-handler-coverage`) walks every `route.ts` and refuses any non-exempt file whose `export const GET|POST|PATCH|DELETE` does not come from `tenantRead | adminWrite | tenantWrite | publicHandler`.
- The typed-error envelope `{ error: CODE, message?, details? }` is the only response shape any handler can produce on a thrown error path.
- `dbQueryFailed` (the per-route P0.1 hotfix in `app/api/animals/route.ts`) is deleted — its job lives in the adapter.

## Out of scope

- Migrating routes outside the camps + animals trees. Their migration is Wave B+.
- Extracting domain operations into `lib/domain/`. The migrated routes keep their `handle:` bodies as-is — Wave B+ shrinks them.
- Touching `proxy.ts`, `getFarmContext`, `getFarmContextForSlug`, `verifyFreshAdminRole`, `mapApiDomainError`, or any of the existing auth/tenant resolvers. The adapters compose these — they do not replace them.
- Migrating the 14 routes in the existing `EXEMPT` set of `session-consolidation-coverage.test.ts`. They will be wrapped with `publicHandler` in a follow-up wave once the adapter contract has soaked.

## File allow-list

The TDD agent may only edit:

```
lib/server/route/index.ts                    (new)
lib/server/route/types.ts                    (new)
lib/server/route/envelope.ts                 (new)
lib/server/route/tenant-read.ts              (new)
lib/server/route/admin-write.ts              (new)
lib/server/route/tenant-write.ts             (new)
lib/server/route/public-handler.ts           (new)
lib/server/route/__tests__/envelope.test.ts          (new)
lib/server/route/__tests__/tenant-read.test.ts       (new)
lib/server/route/__tests__/admin-write.test.ts       (new)
lib/server/route/__tests__/tenant-write.test.ts      (new)
lib/server/route/__tests__/public-handler.test.ts    (new)
__tests__/api/route-handler-coverage.test.ts (new)

app/api/camps/route.ts                       (migrate)
app/api/camps/[campId]/route.ts              (migrate)
app/api/camps/reset/route.ts                 (migrate)
app/api/camps/status/route.ts                (migrate)

app/api/animals/route.ts                     (migrate, delete dbQueryFailed)
app/api/animals/[id]/route.ts                (migrate)
app/api/animals/reset/route.ts               (migrate)
app/api/animals/import/route.ts              (migrate)

docs/adr/0001-route-handler-architecture.md  (status: proposed → accepted on merge)
```

Anything outside this list is scope creep — defer to a follow-up wave.

## Adapter contracts (interfaces only — implementation is the agent's job)

```ts
// lib/server/route/types.ts
export type RouteErrorCode = string;  // SCREAMING_SNAKE
export interface RouteErrorBody {
  error: RouteErrorCode;
  message?: string;
  details?: Record<string, unknown>;
}

export type RouteHandler = (req: NextRequest, ctx: RouteParams) => Promise<NextResponse>;

// lib/server/route/tenant-read.ts
export function tenantRead(opts: {
  handle: (ctx: FarmContext, req: NextRequest, params: RouteParams) => Promise<NextResponse>;
}): RouteHandler;

// lib/server/route/admin-write.ts
export function adminWrite<TBody>(opts: {
  schema?: ZodType<TBody>;                    // optional — if absent, body is `unknown`
  revalidate?: RevalidateTag | RevalidateTag[]; // typed against revalidate.ts
  handle: (ctx: FarmContext, body: TBody, req: NextRequest, params: RouteParams) => Promise<NextResponse>;
}): RouteHandler;

// lib/server/route/tenant-write.ts — same shape as adminWrite, no role gate
// lib/server/route/public-handler.ts — handle only; envelope on throw
```

### Invariants every adapter enforces

1. **Resolution.** `tenantRead | adminWrite | tenantWrite` call `getFarmContext(req)` exactly once. `null` → `{ error: "AUTH_REQUIRED", message: "Unauthorized" }`, status 401.
2. **Role.** `adminWrite` rejects non-ADMIN with `{ error: "FORBIDDEN", message: "Forbidden" }`, status 403. Then `verifyFreshAdminRole(session.user.id, slug)` — same envelope on stale-ADMIN.
3. **Body parse.** When `schema` is provided, parse `await req.json()`. Validation failure → `{ error: "VALIDATION_FAILED", message, details }`, status 400. Missing body / non-JSON → `{ error: "INVALID_BODY", message }`, status 400.
4. **Try/catch.** Any throw inside `handle` is caught. First, `mapApiDomainError(err)` — if it returns a response, use it. Otherwise log via `logger.error` and return `{ error: "DB_QUERY_FAILED", message: <err.message> }`, status 500.
5. **Revalidate.** On `2xx` from `handle`, call the appropriate `revalidate*Write()` helper (typed against `lib/server/revalidate.ts`).
6. **Server-timing.** Every adapter wraps the inner work in `withServerTiming` and instruments `session` + (where applicable) `query` spans.

## CI invariant — `__tests__/api/route-handler-coverage.test.ts`

Mirrors `session-consolidation-coverage.test.ts`:

1. Walk every `app/api/**/route.ts`.
2. For each non-`EXEMPT` file, parse its `export const (GET|POST|PATCH|DELETE)` declarations and assert each one is a call to `tenantRead | adminWrite | tenantWrite | publicHandler`.
3. **Initial `EXEMPT` set:** every route NOT migrated in this wave + the 14 routes already exempt in `session-consolidation-coverage.test.ts`. Each entry carries the same "WHY exempt" comment style. Exempts must shrink wave by wave; an additional unit test asserts every exempt file still exists (no rot, same as the existing pattern).

The CI invariant lands green in this wave with a long allowlist. Wave B+ entries shrink the allowlist as they migrate areas.

## TDD checklist

- [ ] Read [ADR-0001](../docs/adr/0001-route-handler-architecture.md) and [farm-context.ts](../lib/server/farm-context.ts) end-to-end.
- [ ] Write failing test `lib/server/route/__tests__/envelope.test.ts` for `routeError(code, message?, details?)`.
- [ ] Implement `lib/server/route/envelope.ts`.
- [ ] Write failing test `tenant-read.test.ts` covering: (a) auth-fail → 401, (b) success → handler invoked with ctx, (c) handler throws → 500 envelope, (d) handler throws domain error → mapApiDomainError wins, (e) server-timing header present.
- [ ] Implement `tenant-read.ts`.
- [ ] Repeat for `admin-write.ts` (additional cases: role gate, fresh-admin gate, schema validation pass/fail, revalidate called on 2xx, revalidate NOT called on 4xx/5xx).
- [ ] Repeat for `tenant-write.ts` (same as admin-write minus the role/fresh-admin cases).
- [ ] Repeat for `public-handler.ts` (envelope-on-throw only).
- [ ] Write `route-handler-coverage.test.ts` with the initial EXEMPT set sized to keep CI green pre-migration.
- [ ] Migrate `app/api/camps/route.ts` (GET → tenantRead, POST → adminWrite). Existing tests must stay green.
- [ ] Migrate `app/api/camps/[campId]/route.ts`, `camps/reset/route.ts`, `camps/status/route.ts`. Remove from EXEMPT.
- [ ] Migrate `app/api/animals/route.ts`. Delete `dbQueryFailed`. Remove from EXEMPT.
- [ ] Migrate `app/api/animals/[id]/route.ts`, `animals/reset/route.ts`, `animals/import/route.ts`. Remove from EXEMPT.
- [ ] Flip ADR-0001 status to **accepted** in the same commit as the merged migration.
- [ ] `pnpm lint && pnpm tsc && pnpm vitest run && pnpm build --webpack` green.
- [ ] Playwright smoke green against the wave clone.

## Verification commands

```
pnpm vitest run lib/server/route/__tests__
pnpm vitest run __tests__/api/route-handler-coverage.test.ts
pnpm vitest run __tests__/api/session-consolidation-coverage.test.ts  # regression
pnpm vitest run __tests__/api/animals-search.test.ts                  # regression
pnpm vitest run __tests__/api/observations.test.ts                    # regression
pnpm lint
rm -rf .next/cache/tsbuildinfo .tsbuildinfo && pnpm tsc --noEmit
pnpm build --webpack
```

## 8-gate demo-ready bar (CLAUDE.md)

1. ✅ build green (`pnpm build --webpack`)
2. ✅ Vitest green (full suite + new adapter suites)
3. ✅ Playwright green (smoke against wave clone)
4. ✅ deep-audit green
5. ✅ telemetry typed (server-timing spans labelled per adapter)
6. ✅ beta soak ≥ 24h on the preview deploy (per ADR risk: typed-error envelope wire change)
7. ✅ cold demo dry-run on `/admin/camps`, `/admin/animals`, `/admin/animals/<id>`, `/admin/camps/<campId>` — the same 4 paths the P0.1 cascade hit.
8. ⏳ Luc-typed `promote`

## Notes / risks

- **Wire format change.** The unmigrated `{ error: "Unauthorized" }` shape becomes `{ error: "AUTH_REQUIRED", message: "Unauthorized" }`. The pre-wave client audit (`rg -n "\\.error\\s*===\\s*['\"]" app/ components/ lib/`, run 2026-05-07) found:
  - `components/admin/AlertSettingsForm.tsx:215-221` — branches on SCREAMING_SNAKE codes (`ADMIN_REQUIRED_FOR_FARM_SETTINGS`, `INVALID_QUIET_HOURS`, `INVALID_TIMEZONE`, `INVALID_PREF_FIELD`). **Compatible** with strict envelope.
  - `app/(auth)/verify-email/page.tsx:203` — defensive `typeof data.error === "string"`. **Compatible** — `error` is always a string code.
  - `components/onboarding/CommitProgress.tsx:109` — reads `body.error` as displayed text. Routes consumed: onboarding (not in Wave A scope). Whichever future wave migrates onboarding routes must flip this UI to read `body.message`.
  - `app/api/admin/consulting/[id]/route.ts:63,66` — internal helper consumption (route consuming a lib result), not a wire-format consumer.
  - **No UI consumer branches on free-form `error` strings from camps or animals routes.** Wave A is safe with the strict envelope; `message` is always present on canonical errors so future display-reader migrations can flip cleanly.
- **Cascade replay.** The 8-gate cold demo dry-run replays the exact 4 admin pages that broke during the P0.1 cascade. If any of them returns a non-typed envelope, the wave is not green — investigate before re-requesting `promote`.
- **`feedback-vi-hoisted-shared-mocks.md`** — adapter unit tests share mocked NextRequest factories. Wrap them in `vi.hoisted()` to avoid TDZ on top-level consts.
- **`feedback-no-hand-rolled-migrate-scripts.md`** — no schema changes in this wave. If any are tempting, defer to a separate wave.
- **`feedback-soak-applies-to-all-promotes.md`** — the 1-hour gate fires on the post-merge promote regardless of migration status. Plan to leave the PR un-promoted for ≥ 1h after merge anyway, since the wire-format change is the de facto migration here.

## Wave B+ ordering (informational, not part of this wave)

In rough dependency order — pick by leverage, not alphabet:

| Wave | Area | Why this slot |
|---|---|---|
| B | mobs (`/api/mobs/**`) | Already has `mob-move.ts` domain extraction; smallest surface to validate the domain-layer pattern. |
| C | observations (`/api/observations/**`) | High write volume + tenantWrite path, exercises the non-admin write contract. |
| D | tasks (`/api/tasks/**`, `/api/task-occurrences`, `/api/task-templates`) | Self-contained tree, low coupling. |
| E | transactions (`/api/transactions`, `/api/transaction-categories`) | Finance surface — domain extraction lets the IT3/SARS exporters reuse the operations. |
| F | photos, sheets, einstein/admin | Long tail. |
| G | farm-settings, farms, onboarding | Touches meta DB; sequenced last to avoid coupling with the meta-db split (separate roadmap item). |

After Wave G, the EXEMPT set in `route-handler-coverage` should hold only the original 14 (webhooks, telemetry beacon, auth catch-all, etc.), all wrapped in `publicHandler`.
