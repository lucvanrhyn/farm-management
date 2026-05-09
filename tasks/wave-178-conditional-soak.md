# Wave 178 — Conditional soak gate (eliminate ~99% of soak waits)

**Branch:** `wave/178-conditional-soak`
**Worktree:** `.worktrees/wave/178-conditional-soak`
**Issue:** #178 (will be created via PR)
**Why:** Audit of 60 merges across 30 days proves the 1h blanket soak has caught zero bugs. PRD #128 backstops (`verifyMigrationApplied` #141, `checkPrismaColumnParity` #137, `audit-findmany-no-select` #140) cover all known runtime classes at promote time. Soak is ~13h of pure waste per ADR-0001-style multi-wave cycle. This wave eliminates the wait for 99% of merges and keeps a defense-in-depth 30-min window only for the two files that, if buggy, would invalidate the backstops themselves.

## The new policy

| PR diff touches | Soak | Justification |
|-----------------|------|---------------|
| Nothing in ESCALATED_PATHS | **0 min** | Audit confirms zero historical kills; backstops cover all known classes synchronously at promote time |
| `lib/migrator.ts` | **30 min** | The migration runner itself — if buggy, `verifyMigrationApplied` cannot be trusted. Defense-in-depth window for human inspection. |
| `lib/ops/branch-clone.ts` | **30 min** | The gate logic itself — if buggy, the gate's own enforcement is suspect. Defense-in-depth window. |

