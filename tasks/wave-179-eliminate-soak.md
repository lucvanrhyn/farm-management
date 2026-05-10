# Wave 179 — Eliminate the soak gate

**Date:** 2026-05-10
**Branch:** `wave/179-eliminate-soak`
**Predecessor:** Wave 178 (conditional soak — 30-min floor on escalated paths only).
**Outcome:** soak gate is now a true no-op for every PR by default. Bookkeeping retained for one-line revertability.

---

## Audit findings (the "why")

Across the last ~60 merges before Wave 179:

- **0 bugs caught by the soak window.** The soak gate has never converted "would have shipped a bug" into "soaked it out." Every regression observed in the same period was caught by a synchronous backstop or by post-promote smoke — never by the temporal soak.
- **~26h wasted across the last 30 PRs.** Wave-178's conditional logic shaved most pure-transport PRs to 0 min, but the audit covered enough pre-#178 history (blanket 1h) to expose the underlying truth: the soak window protects against nothing.
- **The protective surface area is fully covered synchronously at promote time** by:
  - `verifyMigrationApplied` (#141) — re-probes the live tenant DB after every batch.
  - `checkPrismaColumnParity` (#137) — Prisma ↔ DB column-set parity audit.
  - `audit-findmany-no-select` (#140) — projection-drift detector.
  - `_defaultVerifyAllTenantsParity` (#142) — cross-tenant `_migrations` reconciliation.
  - Post-promote authenticated 8-route smoke + auto-rollback on 500 / error boundary.

The temporal soak window adds nothing real: it sleeps a CI runner, not real traffic. Real traffic only starts hitting the new code AFTER promote completes — by which point the synchronous backstops have already either passed or rolled back.

## Allow-list (5 files)

1. `lib/ops/branch-clone.ts` — change `minSoakHours = 0.5` → `minSoakHours = 0` and update the comment block above the soak gate.
2. `.github/workflows/post-merge-promote.yml` — remove the `Detect ESCALATED path touches` step and the `--escalated-paths-touched=` arg from the promote step.
3. `__tests__/ops/branch-clone.promote.escalated.test.ts` — add new "default policy" tests; restructure the existing `#178` describe block under a "legacy revert path" describe block (these tests pass an explicit `minSoakHours: 0.5` so they continue to exercise the escalated-only behaviour for the revert target).
4. `CLAUDE.md` — replace §promote-delegation rule 3 to reflect the new no-soak policy.
5. `tasks/wave-179-eliminate-soak.md` — this document.

## Reversibility

One line in `lib/ops/branch-clone.ts`:

| Policy | `minSoakHours` default |
|---|---|
| Wave 179 (current) — soak disabled | `0` |
| Wave 178 — escalated-only 30 min | `0.5` |
| Pre-#178 — blanket 1h | `1` |

All bookkeeping is preserved:

- `branch_db_clones.soak_started_at` column.
- `recordCiPassForCommit()` still writes the timestamp on CI green.
- `escalatedPathsTouched` parameter on `PromoteToProdInput` still exists; the `isEscalated` branch still runs (it just always passes the elapsed-hours check because `elapsedHours >= 0` and the threshold is `0`).
- `headSha` SHA-mismatch check still throws `SoakNotMetError(shaMismatch=true)` — the issue #101 protection is independent of `minSoakHours`.

To revert, restore the default and re-add the `Detect ESCALATED path touches` step in the workflow.

## Workflow bug fix bonus

The `Detect ESCALATED path touches` step previously used `github.event.pull_request.base.sha`, which is captured at PR open time. When intermediate PRs merge between PR open and PR merge, `base.sha` becomes stale and the diff scope can include unrelated upstream changes — leading to false-positive escalations.

By removing the entire step, this bug becomes moot. (Previously tracked in MEMORY.md under "conditional-soak follow-up".)

## Verification

Required gates before commit:

1. `pnpm tsc --noEmit` — type-check clean.
2. `pnpm vitest run __tests__/ops/branch-clone.promote` — all soak/escalated tests green.
3. `pnpm lint` — clean.
4. `pnpm build` — full webpack build clean.

## Self-validation

Wave 179 will be the first PR to ship under the 0-min default. If the gate still produced value, this PR's own merge would expose it — there is no fallback to a non-zero floor. The bookkeeping infrastructure means a single-line revert restores the prior policy on the very next PR.
