# Wave H2 — `publicHandler` wrapping (auth/* routes)

**Branch:** `wave/174-public-handler-h2`
**Worktree:** `.worktrees/wave/174-public-handler-h2`
**ADR:** ADR-0001 8/8 part 2 — second `publicHandler` sub-wave (Wave H subdivision)
**Risk:** MEDIUM — touches `app/api/auth/**` surface. **Per CLAUDE.md §promote-delegation rule 5, this PR cannot auto-promote.** It REQUIRES per-diff Luc approval. The wrapping itself is mechanical (publicHandler is a pure pass-through that adds only try/catch + observability) — but the surface is security-critical and the policy is explicit.

---

## Background

Wave H1 (PR #173) shipped 5 low-risk publicHandler routes (csp-report, health, telemetry/{vitals,client-errors}, farms/[slug]/select). Pattern fully proven: wrap existing handler body in `publicHandler({ handle })`, async-ify if not already, drop unused `_req` param via TS contravariance.

Wave H2 covers the **auth flow entry points** — 4 unauthenticated routes that handle user passwords, registration, and email-verification tokens. They are intentionally outside the proxy.ts matcher and use their own validation + rate-limiting per route.

---

## Strict 5-file allow-list

The agent may ONLY edit these 5 files. Any other edit is out-of-scope and must be reverted before commit.

```
app/api/auth/login-check/route.ts        (115 lines, POST)
app/api/auth/register/route.ts           (93 lines, POST)
app/api/auth/resend-verification/route.ts (111 lines, POST)
app/api/auth/verify-email/route.ts       (48 lines, GET)
__tests__/api/route-handler-coverage.test.ts   ← shrink EXEMPT by 4 entries
```

**Plus expected sig-update fan-out** (per Wave H1 precedent): if any pre-existing test imports any of these 4 routes' handlers and calls them as bare `(req)` instead of `(req, ctx)`, that test file must have its call sites updated to `(req, CTX)` where `CTX = { params: Promise.resolve({}) }`. Test logic unchanged. Add only the file paths needed; report each in the hand-off.

No domain extraction. No `lib/` changes. No new tests. No tsconfig/package changes. Pure transport-layer migration.

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
- **No body parse, no auth check.** Each route does its own.

Async-only constraint: `PublicHandle` requires `Promise<Response>` strictly — sync return triggers TS2322. All 4 H2 routes are already async, so no change needed there.

---

## Per-route migration

### 1. `app/api/auth/login-check/route.ts` (POST, 115 lines)

**Current:** `export async function POST(request: NextRequest): Promise<NextResponse>` — preserves typed `LoginCheckResponse = { ok: true } | { ok: false; reason: AuthErrorCode }` envelope. Always 200 (or 500 on true server faults).

**Pattern:**

```ts
export const POST = publicHandler({
  handle: async (request: NextRequest) => {
    let body: { identifier?: unknown; password?: unknown };
    try {
      body = await request.json();
    } catch {
      return payload({ ok: false, reason: AUTH_ERROR_CODES.INVALID_CREDENTIALS });
    }
    // ... rest of body verbatim ...
    return payload({ ok: true });
  },
});
```

**Wire-shape:** unchanged. Every code path returns `payload({ ok, reason })` — including malformed-JSON case. The adapter's outer try/catch catches *unexpected* throws (e.g. `compareSync` panicking); existing inner try/catches around `getUserByIdentifier` and `isEmailVerified` are SEMANTIC and stay verbatim.

**Anti-enumeration timing match preserved:** the 200 response on user-not-found is part of the security model (see file-level JSDoc). Adapter does not change response timing meaningfully — `withServerTiming` is observability only.

---

### 2. `app/api/auth/register/route.ts` (POST, 93 lines)

**Current:** `export async function POST(request: NextRequest)` — IP-based rate limit (5/hour), validation gauntlet (5 fields), anti-enumeration timing match via dummy `hash(password, 12)` on existing-email branch, provisionFarm call, 500 on provision failure.

**Pattern:** Wrap entire body in `publicHandler({ handle })`. Module-level interface `RegisterBody` and constant `ANTI_ENUM_RESPONSE` preserved.

**Wire-shape:** unchanged. Bare-string `{ error: "<sentence>" }` 4xx envelopes preserved verbatim per Wave G hybrid Option A. `{ success: true, pending: true }` happy path preserved. 429 rate-limit envelope preserved. 500 generic-error envelope preserved.

**Anti-enumeration timing match preserved:** dummy `hash(password, 12)` on existing-email branch stays inside `handle`. Adapter does not alter wall-clock cost of either branch.

---

### 3. `app/api/auth/resend-verification/route.ts` (POST, 111 lines)

**Current:** `export async function POST(request: NextRequest)` — stacked rate limits (per-IP 5/hour BEFORE per-email 1/5min), anti-enumeration response (always `{ ok: true }` for any "user state" failure), only logs server errors.

**Pattern:** Wrap entire body in `publicHandler({ handle })`. JSDoc preserved.

**Wire-shape:** unchanged. The endpoint's anti-enumeration model returns `{ ok: true }` for: rate-limited-after-IP-pass, user-not-found, already-verified, AND happy path — preserved verbatim. Bare-string `{ error: "<sentence>" }` for: per-IP rate limit (429), invalid JSON (400), invalid email (400), server error (500) — preserved verbatim.

**Stacked rate-limit ordering preserved:** the comment block "Per-email limit — applied BEFORE the lookup so an attacker can't use response timing" is a critical security invariant. Order of operations inside `handle` stays exactly as today.

---

### 4. `app/api/auth/verify-email/route.ts` (GET, 48 lines)

**Current:** `export async function GET(request: Request)` — note `Request` not `NextRequest` (compatible with publicHandler signature). Always 200 with typed `VerifyEmailResponse | VerifyEmailErrorResponse` (uses `valid: boolean` not `ok`). 500 fallback on caught throw.

**Pattern:**

```ts
export const GET = publicHandler({
  handle: async (request: NextRequest) => {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    // ... rest verbatim ...
  },
});
```

**Type widening:** `Request` → `NextRequest` is safe (NextRequest extends Request). The route already imports nothing from `next/server` for the request type (line 1 imports `NextResponse` only); add `import type { NextRequest } from "next/server"` only if needed for the signature.

**Wire-shape:** unchanged. Always 200 with typed `{ valid, reason }` envelope. 500 fallback on catch preserved.

**Exported types preserved:** `VerifyEmailReason`, `VerifyEmailResponse`, `VerifyEmailErrorResponse` are imported by client code. Do NOT remove or rename. They remain at module scope, not inside `handle`.

---

## EXEMPT shrink

`__tests__/api/route-handler-coverage.test.ts` — remove these 4 lines from the EXEMPT set (in the proxy-matcher exclusion section, currently lines 43-46 — verify line numbers post-H1):

```diff
   "auth/[...nextauth]/route.ts",
-  "auth/login-check/route.ts",
-  "auth/register/route.ts",
-  "auth/resend-verification/route.ts",
-  "auth/verify-email/route.ts",
   "csp-report/route.ts" ← already removed in H1
   ...
```

**Update the H1 comment block** (lines 41-44 from H1) to extend with: "Wave H2 (#174) wraps `auth/login-check`, `auth/register`, `auth/resend-verification`, `auth/verify-email`. NextAuth catch-all (`auth/[...nextauth]/route.ts`) stays EXEMPT — to be assessed in H4."

---

## Pre-flight reading order

1. `tasks/wave-174-public-handler-h2.md` (this spec — read in full first).
2. `lib/server/route/public-handler.ts` (51 lines — adapter signature).
3. `lib/server/route/types.ts` (`PublicHandlerOpts`, `RouteHandler`, `RouteParams`).
4. `lib/server/route/index.ts` (confirm `publicHandler` export).
5. The 4 target route files (read each fully before editing).
6. `__tests__/api/route-handler-coverage.test.ts` (locate the 4 entries to remove + the H1 comment block).
7. **PR #173 reference (Wave H1):** look at the diff for `app/api/health/route.ts`, `app/api/csp-report/route.ts`, etc. Same pattern applies here. Use `gh pr diff 173 -- app/api/health/route.ts` if needed.
8. Search for direct-call callers of the 4 H2 routes' POST/GET exports:
   ```
   rg "from .*auth/login-check/route" __tests__/
   rg "from .*auth/register/route" __tests__/
   rg "from .*auth/resend-verification/route" __tests__/
   rg "from .*auth/verify-email/route" __tests__/
   ```
   Any caller that does `POST(req)` (no second arg) needs the H1-style sig-update to `POST(req, { params: Promise.resolve({}) })`. Report exact paths in hand-off.

---

## 8-gate demo-ready checklist

Run from inside the worktree (`.worktrees/wave/174-public-handler-h2`):

1. **Build:** `pnpm build --webpack` (NEVER --turbopack — breaks Serwist).
2. **tsc:** `rm -rf .next/cache/tsbuildinfo .tsbuildinfo && pnpm prisma generate && pnpm tsc --noEmit`. Expected: 36 pre-existing errors in `tests/e2e/*.spec.ts` + `__tests__/einstein/*` + `__tests__/server/farm-context-retry.test.ts` (matches origin/main baseline). 0 new errors in touched files.
3. **Vitest:** `pnpm vitest run` — expect **2840 passed / 19 skipped** baseline. Variance ±0.
4. **Lint:** `pnpm lint` — expect 138 warnings, 0 errors. No new warnings.
5. **audit-findmany-no-take:** `pnpm tsx scripts/audit-findmany-no-take.ts` (note: spec H1 mentioned wrong filename `audit-findmany.ts` — actual is `audit-findmany-no-take.ts`).
6. **audit-findmany-no-select:** `pnpm tsx scripts/audit-findmany-no-select.ts`.
7. **Git status:** `git status -sb` — exactly the 5 allow-list files + any sig-update test files + spec. `public/sw.js` and `public/templates/farmtrack-import-template.xlsx` always show dirty after build — DO NOT stage. Reset with `git checkout -- public/sw.js public/templates/`.
8. **Route-handler-coverage invariant:** `pnpm vitest run __tests__/api/route-handler-coverage.test.ts` — passes with 4 EXEMPT entries removed.

---

## Anti-patterns

1. ❌ **Touching `lib/auth-options.ts` or any other `lib/auth-*.ts` file.** Out of scope. CLAUDE.md §promote-delegation explicitly carves out auth-options as Luc-eyes-only territory. The H2 wave is publicHandler-wrap-only — zero changes to auth flow logic.
2. ❌ **Changing wire-shape.** Every error envelope preserved verbatim. The `register` 429 message "Too many registration attempts. Please try again later." is exact. The `resend-verification` anti-enumeration `{ ok: true }` invariant is sacred.
3. ❌ **Changing rate-limit windows or counts.** `register: 5/hour per IP`, `resend-verify-ip: 5/hour`, `resend-verify-email: 1/5min`, `login-check: 10/min per identifier` — all preserved exactly.
4. ❌ **Changing anti-enumeration timing matches.** The dummy `hash(password, 12)` on existing-email branch in `register/route.ts` stays. Order of `checkRateLimit` calls in `resend-verification` stays.
5. ❌ **Removing `compareSync` blocking-bcrypt in `login-check`.** It's intentional — `login-check` is the synchronous-credential pre-check; `register` uses async `hash`. Different security models per route, both preserved verbatim.
6. ❌ **Adding new tests.** Pure-transport migration. If existing tests need sig-updates, that's mechanical. New coverage is out of scope.
7. ❌ **Touching `proxy.ts` or `__tests__/api/proxy-matcher.test.ts`.** The 4 routes remain in `KNOWN_PUBLIC_ROUTES` because they're still pre-session entry points.
8. ❌ **Editing the NextAuth catch-all `auth/[...nextauth]/route.ts`.** Stays EXEMPT through H2. Will be assessed in H4 (it wraps `NextAuth(authOptions)` — wrapping that result in publicHandler may interfere with framework-managed auth flow; needs careful read of NextAuth's route segment exports to confirm shape compatibility).
9. ❌ **Using `--no-verify`.** If pre-commit hook fails, fix the underlying issue.

---

## Commit + PR

After all 8 gates pass:

1. Stage exactly the 4 routes + 1 architectural test + any sig-update test files + this spec:
   ```
   git add app/api/auth/login-check/route.ts \
           app/api/auth/register/route.ts \
           app/api/auth/resend-verification/route.ts \
           app/api/auth/verify-email/route.ts \
           __tests__/api/route-handler-coverage.test.ts \
           [any sig-update test files] \
           tasks/wave-174-public-handler-h2.md
   ```

2. Commit (HEREDOC):
   ```
   git commit -m "$(cat <<'EOF'
   feat(public-handler): migrate 4 auth/* routes onto publicHandler (Wave H2, ADR-0001 8/8 part 2)

   Migrates the auth-flow entry points (login-check, register, resend-verification,
   verify-email) onto the publicHandler adapter. Pure transport-layer migration;
   zero behaviour change to auth flows themselves. Wire-shape preserved verbatim
   across all 4 routes — including:

   - login-check's typed { ok: true } | { ok: false; reason } envelope (always 200)
   - register's bare-string { error } 4xx + { success, pending } anti-enumeration
   - resend-verification's anti-enumeration { ok: true } across all "user state" failures
   - verify-email's typed { valid, reason } envelope (always 200) + 500 fallback

   Anti-enumeration timing matches preserved verbatim (dummy hash() in register's
   existing-email branch; per-email rate limit BEFORE user lookup in
   resend-verification). Stacked rate limits preserved exactly: register 5/hour-IP,
   resend-verify-ip 5/hour, resend-verify-email 1/5min, login-check 10/min-identifier.

   Shrinks EXEMPT in __tests__/api/route-handler-coverage.test.ts by 4 entries.
   NextAuth catch-all (auth/[...nextauth]) stays EXEMPT through H2 — assessed in H4.

   SECURITY-CRITICAL surface per CLAUDE.md §promote-delegation rule 5 — promote
   label requires per-diff Luc approval (NOT auto-applied by Claude).

   Refs ADR-0001 publicHandler rollout. Second sub-wave of Wave H. H1 (#173) shipped
   the low-risk pilot; H3-H5 cover einstein/* (H3), framework-managed (H4), and
   webhooks/payfast (H5).

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

3. Push: `git push -u origin wave/174-public-handler-h2`

4. Open PR with `gh pr create --title "feat(public-handler): migrate 4 auth/* routes onto publicHandler (Wave H2, ADR-0001 8/8 part 2)" --body "<HEREDOC>"`. PR body should include:
   - Summary (3 bullets: scope, security-critical flag, ADR pointer).
   - 4-route checklist with line counts + gate types (POST x3, GET x1).
   - 8-gate green confirmation.
   - "Wire-shape verified verbatim" note.
   - "Anti-enumeration models verified" note (3 routes have anti-enum invariants).
   - **Bold callout: PR cannot auto-promote. Per CLAUDE.md §promote-delegation rule 5, auth/** surface requires per-diff Luc approval.**

5. **Do NOT apply the `promote` label.** The dispatching session will pause for Luc to review and apply manually. After the PR is open, hand back to dispatcher.

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
- All 4 EXEMPT entries removed confirmation.
- **List of any sig-update test files added beyond the 5-file allow-list, with the search command results that justified each.**
- Any deviation from the spec, with reason. The spec is strict.
- **Confirm you did NOT apply the `promote` label.** Auth surface is Luc-eyes-only per CLAUDE.md §promote-delegation rule 5.

The dispatching session will pause for Luc approval before any further action on this PR.
