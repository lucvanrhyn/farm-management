# Wave H4 — `publicHandler` rollout part 4 of 5 (framework-managed: NextAuth + Inngest)

**Branch:** `wave/176-public-handler-h4`
**Worktree:** `.worktrees/wave/176-public-handler-h4`
**Adapter:** `publicHandler` (no auth, no body parse — only try/catch + `withServerTiming`)
**ADR-0001 progress:** part 4 of 5 in the H sub-wave (8/8 of the overall ADR-0001 rollout)

## Context

Waves H1 (#173) + H2 (#174) + H3 (#175) shipped 11 of the 14 proxy-matcher exclusions onto `publicHandler`. Three remain: NextAuth catch-all, Inngest serve, and PayFast webhook (H5). This wave wraps the two **framework-managed** exclusions:

1. `app/api/auth/[...nextauth]/route.ts` (6 lines) — NextAuth v4 catch-all (security-critical surface)
2. `app/api/inngest/route.ts` (26 lines) — Inngest `serve()` wrapper (cron + function invocation)

Both routes are unusual: their handlers are **produced by a framework helper** (`NextAuth(authOptions)` / `serve({ client, functions })`) rather than written by us. The wrap pattern needs to:

- Preserve the framework's full request/response semantics (cookies, redirects, error pages, OAuth flows for NextAuth; signature verification + cron for Inngest).
- Add `Server-Timing` instrumentation via `withServerTiming` (free win — `publicHandler` already does this).
- Add the typed-error fallback: if the framework handler throws, `publicHandler` catches and returns `routeError("DB_QUERY_FAILED", message, 500)` instead of leaking a stack trace.

The structural invariant from `__tests__/api/route-handler-coverage.test.ts` requires that both files use `export const <METHOD> = publicHandler(...)`. After this wave, the EXEMPT set shrinks by 2 entries.

## Why publicHandler is safe for these handlers

`publicHandler` does NOT add authentication, does NOT touch cookies, and does NOT mutate the Response body. It ONLY:

1. Calls `withServerTiming()` to add a `Server-Timing` response header (additive, never overwrites).
2. Wraps `handle(req, params)` in try/catch and maps thrown errors via `mapApiDomainError` → typed envelope.
3. Awaits `ctx.params` to materialize Next 16 dynamic params.

NextAuth's flow (cookies, redirects, OAuth callbacks, error pages, JSON session) is preserved because the framework handler is invoked verbatim inside `handle`. Same for Inngest's signature verification + cron fallback.

## Allow-list (3 files only)

The agent may **only** edit these files. Any change outside the allow-list is a spec violation.

1. `app/api/auth/[...nextauth]/route.ts` — wrap `NextAuth(authOptions)` handler in `publicHandler` for both `GET` and `POST` exports.
2. `app/api/inngest/route.ts` — wrap `serve()`'s `GET`, `POST`, `PUT` outputs in `publicHandler`.
3. `__tests__/api/route-handler-coverage.test.ts` — shrink EXEMPT by removing the two migrated entries.

If TypeScript or the route-handler-coverage test reveals a sig-update fan-out (the H1/H3 pattern: tests calling exported handlers directly need `CTX = { params: Promise.resolve({}) }`), the agent may extend the allow-list to cover those test files. Document the extension in the commit body. **Do not** edit any non-test source file outside the three above.

## Per-route migration patterns

### Route 1: `app/api/auth/[...nextauth]/route.ts` (6 lines)

**Current:**
```ts
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth-options";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
```

**Migrate to:**
```ts
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { publicHandler } from "@/lib/server/route";

const nextAuthHandler = NextAuth(authOptions);

type NextAuthParams = { nextauth: string[] };

export const GET = publicHandler<NextAuthParams>({
  handle: async (req, params) => {
    return nextAuthHandler(req, { params: Promise.resolve(params) });
  },
});

export const POST = publicHandler<NextAuthParams>({
  handle: async (req, params) => {
    return nextAuthHandler(req, { params: Promise.resolve(params) });
  },
});
```

Notes:
- `params` is the resolved params object (publicHandler awaits `ctx.params` for you). NextAuth expects `{ params: Promise<{ nextauth: string[] }> }`, so we re-wrap with `Promise.resolve(params)`.
- `nextauth: string[]` is NextAuth v4's catch-all params shape — verify by reading `node_modules/next-auth/next/index.d.ts` if needed.
- If TypeScript balks at the NextAuth handler signature, add a single `// @ts-expect-error -- NextAuth v4 handler signature` line and document why in the commit body. Do NOT cast to `any` or refactor `lib/auth-options.ts`.

### Route 2: `app/api/inngest/route.ts` (26 lines)

**Current:**
```ts
import { serve } from "inngest/next";
import { inngest } from "@/lib/server/inngest/client";
import { ALL_FUNCTIONS } from "@/lib/server/inngest/functions";
import { ALL_TASK_FUNCTIONS } from "@/lib/server/inngest/tasks";
import { ALL_EINSTEIN_FUNCTIONS } from "@/lib/server/inngest/einstein";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    ...ALL_FUNCTIONS,
    ...ALL_TASK_FUNCTIONS,
    ...ALL_EINSTEIN_FUNCTIONS,
  ],
});
```

**Migrate to:**
```ts
import { serve } from "inngest/next";
import { inngest } from "@/lib/server/inngest/client";
import { ALL_FUNCTIONS } from "@/lib/server/inngest/functions";
import { ALL_TASK_FUNCTIONS } from "@/lib/server/inngest/tasks";
import { ALL_EINSTEIN_FUNCTIONS } from "@/lib/server/inngest/einstein";
import { publicHandler } from "@/lib/server/route";

const inngestHandlers = serve({
  client: inngest,
  functions: [
    ...ALL_FUNCTIONS,
    ...ALL_TASK_FUNCTIONS,
    ...ALL_EINSTEIN_FUNCTIONS,
  ],
});

export const GET = publicHandler({
  handle: async (req) => inngestHandlers.GET(req),
});

export const POST = publicHandler({
  handle: async (req) => inngestHandlers.POST(req),
});

export const PUT = publicHandler({
  handle: async (req) => inngestHandlers.PUT(req),
});
```

Notes:
- The cron-fallback comment in the file header MUST be preserved verbatim (or replaced with an equivalent explanation pointing to the publicHandler wrap).
- `inngestHandlers.GET/POST/PUT` are bound functions; passing them through `(req) => inngestHandlers.GET(req)` rather than `inngestHandlers.GET` directly is intentional — it isolates them inside our publicHandler closure and makes the call site explicit for code review.
- Inngest's `serve()` already returns a `Promise<Response>` from each method, so the inner `async (req) => ...` is the correct shape.

### Route 3: `__tests__/api/route-handler-coverage.test.ts`

Remove these two entries from EXEMPT:
```ts
"auth/[...nextauth]/route.ts",
"inngest/route.ts",
```

Update the comment block above the EXEMPT set to reflect H4's progress (H1 + H2 + H3 + H4 — only `webhooks/payfast/route.ts` remains for H5).

## Verification gates (run in this exact order)

1. **Pre-flight grep** — confirm no other code imports the old route handlers in unexpected ways:
   ```bash
   rg "from ['\"]@/app/api/auth/\[\\.\\.\\.nextauth\\]/route['\"]" --type ts
   rg "from ['\"]@/app/api/inngest/route['\"]" --type ts
   ```
   Expected: zero hits (route handlers are not directly imported anywhere — they are framework-mounted).

2. **TypeScript** — clear cache, regenerate Prisma, type-check:
   ```bash
   rm -rf .next/cache/tsbuildinfo .tsbuildinfo
   pnpm prisma generate
   pnpm tsc --noEmit
   ```
   Must complete with zero errors. If NextAuth's signature requires `// @ts-expect-error`, add exactly one such directive at the call site with a comment.

3. **Vitest target** — run the architectural invariant + any auth/inngest unit tests:
   ```bash
   pnpm vitest run __tests__/api/route-handler-coverage.test.ts
   pnpm vitest run __tests__/auth
   pnpm vitest run __tests__/server/inngest
   ```
   All three must be green. The route-handler-coverage test is the structural gate — it MUST go green after EXEMPT shrinks.

4. **Vitest full** (smoke run only — first 200 tests OK if full suite is too slow):
   ```bash
   pnpm vitest run --no-coverage 2>&1 | tail -50
   ```
   No new failures introduced. Pre-existing failures (if any are noted in main) are not blockers.

5. **Build** — webpack only (Turbopack breaks Serwist):
   ```bash
   pnpm build --webpack 2>&1 | tail -30
   ```
   Must complete. Compilation warnings are acceptable; errors are not.

6. **Audit FindMany no-take check** (governance gate):
   ```bash
   pnpm tsx scripts/audit-findmany-no-take.ts
   ```
   Must pass.

If any gate fails, stop and report. Do NOT push a partial wrap.

## Anti-patterns (do NOT do)

1. **Do not** add authentication inside the `handle` for either route. NextAuth manages its own auth; Inngest verifies its own signature. `publicHandler` is intentionally auth-free.
2. **Do not** modify `lib/auth-options.ts`, `lib/server/inngest/**`, or any file under `lib/payfast/**`. Allow-list is enforced.
3. **Do not** strip or rewrite the cron-fallback comment in `inngest/route.ts` — Vercel Cron's "even if Inngest cloud goes down" safety net is documented there for a reason.
4. **Do not** use `any` casts. If TS balks on NextAuth signature, use one `// @ts-expect-error` line with a comment.
5. **Do not** change export names. NextAuth catch-all expects `GET` and `POST`; Inngest expects `GET`, `POST`, `PUT`.
6. **Do not** apply the `promote` label. NextAuth surface is security-critical (`app/api/auth/**`) and requires Luc per-diff approval per CLAUDE.md §promote-delegation rule 5.
7. **Do not** delete the existing module-level `serve({...})` call result before binding the publicHandler exports. The handler instance must be created once and shared across GET/POST/PUT.
8. **Do not** rebase onto a newer main while the agent is running unless explicitly told to. `origin/main` at SHA `61f9f74` is the dispatch base.

## PR + branch hygiene

After all gates pass:

1. `git add` only the files in the allow-list (plus any sig-update test files documented in commit body).
2. Commit message:
   ```
   feat(public-handler): migrate framework-managed routes onto publicHandler (Wave H4, ADR-0001 8/8 part 4)

   Wraps NextAuth catch-all + Inngest serve in publicHandler. The framework
   handlers retain their full request/response semantics (NextAuth: cookies,
   redirects, OAuth, error pages; Inngest: signature verification, cron
   fallback). publicHandler adds Server-Timing instrumentation and the
   typed-error fallback if the framework handler throws.

   - app/api/auth/[...nextauth]/route.ts: GET + POST wrap
   - app/api/inngest/route.ts: GET + POST + PUT wrap
   - EXEMPT set in route-handler-coverage shrunk by 2

   Closes ADR-0001 8/8 part 4. Only webhooks/payfast remains (H5).
   ```
3. `git push -u origin wave/176-public-handler-h4`
4. `gh pr create --base main --head wave/176-public-handler-h4 --title "feat(public-handler): migrate framework-managed routes onto publicHandler (Wave H4, ADR-0001 8/8 part 4)"` with a body that:
   - Lists the 2 routes wrapped + the EXEMPT shrink
   - Notes the security-critical surface (`app/api/auth/**`) requires Luc per-diff approval
   - States explicitly: "Agent did NOT apply promote label — awaiting Luc per-diff approval per §promote-delegation rule 5"
   - Lists which gates passed (TS / Vitest / build / audit)

5. **Stop after PR is open.** Do NOT poll, do NOT apply promote, do NOT request review. Report PR URL + SHA + which gates went green back to the dispatcher.

## Out of scope (explicit non-goals)

- PayFast webhook (`app/api/webhooks/payfast/route.ts`) — H5 (separate dispatch).
- Conditional-soak infrastructure — separate wave after H5.
- Any non-publicHandler refactor — out of scope.
- Rewriting `lib/auth-options.ts` or any NextAuth provider config — explicitly forbidden.
- Touching `lib/server/inngest/**` — explicitly forbidden.

## Success criteria

- 2 routes wrapped, EXEMPT shrunk by 2.
- All 6 verification gates green.
- PR open, body documents the security-critical hold.
- Agent stops cleanly after PR creation.
- No edits outside allow-list (modulo documented sig-update fan-out).
