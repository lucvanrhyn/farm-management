# Wave H1 — `publicHandler` wrapping (low-risk pilot)

**Branch:** `wave/173-public-handler-h1`
**Worktree:** `.worktrees/wave/173-public-handler-h1`
**ADR:** ADR-0001 8/8 part 1 — first publicHandler batch (Wave H subdivision)
**Risk:** LOW — pure beacons + tenant-select shortcircuit. Zero behaviour change. Adapter only adds try/catch + observability.

---

## Background

Wave G complete (G1-G8 shipped 2026-05-08/09). All `[farmSlug]/**` routes now wrap `tenantReadSlug` / `tenantWriteSlug` / `adminWriteSlug`. The route-handler architectural invariant (`__tests__/api/route-handler-coverage.test.ts`) shrinks to ~33 EXEMPT entries.

Wave H closes ADR-0001 by wrapping the **proxy-matcher exclusions** in the `publicHandler` adapter. These 14 routes do not pass through the tenant-resolution hop — they're public beacons (csp-report, telemetry, health), framework-managed catch-alls (NextAuth, Inngest), webhooks (PayFast), and the tenant-select shortcircuit.

We're splitting Wave H into 5 sub-waves to bound blast radius. **This is H1: low-risk pilot.** Proves the publicHandler wrapping pattern at scale across 5 routes that touch zero auth/payment surface area.

---

## Strict 6-file allow-list

The agent may ONLY edit these 6 files. Any other edit is out-of-scope and must be reverted before commit.

```
app/api/csp-report/route.ts
app/api/health/route.ts
app/api/telemetry/client-errors/route.ts
app/api/telemetry/vitals/route.ts
app/api/farms/[slug]/select/route.ts
__tests__/api/route-handler-coverage.test.ts   ← shrink EXEMPT by 5 entries
```

No domain extraction. No `lib/` changes. No new tests. No tsconfig/package changes. Pure transport-layer migration.

---

## Adapter signature reminder

`publicHandler` has the simplest contract of any adapter (`lib/server/route/public-handler.ts:30-50`):

```ts
export function publicHandler<TParams extends RouteParams = RouteParams>(
  opts: PublicHandlerOpts<TParams>,
): RouteHandler<TParams>;

interface PublicHandlerOpts<TParams> {
  handle: (req: NextRequest, params: TParams) => Promise<Response> | Response;
  // (no bodySchema, no role, no revalidate — adapter is auth/scope-agnostic)
}
```

Behaviour:
- `withServerTiming` instrumentation around `handle`.
- `try` → `await handle(req, params)`.
- `catch` → `mapApiDomainError(err)` → fall back to `routeError("DB_QUERY_FAILED", message, 500)`.
- **No request-body parse.** Handler reads body itself (preserves `req.text()` / `req.json()` semantics).
- **No auth check.** Handler does its own auth if needed (`farms/[slug]/select` reads session inline).
- **Success Response is returned unchanged.** Including binary, redirects, or `null`-body 204 (precedent: G7 export PDF, G8 IT3 PDF).

---

## Per-route migration

### 1. `app/api/health/route.ts`

**Current:** `export function GET(): NextResponse` — synchronous, no body parse, returns `NextResponse.json(body, { status, headers })`.

**Pattern:**

```ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { publicHandler } from "@/lib/server/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = publicHandler({
  handle: (_req: NextRequest) => {
    const body: { status: "ok"; timestamp: string; version?: string } = {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
    const sha = process.env.VERCEL_GIT_COMMIT_SHA;
    if (sha) body.version = sha;
    return NextResponse.json(body, {
      status: 200,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  },
});
```

**Wire-shape:** unchanged (always 200 OK with same body shape).

---

### 2. `app/api/csp-report/route.ts`

**Current:** `export async function POST(req: NextRequest): Promise<NextResponse>` — reads body as text, parses JSON, normalises to LoggedViolation, always returns 204.

**Pattern:** Wrap body verbatim in `publicHandler({ handle })`. Preserve all module-level constants (`NO_CONTENT`, `pickString`, `pickNumber`, `normaliseLegacy`, `normaliseModern`, JSDoc comment block).

**Wire-shape:** unchanged. The route already returns 204 on every code path (including parse failures), so the adapter's error envelope can't engage in practice — but the try/catch is now structural.

---

### 3. `app/api/telemetry/vitals/route.ts`

**Current:** `export async function POST(req: NextRequest): Promise<NextResponse>` — validates 5 fields with bare-string `{ error: "<sentence>" }` 400 envelopes; success returns `{ ok: true }` 202.

**Pattern:** Wrap entire body in `publicHandler({ handle })`. Module-level constants (`METRIC_NAMES`, `RATINGS`, `MAX_*`) preserved. Bare-string error envelope preserved verbatim per Wave G hybrid wire-shape (Option A).

**Wire-shape:** unchanged. All `{ error: "<sentence>" }` 400s preserved as handler-emitted (not adapter-emitted). Adapter only wraps unexpected `throw` (e.g. libSQL connection error during the fire-and-forget INSERT — already caught by inner try/catch).

