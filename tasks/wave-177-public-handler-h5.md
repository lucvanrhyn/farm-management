# Wave H5 — `publicHandler` rollout part 5 of 5 (PayFast ITN webhook — FINAL)

**Branch:** `wave/177-public-handler-h5`
**Worktree:** `.worktrees/wave/177-public-handler-h5`
**Adapter:** `publicHandler` (no auth, no body parse — only try/catch + `withServerTiming`)
**ADR-0001 progress:** part 5 of 5 in the H sub-wave — **CLOSES the entire ADR-0001 rollout (8/8)**

## Context

This is the final wave of ADR-0001. After H1 (#173, 5 routes), H2 (#174, 4 auth routes), H3 (#175, 2 einstein routes), and H4 (NextAuth catch-all + Inngest), only ONE proxy-matcher exclusion remains:

- `app/api/webhooks/payfast/route.ts` (387 lines) — PayFast ITN (Instant Transaction Notification) webhook

This route is **security-critical**. PayFast posts subscription events here; the handler enforces a 7-step pipeline:

1. Source IP allowlist (`isValidPayFastIP`)
2. Signature verification (`generateSignature` constant-time compare)
3. Server-to-server ITN validation (`validateITN` round-trip to PayFast)
4. Token check against the farm's currently-stored `payfast_token` (timing-safe equality)
5. Order check (`eventTime` newer than newest already-processed event)
6. Idempotency via `PayfastEvent.pfPaymentId` unique constraint with `appliedAt` semantics
7. Status-upgrade ladder (PENDING < FAILED/CANCELLED < COMPLETE)

Issue #95's fix (Insert-before-mutate + PENDING-blocks-COMPLETE bugs) lives entirely inside this handler. Wave 4 A11's HIGH-severity fixes (token mask + dedup + ordering) live here too. **This wave must NOT touch any of that logic.** This wave ONLY changes how the handler's POST is exported — the entire body moves into `handle: async (req) => { ... }` without modification.

The structural invariant from `__tests__/api/route-handler-coverage.test.ts` will be SATISFIED for the last time after this wave: ZERO entries remain in EXEMPT under the proxy-matcher exclusion comment block. The only EXEMPT routes left will be the platform-admin / cross-farm group and the not-yet-migrated `[farmSlug]/**` shared routes (those are tracked separately).

## Why publicHandler is safe for the PayFast webhook

`publicHandler` adds NO authentication and does NOT touch the Response body. It ONLY:

1. Calls `withServerTiming()` to add a `Server-Timing` response header (PayFast ignores response headers).
2. Wraps `handle(req, params)` in try/catch and maps thrown errors via `mapApiDomainError` → typed envelope.
3. Awaits `ctx.params` (no params on this route — empty object).

The 7-step pipeline runs unchanged inside `handle`. The handler's behavior on signature mismatch / IP mismatch / token mismatch / dedup hit / status upgrade is preserved exactly. The 200-with-empty-body response that PayFast expects is preserved.

**Subtle invariant:** The handler currently catches its own internal errors (e.g. `try { body = await req.text() } catch { return ... 400 }`) and returns explicit 400/403 responses. publicHandler's try/catch is a SAFETY NET for unexpected throws, not a replacement for the existing error handling. All existing error returns must be preserved verbatim — they are explicit, deliberate, and tested.

## Allow-list (2 files only)

The agent may **only** edit these files. Any change outside the allow-list is a spec violation.

1. `app/api/webhooks/payfast/route.ts` — wrap the existing POST handler in `publicHandler`.
2. `__tests__/api/route-handler-coverage.test.ts` — shrink EXEMPT by removing `webhooks/payfast/route.ts`.

If TypeScript or the route-handler-coverage test reveals a sig-update fan-out (the H1/H3 pattern: tests calling `POST(req)` directly need `CTX = { params: Promise.resolve({}) }`), the agent may extend the allow-list to cover those test files. Document the extension in the commit body. **Do not** edit any other source file.

## Migration pattern

### Route 1: `app/api/webhooks/payfast/route.ts`

The current export at line 103:
```ts
export async function POST(req: NextRequest) {
  // 1. Source IP allowlist.
  const ip = ...
  // ... 280 more lines ...
}
```

Migrate to:
```ts
export const POST = publicHandler({
  handle: async (req): Promise<Response> => {
    // 1. Source IP allowlist.
    const ip = ...
    // ... 280 more lines ...
  },
});
```

Steps:

1. Add `import { publicHandler } from "@/lib/server/route";` to the imports block at the top of the file (alphabetically — after `@/lib/payfast`).
2. Convert the `export async function POST(req: NextRequest) { ... }` declaration to `export const POST = publicHandler({ handle: async (req): Promise<Response> => { ... } });`.
3. Preserve **every line** of the body verbatim. The 7-step pipeline, the dedup logic, the status-upgrade ladder, the `withFarmPrisma` callback, every `logger.info/warn/error` call, every `NextResponse.json/new NextResponse(null, { status: 200 })` — all unchanged.
4. The `handle` annotation `(req): Promise<Response>` is required because publicHandler's `PublicHandle` type strictly requires `Promise<Response>` (sync triggers TS2322).
5. Do NOT remove the `NextRequest` import — `req` is still typed via the publicHandler signature, but the file may reference `NextRequest` indirectly. If TS reports it as unused, then remove it; otherwise leave it.
6. The `NextResponse` import stays — the body still uses it.

**Critical invariants that must NOT change:**

- IP allowlist check returns `403` exactly (NOT `401`).
- Signature mismatch returns `400` exactly.
- Missing `pf_payment_id` returns `400` exactly.
- Token mismatch returns `200` with empty body (PayFast retry quench — DO NOT change).
- Older event time returns `200` with empty body (FIFO degrade).
- All `logger.warn/error/info` calls — every field, every key, every mask.
- `maskToken`, `tokensMatch`, `hashPayload`, `parseEventTime`, `isStatusUpgrade`, `STATUS_RANK` — all helper functions stay at module scope unchanged.
- The 387-line file ends at byte ~Y bytes — line count after wrap should be 387 ± 5 lines.

### Route 2: `__tests__/api/route-handler-coverage.test.ts`

Remove this entry from EXEMPT:
```ts
"webhooks/payfast/route.ts",
```

Update the comment block above the EXEMPT set to reflect H5 closing the proxy-matcher group: only platform-admin / cross-farm + shared routes (Wave B+) remain.

## Verification gates (run in this exact order)

1. **Pre-flight grep** — confirm no other code calls the `POST` export directly:
   ```bash
   rg "from ['\"]@/app/api/webhooks/payfast/route['\"]" --type ts
   rg "POST.*payfast.*route" --type ts -g '!app/api/webhooks/payfast/route.ts'
   ```
   Expected: zero hits beyond test references. If a unit test imports POST directly, add it to the allow-list and apply the H1/H3 sig-update pattern.

2. **TypeScript** — clear cache, regenerate Prisma, type-check:
   ```bash
   rm -rf .next/cache/tsbuildinfo .tsbuildinfo
   pnpm prisma generate
   pnpm tsc --noEmit
   ```
   Must complete with zero errors.

3. **Vitest target** — run the architectural invariant + payfast unit/integration tests:
   ```bash
   pnpm vitest run __tests__/api/route-handler-coverage.test.ts
   pnpm vitest run __tests__/api/payfast
   pnpm vitest run __tests__/payfast
   pnpm vitest run __tests__/lib/payfast
   ```
   The route-handler-coverage test MUST be green (EXEMPT shrink). Any failing payfast test from changes to the wrap is a regression — STOP and report.

4. **Vitest full** (smoke run — first 200 OK if too slow):
   ```bash
   pnpm vitest run --no-coverage 2>&1 | tail -50
   ```
   No new failures.

5. **Build** — webpack only:
   ```bash
   pnpm build --webpack 2>&1 | tail -30
   ```
   Must complete with no errors.

6. **Audit FindMany no-take** (governance gate):
   ```bash
   pnpm tsx scripts/audit-findmany-no-take.ts
   ```
   Must pass.

7. **Diff size sanity** — confirm the diff is mechanical:
   ```bash
   git diff origin/main -- app/api/webhooks/payfast/route.ts | wc -l
   ```
   Expected: ~6-10 added lines (publicHandler import + outer wrap), ~1-3 removed lines (function declaration). If the diff is 50+ lines, something else changed — re-audit.

If any gate fails, stop and report. Do NOT push a partial wrap.

## Anti-patterns (do NOT do)

1. **Do not** modify the 7-step pipeline. Every IP check, signature compare, token compare, dedup row insert, status-upgrade decision, subscription mutation, and `appliedAt` stamp must remain identical.
2. **Do not** modify `lib/payfast/**`, `lib/meta-db.ts`, `lib/farm-prisma.ts`, or `lib/logger.ts`. The wrap is purely transport.
3. **Do not** change response shapes (`NextResponse.json` vs `new NextResponse(null, { status: 200 })`). PayFast's retry queue is sensitive to these — the handler is intentionally explicit.
4. **Do not** rewrite or "improve" any of the comment blocks at the top of the file — they document the rationale for #95 + Wave 4 A11 fixes and are referenced by `wave-history-log.md`.
5. **Do not** convert `withFarmPrisma` to `getFarmPrisma`. The callback shape is required for the rollback semantics this handler relies on.
6. **Do not** apply the `promote` label. PayFast webhook is security-critical surface (`app/api/webhooks/**` + `lib/payfast/**`) and requires Luc per-diff approval per CLAUDE.md §promote-delegation rule 5.
7. **Do not** rebase onto a newer main while the agent is running. `origin/main` at SHA `61f9f74` is the dispatch base.
8. **Do not** add new logging or new error codes. The existing logger calls + return shapes are tested verbatim by `__tests__/api/payfast/**`.

## PR + branch hygiene

After all gates pass:

1. `git add` only the files in the allow-list (plus any sig-update test files documented in commit body).
2. Commit message:
   ```
   feat(public-handler): migrate webhooks/payfast onto publicHandler (Wave H5, ADR-0001 8/8 part 5 — FINAL)

   Wraps the PayFast ITN webhook POST in publicHandler. The 7-step pipeline
   (IP allowlist → signature → ITN validate → token → order → dedup → status
   ladder) runs unchanged inside `handle`. publicHandler adds Server-Timing
   and the typed-error fallback if anything throws.

   - app/api/webhooks/payfast/route.ts: POST wrap (387 lines body unchanged)
   - EXEMPT set in route-handler-coverage shrunk by 1

   This closes the proxy-matcher group of EXEMPT routes. The remaining EXEMPT
   entries are platform-admin / cross-farm + the not-yet-migrated `[farmSlug]/**`
   shared routes — both tracked separately.

   ADR-0001 8/8 — fully closed.
   ```
3. `git push -u origin wave/177-public-handler-h5`
4. `gh pr create --base main --head wave/177-public-handler-h5 --title "feat(public-handler): migrate webhooks/payfast onto publicHandler (Wave H5, ADR-0001 8/8 part 5 — FINAL)"` with a body that:
   - Notes this is the FINAL wave of ADR-0001
   - Lists the route wrapped + the EXEMPT shrink
   - Notes the security-critical surface (`app/api/webhooks/**`, `lib/payfast/**`) requires Luc per-diff approval
   - States explicitly: "Agent did NOT apply promote label — awaiting Luc per-diff approval per §promote-delegation rule 5"
   - Lists which gates passed (TS / Vitest / build / audit / diff-size sanity)
   - Quotes the diff-size: "publicHandler wrap added X lines, removed Y lines, body verbatim"

5. **Stop after PR is open.** Do NOT poll, do NOT apply promote, do NOT request review. Report PR URL + SHA + which gates went green back to the dispatcher.

## Out of scope (explicit non-goals)

- Any change to PayFast signature/ITN/dedup/status-upgrade logic.
- Any change to `lib/payfast/**` helpers.
- Any change to `lib/meta-db.ts` (`getFarmSubscription`, `updateFarmSubscription`).
- Any change to `prisma/schema.prisma` or migrations.
- Any change to PayFast smoke tests (`__tests__/api/payfast/**`).
- Any "improvement" to comment blocks.
- Conditional-soak infrastructure (separate wave).

## Success criteria

- 1 route wrapped, EXEMPT shrunk by 1.
- All 7 verification gates green.
- Diff size ≤ 15 lines net change.
- PR open, body documents the security-critical hold.
- Agent stops cleanly after PR creation.
- No edits outside allow-list (modulo documented sig-update fan-out).
- ADR-0001 8/8 fully closed pending Luc's promote approval.
