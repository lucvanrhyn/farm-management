# Wave 4 A5 — Prisma auth-retry on the main path

**Codex finding (HIGH, 2026-05-02):** `getFarmContext` returns a bare PrismaClient. The `withFarmPrisma` retry boundary (catches Turso 401 / token-expiry, evicts cached client + creds, retries once against a fresh client) covers only ~5% of routes. Most routes that consume `ctx.prisma.<model>.<op>(...)` directly will 500 the first time the cached Turso token expires, until the next cold-start rebuilds the cache.

## Decision: Option A (Proxy wrapper)

- Lowest-disruption: no route file changes, no caller-facing API change.
- `getFarmContext().prisma` returns a Proxy whose model accessors and top-level `$transaction` / raw-SQL methods delegate to the cached client and catch `isTokenExpiredError` once. On retry, `evictFarmClient(slug)` + `evictFarmCreds(slug)` + a fresh `createFarmClient(slug)` rebuild the connection — same eviction sequence as `withFarmPrisma`.
- The bare `getPrismaForFarm` accessor is unchanged. Callers that already use `withFarmPrisma` continue to retry (the bare client they receive is not double-wrapped). Callers that still use the legacy `getPrismaWithAuth` / `getPrismaForSlugWithAuth` shape are addressed by routing them through `getFarmContext` in a separate wave — this PR keeps surface minimal.

## Checklist

- [x] Read `lib/server/farm-context.ts` + `lib/farm-prisma.ts`; map the existing retry path.
- [x] Confirm callers consume `ctx.prisma.<model>.<op>(...)` shape (sampled `/api/observations/route.ts` etc.).
- [x] Write failing test `__tests__/server/farm-context-retry.test.ts` covering:
  - (a) successful query → no retry, fresh-client constructor invoked once.
  - (b) first call throws token-expired → second call against a fresh client succeeds.
  - (c) second call also throws auth → propagated to caller.
  - (d) non-auth error → not retried.
  - (e) retry path also covers `$transaction`, `$queryRawUnsafe`, `$executeRawUnsafe` (used by Einstein retriever, NVD, onboarding commit, sheep/game analytics).
- [x] Implement `wrapPrismaWithRetry` in `lib/farm-prisma.ts` (single source of truth for the retry primitive — `withFarmPrisma` is refactored to delegate so we don't drift).
- [x] Update `lib/server/farm-context.ts` to wrap the resolved prisma client.
- [x] Verify no test that exercises `withFarmPrisma` or `getPrismaForFarm` broke.
- [x] `pnpm lint && pnpm tsc && pnpm vitest run __tests__/server/farm-context-retry.test.ts && pnpm build`.
- [x] Conventional commit + PR + Codex citation.

## Verification commands

```
pnpm vitest run __tests__/server/farm-context-retry.test.ts
pnpm vitest run __tests__/lib/farm-prisma-retry.test.ts   # regression: existing retry path unchanged
pnpm vitest run __tests__/server/farm-context-slug.test.ts # regression: slug helper unchanged
pnpm lint
pnpm tsc
pnpm build  # webpack required (Turbopack breaks Serwist)
```

## Notes

- `feedback-vercel-cached-prisma-client.md`: the wrapper MUST evict the cached PrismaClient (call `evictFarmClient(slug)`), not just rebuild a new one beside it — otherwise stale-instance 401s persist for the lifetime of the Lambda. Confirmed by test (e).
- `feedback-vi-hoisted-shared-mocks.md`: shared `prismaCtor` / `getFarmCredsMock` state in the new test wraps in `vi.hoisted()` (mirroring `farm-prisma-retry.test.ts`).
- No eager `SELECT 1` probe — see comment in `lib/farm-prisma.ts` explaining why the previous probe was removed.
