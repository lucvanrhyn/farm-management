# Wave 308 — Restore notification cache-invalidation on the live path + delete dead generator

Closes #308. Bugfix + dead-code removal. **No ADR** — ADR-0001 already governs
the Inngest 3-step layering; the correct seam already exists. This wave does
not add architecture; it restores a lost side-effect and removes a divergent
dead twin.

## Root cause (verified 2026-05-17)

The Phase-4 perf contract — bust the cached `/api/notifications` feed after the
cron writes notification rows, so `NotificationBell` surfaces fresh alerts
before the feed-cache TTL — lives **only** in the dead Phase-J module
`lib/server/notification-generator.ts:80` (`revalidateNotificationWrite(farmSlug)`).

The live path is the Inngest tenant pipeline in
`lib/server/inngest/functions.ts`: Step 1 `evaluateAllAlerts` → Step 2
`persistNotifications` → Step 3 `dispatchChannels`. It **never** calls
`revalidateNotificationWrite`. When the engine migrated off the single-function
Phase-J path, the cron-write cache-bust was silently dropped. Production effect:
cron-written alerts do not invalidate the cached feed; the bell lags by the TTL.

`generateNotifications` has **zero production callers** (grep, whole tree). The
only thing keeping `notification-generator.ts` alive is
`__tests__/notification-generator-revalidate.test.ts`, which therefore guards a
contract that exists only in dead code.

## Interface contract (what must be true after this wave)

- After the Inngest persist step writes ≥1 row for a tenant, the farm-scoped
  notifications cache tag (`farmTag(slug, "notifications")` via
  `revalidateNotificationWrite(slug)`) is invalidated **exactly once** for that
  tenant cycle.
- When `persistNotifications` returns 0 rows (no alerts, or every candidate
  deduped), the tag is **NOT** invalidated (no needless cache bust per cron tick
  — this is the exact rule the dead module enforced via `toCreate.length > 0`;
  `persistNotifications` only returns rows it created/updated this cycle, so
  `rows.length > 0` is the faithful equivalent).
- `lib/server/notification-generator.ts` no longer exists; nothing imports it.
- The revalidate decision is the **orchestrator's** (Inngest function), not
  injected into `persistNotifications` — `persistNotifications`/`dedup.ts` stay
  free of `next/cache` coupling so the dedup logic remains unit-testable in
  isolation. (Same philosophy as ADR-0005: core pure, side-effect at caller.)

## TDD sequence (red → green → refactor)

1. **RED** — new test under `lib/server/inngest/__tests__/` (follow the
   existing inngest test mocking convention in that dir): assert the tenant
   function's persist step calls `revalidateNotificationWrite(slug)` (i.e.
   `revalidateTag` fires with `farmTag(slug,"notifications")`) when
   `persistNotifications` resolves ≥1 row, and does NOT when it resolves `[]`.
   This fails today (live path never revalidates).
2. **GREEN** — in `lib/server/inngest/functions.ts` Step 2, immediately after
   `const rows = await persistNotifications(prisma, hydrated)` and before
   returning the serialized rows, add: if `rows.length > 0` call
   `revalidateNotificationWrite(slug)` (import from `@/lib/server/revalidate`).
   Confirm the exact local variable names (`rows`, `slug`) in that file.
3. **REFACTOR / cleanup** —
   - Delete `lib/server/notification-generator.ts`.
   - Delete `lib/server/__tests__/notification-generator-revalidate.test.ts`
     (it tests the dead module; its *intent* — "revalidate only when rows
     written" — is now carried by the step-1 test against the live path).
   - Fix the stale comment reference in `lib/server/species-scoped-prisma.ts`
     (~line 118) that points at `lib/notification-generator.ts`.
4. **Verify** — `npx tsc --noEmit` (after `rm -rf .next/cache/tsbuildinfo
   .tsbuildinfo`), `pnpm vitest run` for the new test + the existing
   `lib/server/__tests__/revalidate-notifications.test.ts` (must stay green —
   it unit-tests `revalidateNotificationWrite` itself and is unrelated to the
   dead module), `pnpm build --webpack`.

## File allow-list (scope is structurally bounded)

- `lib/server/inngest/functions.ts` — add the revalidate call (Step 2 only).
- `lib/server/notification-generator.ts` — **delete**.
- `lib/server/__tests__/notification-generator-revalidate.test.ts` — **delete**.
- `lib/server/inngest/__tests__/<new-test>.ts` — **create** (name per dir convention).
- `lib/server/species-scoped-prisma.ts` — stale comment line only.
- `tasks/wave-308-notif-revalidate-fix.md` — this plan.

## Out of scope (do NOT touch)

- `lib/server/alerts/dedup.ts` / `persistNotifications` — stays pure; do NOT
  inject `next/cache` here.
- `lib/server/push-sender.ts`, `lib/server/alerts/dispatch.ts`,
  `lib/server/revalidate.ts`, the `app/api/notifications/**` routes.
- `docs/adr/**` — ADR-0001's historical example reference to the dead module is
  a frozen historical record; do not rewrite accepted ADRs.
- Any `migrations/**` or `prisma/schema.prisma` — zero schema change.

## Promote path

Normal §promote-delegation: documented-issue wave (#308), `wave/*` branch, no
auth/payment/migration surface, not incident/hotfix, no architectural change
(not the arch-PR explicit-signoff exception). Ship through merge when the four
required CI checks (gate, audit-bundle, lhci-cold, audit-pagination) are green.