---

### 4. `app/api/telemetry/client-errors/route.ts`

**Current:** `export async function POST(req: NextRequest): Promise<NextResponse>` — validates 4 fields; bare-string + typed `code` envelopes (`invalid_json`, `invalid_body`, `invalid_level`, `invalid_message`, `invalid_ts`, `forward_failed`).

**Pattern:** Wrap entire body in `publicHandler({ handle })`. Module-level constants preserved. Existing `{ error, code }` envelope shape preserved verbatim — these are handler-emitted typed codes (predates ADR-0001 hybrid contract; don't touch).

**Wire-shape:** unchanged. The `forward_failed` 500 case stays handler-emitted because it has a typed `code` field that adapter wouldn't add.

---

### 5. `app/api/farms/[slug]/select/route.ts`

**Current:** `export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> })` — reads session, verifies farm access, sets cookie + redirects.

**Pattern:**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { publicHandler } from "@/lib/server/route";
import type { SessionFarm } from "@/types/next-auth";

export const GET = publicHandler<{ slug: string }>({
  handle: async (req: NextRequest, { slug }: { slug: string }) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.redirect(new URL("/login", req.url));
    }

    const accessible = (session.user.farms as SessionFarm[]).some((f) => f.slug === slug);
    if (!accessible) {
      return NextResponse.redirect(new URL("/farms", req.url));
    }

    const response = NextResponse.redirect(new URL(`/${slug}/home`, req.url));
    response.cookies.set("active_farm_slug", slug, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  },
});
```

**Wire-shape:** unchanged. Both auth-fail redirects and success-with-cookie response are returned as `Response` from `handle` — adapter passes through (success-path is NOT wrapped, same as PDF binary in G7/G8). Cookie is set on the redirect response object before it leaves `handle`.

**Why it stays publicHandler (NOT tenantReadSlug):** the route IS the tenant-select shortcircuit. It runs BEFORE the user has an `active_farm_slug` cookie, so `getFarmContextForSlug` would fail. publicHandler is correct per the comment in `public-handler.ts:5-7`: "the `/api/farms/[slug]/select` shortcircuit".

---

## EXEMPT shrink

`__tests__/api/route-handler-coverage.test.ts` — remove these 5 lines from the EXEMPT set (currently lines 46, 47, 49, 51-52 — verify line numbers in the actual file):

```diff
-  "csp-report/route.ts",
   "einstein/ask/route.ts",
   "einstein/feedback/route.ts",
-  "farms/[slug]/select/route.ts",
-  "health/route.ts",
   "inngest/route.ts",
-  "telemetry/client-errors/route.ts",
-  "telemetry/vitals/route.ts",
   "webhooks/payfast/route.ts",
