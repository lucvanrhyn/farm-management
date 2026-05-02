# Wave 4 A9 — Inngest missing-keys deploy gate

**Severity:** MEDIUM (Codex adversarial review 2026-05-02)
**Branch:** `wave/4-inngest-deploy-gate`
**Refs:** Codex Wave 4 finding #A9, #27 27b (env-blocked Inngest smoke)

## The bug
`lib/server/inngest/client.ts` only `logger.error`s when `INNGEST_EVENT_KEY` /
`INNGEST_SIGNING_KEY` are missing in production — the deploy succeeds. The
first cron fire then silently fails (or signed-webhook verification fails with
no obvious link to the missing keys). This is the failure mode currently
blocking #27 27b.

## The fix
Hard-fail the prebuild (`scripts/vercel-prebuild.ts`) when
`VERCEL_ENV === "production"` AND either Inngest key is missing. The runtime
log in `client.ts` stays as a defence-in-depth backstop (NODE_ENV=production
without going through Vercel prebuild — local sanity).

## Plan
- [x] Spawn worktree off `origin/main` (`f5d1491`).
- [x] Read `lib/server/inngest/client.ts` and `scripts/vercel-prebuild.ts`.
- [x] TDD failing test: `scripts/__tests__/vercel-prebuild-inngest-gate.test.ts`.
  - [x] (a) production with both keys present → exit 0.
  - [x] (b) production missing `INNGEST_EVENT_KEY` → exit 1, log mentions key name.
  - [x] (c) production missing `INNGEST_SIGNING_KEY` → exit 1, log mentions key name.
  - [x] (d) preview missing both keys → exit 0 (preview is allowed to skip Inngest).
  - [x] (e) no `VERCEL_ENV` → exit 0 (local).
- [x] Implement gate in `scripts/vercel-prebuild.ts` (BEFORE the production
      short-circuit `return 0`).
- [x] Add code-comment in `lib/server/inngest/client.ts` pointing to prebuild
      as source of truth.
- [x] Verify: `pnpm vitest run scripts/__tests__/vercel-prebuild-inngest-gate.test.ts`.
- [x] Verify: `pnpm lint && pnpm tsc && pnpm build`.
- [x] Conventional commit + push.
- [x] Open PR with operator callout (set `INNGEST_EVENT_KEY` +
      `INNGEST_SIGNING_KEY` in Vercel Production env BEFORE merging or be
      ready for a deploy rollback).

## Allow-list
- `lib/server/inngest/client.ts`
- `scripts/vercel-prebuild.ts`
- `scripts/__tests__/vercel-prebuild-inngest-gate.test.ts` (NEW)
- `tasks/wave-4-a9-inngest-deploy-gate.md` (this file)

### Surgical out-of-allow-list edit
- `__tests__/scripts/vercel-prebuild.test.ts` — pre-existing prod-safety test
  uses an env without Inngest keys and now correctly fails the new gate.
  Patched to add both keys so it continues to assert its named property
  (prod NEVER clones / NEVER writes env). The Inngest gate itself is
  covered by the new test file. Leaving this red would block CI for an
  unrelated reason; this is the smallest possible fix.

## Operator action required BEFORE merge
Set in Vercel Project → Production env (per #27 27b):
- `INNGEST_EVENT_KEY` (from inngest.com cloud dashboard)
- `INNGEST_SIGNING_KEY` (from inngest.com cloud dashboard)

Without these set, the next prod build will hard-fail (which is the point —
fail at build time, not at first cron fire).