NOT escalated:
- `migrations/**` — `verifyMigrationApplied` (#141) catches "batch said success but column missing" at promote time, no temporal observation needed.
- `prisma/schema.prisma` — `tsc --noEmit` build gate catches type drift pre-merge; `checkPrismaColumnParity` audit (#137) catches column drift pre-merge.

Estimated savings: ~52 min per pure-transport PR × ~99% of recent merges = massive cumulative wave-clock reclaimed.

## Allow-list (5 files only)

The agent may **only** edit these files. Any change outside the allow-list is a spec violation.

1. `lib/ops/branch-clone.ts` — add `escalatedPathsTouched?: boolean` to `PromoteToProdInput`; gate effective soak on it.
2. `scripts/branch-clone.ts` — extend the `promote` subcommand to accept `--escalated-paths-touched <bool>` and pass through.
3. `.github/workflows/post-merge-promote.yml` — add a step before `Promote branch to prod` that computes the bool from the merge diff and exports it via env var or CLI flag.
4. `CLAUDE.md` — update §promote-delegation rule 3 to express the conditional policy.
5. `__tests__/ops/branch-clone.promote.escalated.test.ts` — NEW test file covering 3 scenarios.

## Per-file design

### File 1: `lib/ops/branch-clone.ts`

**Change 1 — `PromoteToProdInput` type:** add the new optional field. Default behaviour (undefined) is back-compat: treat as `true` (i.e. enforce soak) so any caller that hasn't been updated keeps the old policy.

```ts
export interface PromoteToProdInput {
  // ... existing fields ...
  /**
   * When `true`, the PR diff touched at least one file in ESCALATED_PATHS
   * (currently: `lib/migrator.ts`, `lib/ops/branch-clone.ts`). Soak gate
   * enforced with `minSoakHours` floor.
   *
   * When `false`, the PR diff touched no ESCALATED_PATHS file. Soak gate
   * SKIPPED — the structural backstops (`verifyMigrationApplied` #141,
   * `checkPrismaColumnParity` #137, `audit-findmany-no-select` #140) cover
   * the migration-replay class synchronously at promote time without need
   * for temporal observation.
   *
   * When `undefined` (back-compat), behave as if `true` — old callers
   * keep the old 1h floor.
   */
  escalatedPathsTouched?: boolean;
}
```

**Change 2 — `ESCALATED_PATHS` constant:** add at module scope above `promoteToProd`.

```ts
/**
 * Paths whose modification triggers the soak gate. Kept narrow on purpose:
 * - `lib/migrator.ts`: the migration runner. If buggy, all migrations affected.
 * - `lib/ops/branch-clone.ts`: the gate logic itself. Bootstrapping concern —
 *   if THIS file is buggy, the soak check itself can't be trusted; soak gives
 *   a window for human inspection before propagation.
 *
 * NOT included (covered by structural backstops at promote time):
 * - `migrations/**` — `verifyMigrationApplied` (#141) catches per-tenant drift
 * - `prisma/schema.prisma` — `tsc` + `checkPrismaColumnParity` (#137) catch drift
 *
 * To re-enable blanket soak: set `effectiveSoakHours = minSoakHours` unconditionally
 * in `promoteToProd`. One-line revert.
 */
export const ESCALATED_PATHS: ReadonlyArray<RegExp> = [
  /^lib\/migrator\.ts$/,
  /^lib\/ops\/branch-clone\.ts$/,
];

/**
 * Helper: given a list of changed file paths (from `git diff --name-only`),
 * determine whether the diff touches the ESCALATED set.
 */
export function diffTouchesEscalated(changedPaths: ReadonlyArray<string>): boolean {
  for (const path of changedPaths) {
    for (const re of ESCALATED_PATHS) {
      if (re.test(path)) return true;
    }
  }
  return false;
}
```

**Change 3 — `promoteToProd` soak gate:** compute `effectiveSoakHours` based on the new field. Default `minSoakHours` floor changes from `1` to `0.5` (30 min) — the new "escalated" tier.

```ts
export async function promoteToProd(
  input: PromoteToProdInput,
): Promise<PromoteToProdResult> {
  const {
    branchName,
    headSha,
    minSoakHours = 0.5,                    // ← was 1
    forceSkipSoak = false,
    escalatedPathsTouched,                 // ← new
    now = () => new Date(),
    runProdMigration = _defaultRunProdMigration,
    verifyAllTenantsParity = _defaultVerifyAllTenantsParity,
    parityVerifyEnabled = true,
  } = input;

  // ... (unchanged: meta-row fetch, BranchCloneNotFoundError) ...

  // 2. Soak gate — conditional per #178.
  //
  // ESCALATED_PATHS rationale: `lib/migrator.ts` and `lib/ops/branch-clone.ts`
  // are the two files where a bug invalidates the backstop probes. Everywhere
  // else, the structural backstops shipped in PRD #128 catch the migration-
  // replay class synchronously — no temporal soak needed.
  //
  // back-compat: when `escalatedPathsTouched` is undefined (caller hasn't
  // been updated), treat as `true` — i.e. enforce soak. This keeps every
  // existing call site at the old policy until it is explicitly updated.
  if (!forceSkipSoak) {
    const isEscalated = escalatedPathsTouched !== false; // undefined -> true
    if (isEscalated) {
      // existing SHA-based / created_at gate logic, gated on minSoakHours
      const nowMs = now().getTime();

      if (headSha !== undefined) {
        if (row.headSha !== headSha) {
          console.warn(
            `[promote] [soak_sha_mismatch] branch=${branchName} stored=${row.headSha ?? 'none'} requested=${headSha}`,
          );
          throw new SoakNotMetError(branchName, 0, minSoakHours, /* shaMismatch */ true);
        }
        const soakStartMs = row.soakStartedAt
          ? new Date(row.soakStartedAt).getTime()
          : new Date(row.createdAt).getTime();
        const elapsedHours = (nowMs - soakStartMs) / (1000 * 60 * 60);
        if (elapsedHours < minSoakHours) {
          throw new SoakNotMetError(branchName, elapsedHours, minSoakHours);
        }
      } else {
        const createdAtMs = new Date(row.createdAt).getTime();
        const elapsedHours = (nowMs - createdAtMs) / (1000 * 60 * 60);
        if (elapsedHours < minSoakHours) {
          throw new SoakNotMetError(branchName, elapsedHours, minSoakHours);
        }
      }
    } else {
      // Pure-transport PR — fast path. Skip soak entirely.
      // Backstops (#137 parity audit, #140 no-select audit, #141 verifyMigrationApplied)
      // run synchronously below in the migration step. No temporal observation needed.
      console.log(
        `[promote] [soak_skipped_pure_transport] branch=${branchName} sha=${headSha ?? 'unknown'}`,
      );
    }
  }

  // 3. Run prod migration — error bubbles up, leaving meta row untouched.
  // ... unchanged ...
}
```

### File 2: `scripts/branch-clone.ts`

Find the `promote` subcommand (likely a parseArgs / yargs handler). Add:

```ts
const escalatedPathsTouched =
  argv['escalated-paths-touched'] === 'true' ? true :
  argv['escalated-paths-touched'] === 'false' ? false :
  undefined;

await promoteToProd({
  branchName,
  headSha,
  // ... existing fields ...
  escalatedPathsTouched,
});
```

The CLI flag accepts `true` / `false` strings (matches GitHub Actions output convention). Anything else (including absent) → `undefined` → back-compat full soak.

### File 3: `.github/workflows/post-merge-promote.yml`

Add a new step before the existing `Promote branch to prod` step:

```yaml
      - name: Detect ESCALATED path touches
        id: escalated
        # Issue #178 conditional-soak gate. Only `lib/migrator.ts` and
        # `lib/ops/branch-clone.ts` trigger the 30-min soak floor —
        # everything else relies on the synchronous backstops from PRD #128
        # (verifyMigrationApplied #141, parity audit #137, no-select #140).
        # Re-enable blanket soak: replace this step with `echo touched=true`.
        run: |
          set -eo pipefail
          BASE_SHA="${{ github.event.pull_request.base.sha }}"
          MERGE_SHA="${{ github.event.pull_request.merge_commit_sha }}"
          # The runner has a shallow clone; fetch the base SHA explicitly.
          git fetch --depth=1 origin "$BASE_SHA" 2>/dev/null || true
          if git diff --name-only "$BASE_SHA" "$MERGE_SHA" | \
             grep -qE '^(lib/migrator\.ts|lib/ops/branch-clone\.ts)$'; then
            echo "touched=true" >> "$GITHUB_OUTPUT"
            echo "ESCALATED paths touched — soak gate enforced (30 min floor)."
          else
            echo "touched=false" >> "$GITHUB_OUTPUT"
            echo "Pure-transport PR — soak gate SKIPPED (backstops cover all classes)."
          fi
```

Then update the `Promote branch to prod` step to pass the flag:

```yaml
      - name: Promote branch to prod
        id: promote
        run: pnpm ops:promote-branch "$BRANCH_NAME" --escalated-paths-touched=${{ steps.escalated.outputs.touched }}
```

### File 4: `CLAUDE.md`

Update §promote-delegation rule 3. Current text (find via grep):

> 3. The `require` workflow has returned **SUCCESS** for the latest commit SHA — `require=SUCCESS` is precisely the soak-gate clearing signal. A `require=IN_PROGRESS` is a wait, not a green light.

Replace with:

> 3. **Conditional soak gate (issue #178).** The promote label may be applied as soon as the four required CI checks (gate, audit-bundle, lhci-cold, audit-pagination) are SUCCESS — UNLESS the PR diff touches `lib/migrator.ts` or `lib/ops/branch-clone.ts`. In that case, wait for ≥30 min after the audit `completedAt` timestamp before applying the label (the soak gate). The `require` workflow only checks for the promote label's presence — it does not enforce soak. The soak floor is also enforced post-merge inside `promoteToProd` as defense-in-depth (throws `SoakNotMetError` and rolls back the meta row if violated).
>
> Pre-#178 history: a blanket 1h soak applied to every PR. The audit (memory: `wave-history-log.md`, conditional-soak rationale section) showed zero bugs caught across 60 merges; the structural backstops shipped during the PRD #128 cycle (`verifyMigrationApplied` #141, `checkPrismaColumnParity` #137, `audit-findmany-no-select` #140) cover the migration-replay class synchronously at promote time. The 30-min floor is retained only for the two files whose buggy version would invalidate the backstops themselves.

### File 5: `__tests__/ops/branch-clone.promote.escalated.test.ts` (NEW)

TDD per global rules. Three scenarios:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  promoteToProd,
  diffTouchesEscalated,
  SoakNotMetError,
  type PromoteToProdInput,
} from '@/lib/ops/branch-clone';

// Mock the meta-DB row + migration runner so we test ONLY the gate logic.
const mockRow = {
  branchName: 'wave/test',
  headSha: 'abc123',
  soakStartedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago
  createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  // ... other fields per BranchCloneRow
};

const baseInput: Partial<PromoteToProdInput> = {
  branchName: 'wave/test',
  headSha: 'abc123',
  metaClient: /* fake client returning mockRow */,
  runProdMigration: vi.fn().mockResolvedValue({ /* success */ }),
  verifyAllTenantsParity: vi.fn().mockResolvedValue(true),
  parityVerifyEnabled: false, // skip parity verify in unit test
  now: () => new Date(),
};

describe('diffTouchesEscalated', () => {
  it('returns true when lib/migrator.ts changed', () => {
    expect(diffTouchesEscalated(['lib/migrator.ts'])).toBe(true);
  });
  it('returns true when lib/ops/branch-clone.ts changed', () => {
    expect(diffTouchesEscalated(['lib/ops/branch-clone.ts'])).toBe(true);
  });
  it('returns false for migrations/ files', () => {
    expect(diffTouchesEscalated(['migrations/0042_add_foo.sql'])).toBe(false);
  });
  it('returns false for prisma/schema.prisma', () => {
    expect(diffTouchesEscalated(['prisma/schema.prisma'])).toBe(false);
  });
  it('returns false for app routes', () => {
    expect(diffTouchesEscalated(['app/api/foo/route.ts'])).toBe(false);
  });
  it('returns true if ANY file is escalated', () => {
    expect(diffTouchesEscalated(['app/api/foo/route.ts', 'lib/migrator.ts'])).toBe(true);
  });
});

describe('promoteToProd — conditional soak (#178)', () => {
  it('skips soak when escalatedPathsTouched=false (pure-transport)', async () => {
    // Soak elapsed = 5 min < 30 min floor — would normally throw SoakNotMetError.
    // With escalatedPathsTouched=false, the gate is bypassed.
    const result = await promoteToProd({
      ...baseInput,
      minSoakHours: 0.5,
      escalatedPathsTouched: false,
    } as PromoteToProdInput);
    expect(result).toBeDefined();
    // Migration should have been invoked (gate did NOT block).
    expect(baseInput.runProdMigration).toHaveBeenCalled();
  });

  it('enforces soak when escalatedPathsTouched=true', async () => {
    // Soak elapsed = 5 min < 30 min floor — must throw.
    await expect(
      promoteToProd({
        ...baseInput,
        minSoakHours: 0.5,
        escalatedPathsTouched: true,
      } as PromoteToProdInput),
    ).rejects.toThrow(SoakNotMetError);
  });

  it('enforces soak when escalatedPathsTouched is undefined (back-compat)', async () => {
    // Old callers that have not been updated must keep the old behaviour.
    await expect(
      promoteToProd({
        ...baseInput,
        minSoakHours: 0.5,
        // escalatedPathsTouched intentionally omitted
      } as PromoteToProdInput),
    ).rejects.toThrow(SoakNotMetError);
  });
});
```

The test file may need a thin `metaClient` stub — copy the pattern from any existing `__tests__/ops/branch-clone*.test.ts` file. Allow-list extension permitted ONLY for stub helpers in this file.

## Verification gates (run in this exact order)

1. **TypeScript** — clear cache, regenerate Prisma, type-check:
   ```bash
   rm -rf .next/cache/tsbuildinfo .tsbuildinfo
   pnpm prisma generate
   pnpm tsc --noEmit
   ```
   Must complete with zero errors.

2. **Vitest target** — the new test file:
   ```bash
   pnpm vitest run __tests__/ops/branch-clone.promote.escalated.test.ts
   ```
   All scenarios green.

3. **Vitest existing branch-clone tests** — must not regress:
   ```bash
   pnpm vitest run __tests__/ops/branch-clone
   ```
   All green.

4. **Vitest full** (smoke run):
   ```bash
   pnpm vitest run --no-coverage 2>&1 | tail -50
   ```
   No new failures.

5. **Lint:**
   ```bash
   pnpm lint 2>&1 | tail -10
   ```
   No new errors.

6. **Build** — webpack only:
   ```bash
   pnpm build --webpack 2>&1 | tail -30
   ```
   Must complete.

7. **Audit FindMany no-take:**
   ```bash
   pnpm tsx scripts/audit-findmany-no-take.ts
   ```
   Must pass.

If any gate fails, stop and report. Do NOT push a partial change.

## Anti-patterns (do NOT do)

1. **Do not** widen ESCALATED_PATHS to include `migrations/**` or `prisma/schema.prisma` — the user explicitly chose the aggressive design after audit confirmed structural backstops cover those classes.
2. **Do not** apply the `promote` label after opening the PR. This wave touches `lib/ops/branch-clone.ts` (an ESCALATED file under the NEW policy) but ships under the OLD policy (1h floor). Wait for normal soak; Luc / dispatcher applies promote.
3. **Do not** modify `require-promote-label.yml` — it's correctly minimal (label-presence check only). The soak gate lives in `promoteToProd` + the convention.
4. **Do not** modify `governance-gate.yml` — it runs the audit/vitest/build/playwright. Soak is orthogonal.
5. **Do not** delete or modify the `recordCiPassForCommit` function or the `soak_started_at` column. The infrastructure stays; only the gate's interpretation changes. This is what makes the policy reversible with one-line edits.
6. **Do not** rebase onto a newer main while running. `origin/main` at SHA `86ab18c` (post-H3) is the dispatch base.
7. **Do not** edit any file outside the 5-file allow-list (modulo a thin stub helper in the new test file).
8. **Do not** lower the floor below 30 min for ESCALATED — that's the agreed defense-in-depth window.

## PR + branch hygiene

After all gates pass:

1. `git add` only the files in the allow-list.
2. Commit message:
   ```
   feat(ops): conditional soak gate — skip for pure-transport PRs (issue #178)

   Audit of 60 merges across 30 days showed the 1h blanket soak caught zero
   bugs. PRD #128 backstops (verifyMigrationApplied #141, parity audit #137,
   no-select audit #140) cover the migration-replay class synchronously at
   promote time. Soak's last meaningful defense is the two files whose buggy
   version would invalidate the backstops themselves.

   New policy:
   - PR diff touches `lib/migrator.ts` or `lib/ops/branch-clone.ts`: 30 min soak floor (was 1h)
   - Everything else: 0 min soak (was 1h)

   Implementation:
   - `lib/ops/branch-clone.ts`: ESCALATED_PATHS constant + diffTouchesEscalated helper;
     promoteToProd accepts new escalatedPathsTouched flag; default behaviour
     (undefined) is back-compat full soak.
   - `scripts/branch-clone.ts`: --escalated-paths-touched CLI flag plumbed through.
   - `.github/workflows/post-merge-promote.yml`: computes the bool from merge
     diff and passes to ops:promote-branch.
   - CLAUDE.md §promote-delegation rule 3: updated to express the conditional policy.
   - __tests__/ops/branch-clone.promote.escalated.test.ts: 9 test scenarios.

   Reversibility: one-line revert of the `effectiveSoakHours` expression
   in promoteToProd restores blanket 1h soak. Infrastructure (recordCiPassForCommit,
   soak_started_at column) intact and unused in the fast-path.

   Estimated savings: ~52 min per pure-transport PR × ~99% of recent merges.
   ```
3. `git push -u origin wave/178-conditional-soak`
4. `gh pr create --base main --head wave/178-conditional-soak --title "feat(ops): conditional soak gate — skip for pure-transport PRs (#178)"` with a body that:
   - Explains the audit finding (0 kills in 60 merges)
   - Lists the new policy
   - Notes that this PR ITSELF touches `lib/ops/branch-clone.ts` so it gets the OLD 1h soak before merge (no chicken-and-egg shortcut)
   - Lists which gates passed
5. **Stop after PR is open.** Do NOT poll, do NOT apply promote, do NOT request review. Report PR URL + SHA + which gates went green back to the dispatcher.

## Out of scope (explicit non-goals)

- Removing the `recordCiPassForCommit` function or the `soak_started_at` column. Infrastructure stays for reversibility.
- Modifying `require-promote-label.yml` or `governance-gate.yml`.
- Adding migrations/** or prisma/schema.prisma to ESCALATED_PATHS.
- Reducing the ESCALATED soak floor below 30 min.
- Touching any other file in `lib/ops/` (e.g. clone provisioner, destroy script) — the gate change is isolated.

## Success criteria

- 5 files edited (1 new test file, 4 modified).
- All 7 verification gates green.
- PR open, body documents the policy + reversibility.
- Agent stops cleanly after PR creation.
- No edits outside allow-list.
- Default behaviour (undefined `escalatedPathsTouched`) preserves old 1h soak — proves back-compat with any unmigrated caller.