```

**Update the comment block** above the proxy-matcher exclusion section to note that Wave H1 (PR #173) wraps these 5 routes into publicHandler.

---

## Pre-flight reading order

The agent must read these files before writing any code (single-shot reads, no Bash):

1. `lib/server/route/public-handler.ts` (51 lines) — adapter signature.
2. `lib/server/route/types.ts` (lines 70-130) — `PublicHandlerOpts`, `RouteHandler`, `RouteParams`, `RouteContext` types.
3. `lib/server/route/index.ts` — confirm `publicHandler` is exported from the barrel.
4. `lib/server/route/envelope.ts` — confirm `routeError` shape (used internally by adapter only).
5. `lib/server/api-errors.ts` — `mapApiDomainError` signature (adapter falls through to it on exception).
6. `__tests__/api/route-handler-coverage.test.ts` — confirm `publicHandler` is in `ADAPTER_NAMES` (line 107-115).
7. `app/api/[farmSlug]/tax/it3/[id]/pdf/route.ts` (post-G8) — exemplar of adapter passing through `Response` body unchanged (binary PDF case mirrors `farms/[slug]/select` redirect case).
8. The 5 target route files in this allow-list (read each fully before editing).

No external docs needed. No test fixtures touched.

---

## 8-gate demo-ready checklist

Run from inside the worktree (`.worktrees/wave/173-public-handler-h1`). All must pass before commit:

1. **Build:** `pnpm build --webpack` (NEVER `--turbopack` — breaks Serwist).
2. **tsc:** `rm -rf .next/cache/tsbuildinfo .tsbuildinfo && pnpm prisma generate && pnpm tsc --noEmit` (incremental cache trap).
3. **Vitest:** `pnpm vitest run` — expect **2840 passed / 19 skipped** baseline. Variance ±0 vs baseline.
4. **Lint:** `pnpm lint` — expect 138 warnings, 0 errors (baseline). Do not introduce new warnings.
5. **audit-findmany-no-take:** `pnpm tsx scripts/audit-findmany.ts` — pass.
6. **audit-findmany-no-select:** `pnpm tsx scripts/audit-findmany-no-select.ts` — pass.
7. **Git status:** `git status -sb` — exactly **6 modified files** + nothing else. (`public/sw.js` and `public/templates/farmtrack-import-template.xlsx` always show dirty after build — DO NOT stage them. Reset with `git checkout -- public/sw.js public/templates/`.)
8. **Route-handler-coverage invariant:** `pnpm vitest run __tests__/api/route-handler-coverage.test.ts` — passes with 5 entries removed from EXEMPT.

---

## Anti-patterns

Reject every one of these:

1. ❌ **Adding tests.** Pure-transport migration. Adapter has its own tests (`lib/server/route/__tests__/public-handler.test.ts`); the migrated route's behaviour is identical, so existing route tests (if any) still cover it.
2. ❌ **Touching `lib/`.** All edits must be inside `app/api/<route>/route.ts` + the test EXEMPT shrink. Zero `lib/` files.
3. ❌ **Changing wire-shape.** Every error envelope (`{ error: "..." }`, `{ error, code }`, redirects, 204 NO_CONTENT) preserved verbatim. The adapter only catches unexpected throws — if the handler already returns a `Response`, the adapter passes it through.
4. ❌ **Removing `dynamic` / `runtime` / `revalidate` exports.** These are Next.js route segment config — they apply to the file, not the export. `health/route.ts` keeps `export const dynamic = "force-dynamic"` and `export const runtime = "nodejs"` — both unchanged.
5. ❌ **Wrapping inner try/catch.** `csp-report/route.ts` has `try { raw = await req.text() } catch { return NO_CONTENT }` — this is INTENTIONAL (silent 204 on body-read failure). Adapter's outer try/catch is structural; inner try/catch is semantic. Keep both.
6. ❌ **Changing imports beyond the publicHandler add.** Add `import { publicHandler } from "@/lib/server/route"`. Remove nothing unless it becomes literally unused (e.g. if a `NextResponse` import is no longer referenced — unlikely since handlers still emit responses).
7. ❌ **Splitting helper functions out of the route file.** All `pickString`, `normaliseLegacy`, `normaliseModern` etc stay in their existing files. No new files, no extracted modules.
8. ❌ **Editing routes outside the 5-file allow-list.** No exploratory cleanup. No fixing typos in adjacent files. No CLAUDE.md updates. No README updates.
9. ❌ **Using `--no-verify` to skip pre-commit hooks.** If a hook fails, fix the underlying issue and re-stage.

---

## Commit + PR

After all 8 gates pass:

1. Stage exactly the 6 files from the allow-list:
   ```
   git add app/api/csp-report/route.ts \
           app/api/health/route.ts \
           app/api/telemetry/client-errors/route.ts \
           app/api/telemetry/vitals/route.ts \
           app/api/farms/[slug]/select/route.ts \
           __tests__/api/route-handler-coverage.test.ts \
           tasks/wave-173-public-handler-h1.md
   ```
   (7 if the spec is committed alongside; spec commit is optional but recommended for traceability.)

2. Commit (HEREDOC):
   ```
   git commit -m "$(cat <<'EOF'
   feat(public-handler): migrate 5 low-risk routes onto publicHandler (Wave H1, ADR-0001 8/8 part 1)

   Migrates the proxy-matcher exclusion subset that touches zero auth/payment
   surface — pure beacons (csp-report, health, telemetry/{vitals,client-errors})
   and the tenant-select shortcircuit (farms/[slug]/select) — onto the
   publicHandler adapter. Pure transport-layer migration; zero behaviour change.
   Wire-shape preserved verbatim across all 5 routes.

   Shrinks EXEMPT in __tests__/api/route-handler-coverage.test.ts by 5 entries.

   Refs ADR-0001 publicHandler rollout. First sub-wave of Wave H. Subsequent
   sub-waves cover auth/* (H2), Einstein (H3), framework-managed handlers
   (H4: NextAuth + Inngest), and webhooks/payfast (H5).

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

3. Push: `git push -u origin wave/173-public-handler-h1`

4. Open PR with `gh pr create --title "feat(public-handler): migrate 5 low-risk routes onto publicHandler (Wave H1, ADR-0001 8/8 part 1)" --body "<HEREDOC>"`. PR body should include:
   - Summary (3 bullets: scope, blast radius, ADR pointer).
   - 5-route checklist with line counts.
   - 8-gate green confirmation.
   - "Wire-shape verified verbatim" note.
   - "First publicHandler sub-wave; H2-H5 to follow" forward-pointer.

---

## Hand-off report (when done)

Report back to the dispatching session with:

- PR URL.
- SHA of the merge-target commit.
- Vitest pass count (must be 2840).
- Lint warning count (must be 138).
- Confirmation that all 6 (or 7) files are staged + nothing else.
- Confirmation that route-handler-coverage test passes with 5 EXEMPT entries removed.
- Any deviation from this spec, with reason.

The dispatching session will close the PR (poll gates → soak → promote → require → squash-merge → cleanup) per the established post-G1 closure pattern.
