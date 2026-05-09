# Wave H3 — `publicHandler` wrapping (einstein/* routes)

**Branch:** `wave/175-public-handler-h3`
**Worktree:** `.worktrees/wave/175-public-handler-h3`
**ADR:** ADR-0001 8/8 part 3 — third `publicHandler` sub-wave (Wave H subdivision)
**Risk:** MEDIUM — touches Einstein RAG endpoints (paid feature, OpenAI streaming, budget stamping). NOT security-critical surface (no auth/payment file changes), so auto-promote is allowed per CLAUDE.md §promote-delegation.

---

## Background

Wave H1 (PR #173, 5 routes) shipped low-risk publicHandler pilot. Wave H2 (PR #174, 4 auth routes) shipped under per-diff Luc approval. Both proved the wrapping pattern: `publicHandler({ handle })` adds outer try/catch + observability, success Response flows through unchanged (including binary, redirects, streams, cookies-on-responses).

Wave H3 covers the **Einstein Q&A endpoints** — paid-tier Phase L Wave 2B routes. They use legacy tenant resolution (slug from request body for `ask`; `getFarmContext` cookie-based for `feedback`) which is incompatible with the slug-aware adapters' URL-based `getFarmContextForSlug`. publicHandler is correct: each route does its own session + tier + farm-context resolution inline.

---

## Strict 3-file allow-list

The agent may ONLY edit these 3 files. Any other edit is out-of-scope and must be reverted before commit.

```
app/api/einstein/ask/route.ts        (348 lines, POST, SSE streaming)
app/api/einstein/feedback/route.ts   (101 lines, POST, JSON)
__tests__/api/route-handler-coverage.test.ts   ← shrink EXEMPT by 2 entries
```

**Plus expected sig-update fan-out** (per Wave H1/H2 precedent):
1. Run `rg "from .*einstein/ask/route|from .*einstein/feedback/route" __tests__/` — pre-flight check confirmed **zero direct test callers** today; no per-test sig-updates expected.
2. Run `pnpm vitest run __tests__/auth/admin-write-routes-check-role.test.ts` after the EXEMPT shrink — if it flags the 2 routes, add them to the `NON_ADMIN_WRITE` allowlist (mirrors H1's 5-entry expansion + H2's 4-entry expansion).

---

## Adapter signature reminder

`publicHandler` from `lib/server/route/public-handler.ts:30-50`:

```ts
export function publicHandler<TParams extends RouteParams = RouteParams>(
  opts: PublicHandlerOpts<TParams>,
): RouteHandler<TParams>;

interface PublicHandlerOpts<TParams> {
  handle: (req: NextRequest, params: TParams) => Promise<Response> | Response;
}
```

Behaviour:
- `withServerTiming` instrumentation around `handle`.
- `try` → `await handle(req, params)`.
- `catch` → `mapApiDomainError(err)` → fall back to `routeError("DB_QUERY_FAILED", message, 500)`.
- **Success Response is returned unchanged.** Including `text/event-stream` SSE, `ReadableStream` bodies, custom headers, etc. Same pass-through behaviour as G7 export PDF, G8 IT3 PDF, H1 farms/select redirect+cookie.

Async-only constraint: `PublicHandle` requires `Promise<Response>` strictly. Both routes are already `async function POST(req: NextRequest): Promise<Response>` — direct match.

---

## Per-route migration

### 1. `app/api/einstein/ask/route.ts` (POST, 348 lines)

**Critical preservation:** This is the paid-tier RAG endpoint with **mark-before-send cost stamping**, **SSE streaming**, and a **best-effort `RagQueryLog` row in `finally`**. Three semantic invariants must survive verbatim:

1. **Order:** session → JSON parse → tier gate (`getFarmCreds` + `isPaidTier`) → farm auth (`getPrismaForSlugWithAuth`) → budget assertion (`assertWithinBudget`) → query plan (`planQuery`) → retrieve (hybrid or semantic) → load aiSettings → mark-before-send (`stampCostBeforeSend`) → open SSE stream → iterate `streamAnswer()` → `finally` log row + close controller.
2. **Mark-before-send must complete BEFORE the streaming call starts.** The estimated pessimistic cost is committed to the budget meter so a mid-stream crash doesn't leak budget.
3. **`RagQueryLog` write in `finally` must never throw into the stream.** Inner try/catch around `prisma.ragQueryLog.create` preserved verbatim.

**Pattern:**

```ts
export const POST = publicHandler({
  handle: async (req: NextRequest): Promise<Response> => {
    const session = await getServerSession(authOptions);
    if (!session) return jsonError('EINSTEIN_UNAUTHENTICATED', 'Sign in required', 401);
    // ... rest of body verbatim ...
    return new Response(stream, { headers: { ... } });
  },
});
```

**Module-level preserved verbatim:** `runtime`, `dynamic`, `jsonError`, `AskBody` interface, `parseBody`, `estimatePessimisticCostZar`, `readAiSettingsFromPrisma`. JSDoc preserved. Imports unchanged except for adding `publicHandler` from `@/lib/server/route`.

**Wire-shape:** all error paths return `jsonError(CODE, message, status)` which produces `{ code, message }` envelope. The 2 budget-error paths return `{ code, message, resetsAt }`. SSE happy path returns streaming `text/event-stream` Response with `event: token | final | error` frames. **All preserved verbatim.**

**Risk vector — adapter outer catch:** if any thrown exception bubbles past the route's inner try/catches, the adapter will mint `routeError("DB_QUERY_FAILED", message, 500)` instead of an Einstein-typed code. This is the SAME behaviour as today (anything not caught inline becomes a 500), so wire-shape is unchanged. The Einstein codes are emitted only for explicitly-handled failure modes.

---

### 2. `app/api/einstein/feedback/route.ts` (POST, 101 lines)

**Pattern:**

```ts
export const POST = publicHandler({
  handle: async (req: NextRequest): Promise<Response> => {
    let rawBody: unknown;
    try { rawBody = await req.json(); }
    catch { return jsonError('EINSTEIN_BAD_REQUEST', 'Request body must be valid JSON', 400); }
    // ... rest verbatim ...
  },
});
```

**Tenant resolution preserved:** uses `getFarmContext(req)` (cookie-based active farm) NOT `getFarmContextForSlug` (URL slug). publicHandler is correct because:
1. The route doesn't accept a `[farmSlug]` URL parameter.
2. The slug is implicit (active-farm cookie set by `farms/[slug]/select`).
3. Migrating to a slug-aware adapter would require a route relocation under `app/api/[farmSlug]/einstein/feedback/route.ts` + a client-side path change — out of scope for this wave.

**Wire-shape:** all paths return `jsonError(CODE, message, status)` → `{ code, message }`. Happy path returns `{ success: true, id }`. Prisma P2025 mapped to `EINSTEIN_FEEDBACK_NOT_FOUND` (404); other failures `EINSTEIN_FEEDBACK_FAILED` (500). All preserved verbatim.

**Module-level preserved verbatim:** `runtime`, `dynamic`, `jsonError`, `FeedbackBody` interface, `parseBody`. JSDoc preserved.

---

## EXEMPT shrink

`__tests__/api/route-handler-coverage.test.ts` — remove these 2 lines:

```diff
   "csp-report/route.ts" ← already removed in H1
-  "einstein/ask/route.ts",
-  "einstein/feedback/route.ts",
   "farms/[slug]/select/route.ts" ← already removed in H1
```

**Update the H1+H2 comment block** to extend with: "Wave H3 (#175) wraps `einstein/ask`, `einstein/feedback`. NextAuth catch-all (`auth/[...nextauth]/route.ts`) and Inngest serve (`inngest/route.ts`) stay EXEMPT — assessed in H4 (framework-managed handlers may be permanent carve-outs)."

---

## Pre-flight reading order

1. `tasks/wave-175-public-handler-h3.md` (this spec — read in full first).
2. `lib/server/route/public-handler.ts`.
3. `lib/server/route/types.ts`.
4. `app/api/einstein/ask/route.ts` (read fully — 348 lines).
5. `app/api/einstein/feedback/route.ts` (read fully — 101 lines).
6. `__tests__/api/route-handler-coverage.test.ts` (locate the 2 entries to remove + the H1/H2 comment block to extend).
7. **Reference H1 + H2 diffs:**
   - `gh pr diff 173 -- app/api/health/route.ts` (publicHandler pattern with sync→async wrap).
   - `gh pr diff 173 -- app/api/farms/\[slug\]/select/route.ts` (publicHandler with redirect Response pass-through).
   - `gh pr diff 174 -- app/api/auth/login-check/route.ts` (publicHandler with typed envelope).
   - `gh pr diff 174 -- __tests__/auth/admin-write-routes-check-role.test.ts` (allowlist annotation pattern).

---

## 8-gate demo-ready checklist

Run from inside the worktree (`.worktrees/wave/175-public-handler-h3`):

1. **node_modules:** `pnpm install --prefer-offline` (worktrees may not have it).
2. **Build:** `pnpm build --webpack` (NEVER --turbopack — breaks Serwist).
3. **tsc:** `rm -rf .next/cache/tsbuildinfo .tsbuildinfo && pnpm prisma generate && pnpm tsc --noEmit`. Expected: 36 pre-existing errors in `tests/e2e/*` + `__tests__/einstein/*` + `__tests__/server/farm-context-retry.test.ts` (matches origin/main baseline). 0 new errors in touched files. **Note:** `__tests__/einstein/*` already has pre-existing errors per baseline; this wave doesn't touch those.
4. **Vitest:** `pnpm vitest run` — expect **2840 passed / 19 skipped** baseline. Variance ±0.
5. **Lint:** `pnpm lint` — expect 138 warnings, 0 errors.
6. **audit-findmany-no-take:** `pnpm tsx scripts/audit-findmany-no-take.ts`.
7. **audit-findmany-no-select:** `pnpm tsx scripts/audit-findmany-no-select.ts`.
8. **Git status:** `git status -sb` — exactly the 3 allow-list files + spec + any admin-write-routes-check-role allowlist update. `public/sw.js` and `public/templates/farmtrack-import-template.xlsx` always show dirty after build — DO NOT stage. Reset with `git checkout -- public/sw.js public/templates/`.
9. **Route-handler-coverage invariant:** `pnpm vitest run __tests__/api/route-handler-coverage.test.ts` — passes with 2 EXEMPT entries removed.

---

## Anti-patterns

1. ❌ **Touching `lib/einstein/*`.** Out of scope. The route's helpers (`assertWithinBudget`, `stampCostBeforeSend`, `planQuery`, `retrieve.*`, `streamAnswer`) live in `lib/einstein/` — DO NOT modify them. Wave H3 is publicHandler-wrap-only.
2. ❌ **Changing the SSE streaming model in `ask`.** `new Response(stream, { headers })` flows through publicHandler unchanged. Do NOT replace `ReadableStream` with anything else. Do NOT change SSE event names (`token`, `final`, `error`). Do NOT change SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`).
3. ❌ **Changing mark-before-send order.** `stampCostBeforeSend` MUST complete before the `new ReadableStream(...)` constructor. Moving it later (or removing it) breaks the budget invariant.
4. ❌ **Changing the `finally` block in `ask`.** The `RagQueryLog` create + inner try/catch + `controller.close()` must remain verbatim. Adapter never sees this — it's inside the stream lifecycle.
5. ❌ **Changing `getFarmContext` to `getFarmContextForSlug` in `feedback`.** The route uses cookie-based active-farm resolution intentionally (no URL slug param). Migration to slug-aware adapter is a separate refactor.
6. ❌ **Adding new tests.** Pure-transport migration. Existing `__tests__/einstein/*` already has pre-existing tsc errors at baseline; H3 doesn't fix or modify them.
7. ❌ **Changing wire-shape.** Every `jsonError(CODE, message, status)` call preserved verbatim. Budget-error 3-field response (`{ code, message, resetsAt }`) preserved.
8. ❌ **Touching `lib/auth-options.ts` or any auth file.** Out of scope. The `getServerSession` call in `ask` is the only auth touch and stays inside `handle` verbatim.
9. ❌ **Using `--no-verify` to skip pre-commit hooks.**

---

## Commit + PR

After all gates pass:

1. Stage the 3 allow-list files + spec + any sig-update fan-out:
   ```
   git add app/api/einstein/ask/route.ts \
           app/api/einstein/feedback/route.ts \
           __tests__/api/route-handler-coverage.test.ts \
           tasks/wave-175-public-handler-h3.md \
           [admin-write-routes-check-role.test.ts if needed]
   ```

2. Commit (HEREDOC):
   ```
   git commit -m "$(cat <<'EOF'
   feat(public-handler): migrate 2 einstein/* routes onto publicHandler (Wave H3, ADR-0001 8/8 part 3)

   Migrates the Farm Einstein RAG endpoints (ask + feedback) onto the
   publicHandler adapter. Pure transport-layer migration; zero behaviour change.
   Wire-shape preserved verbatim across both routes — including:

   - ask: typed { code, message } envelope on all error paths; SSE streaming
     Response flows through publicHandler unchanged (same pass-through pattern as
     G7 export PDF, G8 IT3 PDF, H1 farms/select redirect+cookie).
   - feedback: typed { code, message } envelope on all error paths; { success,
     id } happy path; Prisma P2025 → EINSTEIN_FEEDBACK_NOT_FOUND (404); other
     failures → EINSTEIN_FEEDBACK_FAILED (500).

   Critical semantic invariants preserved verbatim in `ask`:
   1. Mark-before-send cost stamping (stampCostBeforeSend) completes BEFORE
      the SSE streaming call starts.
   2. SSE event names (token | final | error) and SSE headers
      (text/event-stream, no-cache, no-transform, X-Accel-Buffering: no).
   3. Best-effort RagQueryLog write in `finally` — inner try/catch never lets
      the log row throw into the stream.

   Tenant resolution preserved verbatim: ask uses session + slug-from-body +
   getPrismaForSlugWithAuth; feedback uses cookie-based getFarmContext.
   Neither route uses the [farmSlug] URL pattern — slug-aware adapters
   (tenantReadSlug et al.) are not applicable here.

   Shrinks EXEMPT in __tests__/api/route-handler-coverage.test.ts by 2 entries.
   NextAuth catch-all + Inngest serve stay EXEMPT — assessed in H4.

   Refs ADR-0001 publicHandler rollout. Third sub-wave of Wave H. H1 (#173) +
   H2 (#174) shipped 5 + 4 routes. H4 = framework-managed assessment, H5 =
   webhooks/payfast (per-diff Luc approval required).

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

3. Push: `git push -u origin wave/175-public-handler-h3`

4. Open PR with `gh pr create` per the spec template. Body should include:
   - Summary (3 bullets: scope, MEDIUM-risk vectors, ADR pointer).
   - 2-route checklist with line counts.
   - 8-gate green confirmation.
   - "Wire-shape verified verbatim" note.
   - "Mark-before-send + SSE invariants preserved" note.
   - Forward-pointer: H4 framework-managed, H5 webhooks/payfast.

5. **DO apply the `promote` label** — H3 is NOT security-critical surface (no auth/payment file edits). Standard auto-promote per §promote-delegation.

   Wait — the dispatcher will handle promote+merge after the soak; the agent just opens the PR. **Do NOT apply the `promote` label as part of this dispatch.** The dispatcher applies it post-soak.

---

## Hand-off report (when done)

Report back with:

- PR number + URL.
- Head SHA.
- Vitest pass count (must be 2840).
- Lint warning count (must be 138).
- Audit-findmany / audit-findmany-no-select status.
- Build/tsc status.
- `git status -sb` final output (must be empty after commit + push).
- All 2 EXEMPT entries removed confirmation.
- Sig-update fan-out: confirm `rg` for direct callers shows zero, and report whether `admin-write-routes-check-role.test.ts` needed an allowlist update (run the test post-EXEMPT-shrink to confirm).
- Confirmation that `runtime`, `dynamic`, `jsonError`, `AskBody`, `parseBody`, `estimatePessimisticCostZar`, `readAiSettingsFromPrisma`, `FeedbackBody` module-level exports/locals are unchanged.
- Confirmation that mark-before-send order is preserved (stampCostBeforeSend BEFORE `new ReadableStream`).
- Confirmation that SSE event names + headers are unchanged.
- Any deviation from the spec, with reason. The spec is strict.
