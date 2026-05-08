# Wave G1 — NVD slice + slug-aware adapters (ADR-0001 7/8 part 1 of 5)

**Branch:** `wave/165-nvd-slug-adapter`
**Worktree:** `.worktrees/wave/165-nvd-slug-adapter/`
**Predecessors:** PRs #149 (A), #153 (B), #157 (C), #160 (D), #162 (E), #164 (F)

## Why this wave exists

ADR-0001's Wave G is the `[farmSlug]/**` namespace — 37 routes that resolve their farm context through `getFarmContextForSlug(params.farmSlug, req)` instead of `getFarmContext(req)`. The existing Wave A adapters only support the `getFarmContext` path, so before any `[farmSlug]/**` route can move onto an adapter we need slug-aware variants.

G is split into 5 sub-waves (G1–G5) so each ships at the same scope envelope as D/E/F (~500–800 line diff). **G1 = NVD slice.** It establishes the slug-aware adapter contract and proves it on a coherent, regulated 5-route slice (issue / validate / detail / void / PDF).

## Routes migrated (5)

| Route | Verb(s) | Notes |
|---|---|---|
| `app/api/[farmSlug]/nvd/route.ts` | GET, POST | List + issue. ADMIN gate + `verifyFreshAdminRole` on POST. Rate-limit (10/10min). |
| `app/api/[farmSlug]/nvd/validate/route.ts` | POST | Dry-run withdrawal validation. No side effects. |
| `app/api/[farmSlug]/nvd/[id]/route.ts` | GET | Detail fetch. |
| `app/api/[farmSlug]/nvd/[id]/void/route.ts` | POST | Void issued NVD. ADMIN gate + fresh-admin defence. |
| `app/api/[farmSlug]/nvd/[id]/pdf/route.ts` | GET | **Binary** `application/pdf` response. |

## Adapter additions

Three new variants in `lib/server/route/`:

```ts
export function tenantReadSlug<TParams extends RouteParams & { farmSlug: string }>(opts: TenantReadOpts<TParams>): RouteHandler<TParams>
export function tenantWriteSlug<TBody, TParams extends RouteParams & { farmSlug: string }>(opts: TenantWriteOpts<TBody, TParams>): RouteHandler<TParams>
export function adminWriteSlug<TBody, TParams extends RouteParams & { farmSlug: string }>(opts: AdminWriteOpts<TBody, TParams>): RouteHandler<TParams>
```

Each variant:
1. Awaits `ctx.params` to read `farmSlug`.
2. Calls `getFarmContextForSlug(farmSlug, req)` instead of `getFarmContext(req)`.
3. Re-uses every other concern (auth-required envelope, role gate, fresh-admin defence on `adminWriteSlug`, body parse, schema, mapApiDomainError, revalidate-on-2xx, withServerTiming).

The existing subdomain adapters stay unchanged — non-`[farmSlug]` routes keep using them.

**Implementation strategy:** factor a private `_runWithFarmContext(farmCtx | null, ...)` helper inside each adapter so the slug variant is `~10 lines` of "resolve via slug, delegate". Avoid copy-pasting the 80-line adapter body.

## Domain extraction → `lib/domain/nvd/`

The current business logic in `lib/server/nvd.ts` (307 lines) splits cleanly:

- `lib/domain/nvd/issue.ts` — `issueNvd(prisma, input)` (move; was `issueNvd`).
- `lib/domain/nvd/validate.ts` — `validateNvdAnimals(prisma, animalIds)` (move).
- `lib/domain/nvd/void.ts` — `voidNvd(prisma, id, reason)` (move).
- `lib/domain/nvd/get.ts` — NEW: `getNvdById(prisma, id)`, `listNvds(prisma, { page, limit })` (lift the inline `prisma.nvdRecord.findUnique`/`findMany` from the routes).
- `lib/domain/nvd/pdf.ts` — NEW: `renderNvdPdf(record): { pdf: Buffer; filename: string }` (thin wrapper that builds the response shape; `buildNvdPdf` continues to live in `lib/server/nvd-pdf.ts` and is consumed here).
- `lib/domain/nvd/snapshot.ts` — `buildSellerSnapshot`, `buildAnimalSnapshot`, `generateNvdNumber`, the type re-exports (`SellerSnapshot`, `AnimalSnapshotEntry`, `ValidationResult`, `NvdTransportDetails`, `NvdIssueInput`).
- `lib/domain/nvd/errors.ts` — typed errors (see below).
- `lib/domain/nvd/index.ts` — barrel.

`lib/server/nvd.ts` is reduced to a re-export shim so any non-route caller (e.g. PDF route, exporters, tests) keeps working unchanged.

## Typed errors

5 new error classes in `lib/domain/nvd/errors.ts`:

| Class | HTTP | code |
|---|---|---|
| `NvdNotFoundError` | 404 | `NVD_NOT_FOUND` |
| `NvdAlreadyVoidedError` | 409 | `NVD_ALREADY_VOIDED` |
| `InvalidTransportError` | 400 | `INVALID_TRANSPORT` (carries `details: { field }` for `driverName` / `vehicleRegNumber` / `vehicleMakeModel`) |
| `MissingRequiredFieldError` | 400 | `MISSING_REQUIRED_FIELD` (carries `details: { field }` for `saleDate` / `buyerName` / `animalIds` / `declarationsJson`) |
| `InvalidAnimalIdsError` | 400 | `INVALID_ANIMAL_IDS` |

Wire shape stays bare `{ error: CODE }` (or `{ error, details }` for the field-bearing ones) per `mapApiDomainError`'s contract. Mirrors `InvalidDateFormatError` from Wave D (which carries `{ error, details: { field } }`).

`lib/server/api-errors.ts` extended with 5 new mappings (see Wave F's pattern in the same file lines ~98-114).

## Wire-shape preservation

| Layer | Pre-G1 | Post-G1 | Migration cost |
|---|---|---|---|
| 401 unauthorised | `{ error: "Unauthorized" }` | `{ error: "AUTH_REQUIRED", message: "Unauthorized" }` | Same envelope migration as Wave A. Existing tests already use `AUTH_REQUIRED` envelope from earlier waves. |
| 403 forbidden | `{ error: "Forbidden" }` | `{ error: "FORBIDDEN" }` | Same as Wave B/C/D/E/F. |
| 404 not-found | `{ error: "NVD not found" }` | `{ error: "NVD_NOT_FOUND" }` | Tests must change. (Same migration as Wave B's `MOB_NOT_FOUND`.) |
| 409 already-voided | `{ error: "NVD is already voided" }` | `{ error: "NVD_ALREADY_VOIDED" }` | New code; tests new. |
| 400 invalid body | `{ error: "Invalid JSON body" }` | `{ error: "INVALID_BODY", message: "..." }` | Adapter shape. Existing tests covering `Invalid JSON body` need updating. |
| 400 transport | varies (`"transport.driverName is required ..."`) | `{ error: "INVALID_TRANSPORT", details: { field: "driverName" } }` | Tests must change. |
| 400 missing field | varies (`"saleDate is required (YYYY-MM-DD)"`) | `{ error: "MISSING_REQUIRED_FIELD", details: { field: "saleDate" } }` | Tests must change. |
| 422 issueNvd domain failure | `{ error: <message> }` | `{ error: <CODE> }` if classifiable as a typed error, else 500 `DB_QUERY_FAILED` | Audit `issueNvd` throws — most are policy errors that should become typed errors; bare `Error` instances become 500. |
| 429 rate-limit | `{ error: "Too many NVD requests..." }` | **unchanged** — handler returns 429 before calling adapter logic. | None. |
| 200 PDF | `Response(pdf, { Content-Type, Content-Disposition })` | **unchanged** — `tenantReadSlug` returns whatever `Response` the handler returns. | None. **Critical: do NOT wrap binary in JSON envelope.** |

Audit the existing nvd test suite (`__tests__/api/nvd*.test.ts`) and update wire-shape expectations where necessary. Do not change behaviour — only the envelope.

## Audit baseline path swaps

When `findUnique`/`findMany` calls move from the routes into `lib/domain/nvd/get.ts`, swap baseline entries (don't add new exemptions). Touch:

- `.audit-findmany-baseline.json` — replace any `app/api/[farmSlug]/nvd/...` entries with `lib/domain/nvd/get.ts`
- `.audit-findmany-no-select-baseline.json` — same path swap if applicable

If neither file currently has a `[farmSlug]/nvd/...` entry, no change needed.

## File allow-list

The TDD agent may ONLY edit files listed below. Out-of-list edits get flagged in the agent report.

```
# Adapter additions
lib/server/route/types.ts
lib/server/route/index.ts
lib/server/route/tenant-read-slug.ts                       (NEW)
lib/server/route/tenant-write-slug.ts                      (NEW)
lib/server/route/admin-write-slug.ts                       (NEW)
lib/server/route/_resolve-slug.ts                          (NEW; shared resolver helper, optional)
lib/server/route/__tests__/tenant-read-slug.test.ts        (NEW)
lib/server/route/__tests__/tenant-write-slug.test.ts       (NEW)
lib/server/route/__tests__/admin-write-slug.test.ts        (NEW)

# Domain extraction
lib/server/nvd.ts                                          (reduce to re-export shim)
lib/domain/nvd/issue.ts                                    (NEW)
lib/domain/nvd/validate.ts                                 (NEW)
lib/domain/nvd/void.ts                                     (NEW)
lib/domain/nvd/get.ts                                      (NEW)
lib/domain/nvd/pdf.ts                                      (NEW)
lib/domain/nvd/snapshot.ts                                 (NEW)
lib/domain/nvd/errors.ts                                   (NEW)
lib/domain/nvd/index.ts                                    (NEW)
lib/domain/nvd/__tests__/issue.test.ts                     (NEW)
lib/domain/nvd/__tests__/validate.test.ts                  (NEW)
lib/domain/nvd/__tests__/void.test.ts                      (NEW)
lib/domain/nvd/__tests__/get.test.ts                       (NEW)

# Error envelope
lib/server/api-errors.ts                                   (add 5 NVD error mappings)

# Routes migrated
app/api/[farmSlug]/nvd/route.ts
app/api/[farmSlug]/nvd/validate/route.ts
app/api/[farmSlug]/nvd/[id]/route.ts
app/api/[farmSlug]/nvd/[id]/void/route.ts
app/api/[farmSlug]/nvd/[id]/pdf/route.ts

# Coverage gates + envelope tests
__tests__/api/route-handler-coverage.test.ts               (remove 5 NVD exempt entries: lines for [farmSlug]/nvd/route.ts, /nvd/validate/route.ts, /nvd/[id]/route.ts, /nvd/[id]/void/route.ts, /nvd/[id]/pdf/route.ts)
__tests__/api/nvd*.test.ts                                 (existing wire-shape expectations updated)

# Audit baselines (path-swap only — no new exemptions)
.audit-findmany-baseline.json
.audit-findmany-no-select-baseline.json

# Spec doc
tasks/wave-165-nvd.md                                      (this file)
```

## TDD discipline

For each new module:

1. **Red** — write the failing test first (e.g. `issue.test.ts` asserting `issueNvd` throws `MissingRequiredFieldError` with `details.field === "saleDate"` when given an empty saleDate).
2. **Green** — minimal implementation to pass.
3. **Refactor** — extract shared helpers, tighten types, run vitest.

For the adapter variants:

1. **Red** — `tenant-read-slug.test.ts` asserting that `tenantReadSlug({ handle })` resolves via `getFarmContextForSlug` (mock it) and emits `AUTH_REQUIRED` on null context.
2. **Green** — implement the resolver swap.
3. **Refactor** — extract `_resolveFarmContextForSlug` private helper if needed.

For the routes:

1. **Red** — fix any test breakage from envelope-shape changes; add tests for newly-typed error paths (e.g. `INVALID_TRANSPORT` with field detail).
2. **Green** — migrate the route to call `tenantReadSlug`/`adminWriteSlug` with the domain op.
3. **Refactor** — confirm the route file shrinks to ~30-50 lines per route.

## 8-gate checklist (before requesting promote)

- [ ] `rm -rf .next/cache/tsbuildinfo .tsbuildinfo && npx tsc --noEmit` — clean
- [ ] `pnpm vitest run lib/domain/nvd lib/server/route __tests__/api/nvd __tests__/api/route-handler-coverage` — all green
- [ ] `pnpm vitest run` — full suite green
- [ ] `pnpm build --webpack` — green
- [ ] route-handler-coverage test passes with 5 NVD exempt entries removed
- [ ] `mapApiDomainError` extended with 5 NVD typed errors (instanceof checks)
- [ ] PDF route returns binary `Response` unchanged (Content-Type + Content-Disposition preserved)
- [ ] No out-of-list edits without flagging

## Hand-off (what the agent reports)

In the final agent message, list:

1. Commits authored (subject lines).
2. PR diff stats (`git diff --stat origin/main...HEAD | tail -1`).
3. Any out-of-list edits and why they were necessary.
4. Final test counts (`vitest run --reporter=verbose | tail -5`).
5. Any wire-shape changes that broke pre-existing tests and the count of test-file edits made.
6. Branch SHA at hand-off so the orchestrator can open the PR.

The orchestrator (parent Claude) opens the PR, monitors gates, applies promote, merges, and verifies post-merge-promote.
