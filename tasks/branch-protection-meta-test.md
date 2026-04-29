# Branch-Protection Meta-Test Checklist

Proves the CI governance gate physically blocks merge in the expected failure modes.

---

## Preconditions

- [ ] Branch protection ruleset `main-is-sacred` enabled per `tasks/branch-protection-setup.md`.
- [ ] Wave 21 PR (`wave/21-ci-governance-gate`) merged to `main`.
- [ ] All three required checks visible in the ruleset picker:
      `Governance gate / gate`, `Promote label guard / guard`, `Require promote label / require`.
- [ ] `gh` CLI authenticated (`gh auth status`).
- [ ] `meta-test` label exists in the repo (see setup doc §5).

---

## Scenario 1 — Gate Blocks Merge Without `promote` Label

**Goal:** confirm that a PR with all CI checks green except `Require promote label / require`
(which fails because the label is absent) cannot be merged.

### Steps

1. Open a throwaway PR:
   ```bash
   bash scripts/meta-test/open-meta-test-pr.sh no-label "scenario 1 — no promote label"
   ```
2. Note the PR URL printed by the script.
3. Wait for CI to finish (typically 8-15 min for `Governance gate / gate`; `Require promote label`
   fires in under 30 s).

### Expected Outcome

| Check | Result |
|-------|--------|
| `Governance gate / gate` | Passes (build + Vitest + smoke all green) |
| `Require promote label / require` | **Fails** — "PR is missing the `promote` label" |
| Merge button | **Disabled** — "Required status check failed: Require promote label / require" |

4. Screenshot / copy the merge-button status message and record it here:

   ```
   <paste screenshot path or status message>
   ```

5. DO NOT apply the `promote` label. Leave the PR in the failing state until the end of this
   checklist, then close it.
6. Close + delete branch:
   ```bash
   PR=<number>
   gh pr close $PR --comment "meta-test scenario 1 complete — closing without merge"
   gh api repos/lucvanrhyn/farm-management/git/refs/heads/meta-test/no-label-$(date +%Y-%m-%d) -X DELETE
   ```

---

## Scenario 2 — Guard Blocks Unauthorized `promote` Label Application

**Goal:** confirm that a collaborator (or test account) cannot sneak the `promote` label
onto a PR and bypass the gate.

### Steps

1. Open a throwaway PR:
   ```bash
   bash scripts/meta-test/open-meta-test-pr.sh unauth-label "scenario 2 — unauthorized promote label"
   ```
2. As a non-`lucvanrhyn` GitHub account (collaborator, test bot, etc.), apply the `promote`
   label to the PR.

   If no second account is available: simulate by temporarily using the GitHub web UI as
   any collaborator account, or use a personal access token for a different account via:
   ```bash
   GH_TOKEN=<other-account-token> gh pr edit <number> --add-label promote
   ```

### Expected Outcome

| Check | Result |
|-------|--------|
| `Promote label guard / guard` | **Fails** — "promote label applied by unauthorized actor" |
| `promote-label-guard` comment on PR | Posted: "Removed `promote` label applied by `@<actor>` …" |
| `promote` label | **Removed** from the PR by the workflow |
| Merge button | **Disabled** — required check failed |

3. Record the guard comment URL here:

   ```
   <paste comment URL>
   ```

4. Close + delete branch:
   ```bash
   PR=<number>
   gh pr close $PR --comment "meta-test scenario 2 complete — closing without merge"
   gh api repos/lucvanrhyn/farm-management/git/refs/heads/meta-test/unauth-label-$(date +%Y-%m-%d) -X DELETE
   ```

---

## Scenario 3 — Gate Blocks Merge When Smoke Fails

**Goal:** confirm that even with the `promote` label present, a PR whose Playwright smoke
fails cannot be merged.

### Steps

1. Create a local branch and introduce a deliberately broken smoke test:
   ```bash
   cd /path/to/farm-management-main-checkout   # not the worktree
   git checkout -b meta-test/smoke-fail-$(date +%Y-%m-%d) origin/main
   ```
2. Open `e2e/smoke.spec.ts` and add a failing assertion before all other tests, e.g.:
   ```ts
   test('intentional-fail', async ({ page }) => {
     await page.goto('/');
     await expect(page.locator('#this-selector-does-not-exist')).toBeVisible();
   });
   ```
3. Commit + push:
   ```bash
   git add e2e/smoke.spec.ts
   git commit -m "meta-test: intentional smoke failure for scenario 3"
   git push -u origin HEAD
   ```
4. Open PR via `gh pr create`:
   ```bash
   gh pr create \
     --title "[meta-test] scenario 3 — smoke failure blocks merge" \
     --body "Meta-test PR for issue #21 / scenario 3. Will be closed without merging." \
     --label meta-test \
     --base main
   ```
5. Wait for CI to reach the Playwright smoke step (typically 15-20 min due to build step).
6. As Luc, apply the `promote` label: `gh pr edit <number> --add-label promote`.

### Expected Outcome

| Check | Result |
|-------|--------|
| `Governance gate / gate` | **Fails** — "Playwright smoke" step failed |
| `Require promote label / require` | Passes (label present) |
| `Promote label guard / guard` | Passes (Luc applied it) |
| Merge button | **Disabled** — `Governance gate / gate` required check failed |

7. Record the failed CI run URL here:

   ```
   <paste Actions run URL>
   ```

8. Close + delete branch + REVERT the smoke change (important — do not leave broken smoke on any branch):
   ```bash
   PR=<number>
   gh pr close $PR --comment "meta-test scenario 3 complete — closing without merge"
   git revert HEAD --no-edit
   git push
   gh api repos/lucvanrhyn/farm-management/git/refs/heads/meta-test/smoke-fail-$(date +%Y-%m-%d) -X DELETE
   ```

---

## Scenario 4 — Happy Path: All Checks Pass, Merge Unlocks

**Goal:** confirm that a valid PR (all checks green, `promote` label applied by Luc) can
actually be squash-merged.

### Steps

1. Open a throwaway PR with a benign change:
   ```bash
   bash scripts/meta-test/open-meta-test-pr.sh happy-path "scenario 4 — happy path"
   ```
2. Wait for all CI checks to pass.
3. Verify `Require promote label / require` is failing (label not yet applied — this is expected).
4. As Luc, apply the `promote` label:
   ```bash
   gh pr edit <number> --add-label promote
   ```
5. Wait ~30 s for `Require promote label / require` to re-run and pass.

### Expected Outcome

| Check | Result |
|-------|--------|
| `Governance gate / gate` | Passes |
| `Promote label guard / guard` | Passes |
| `Require promote label / require` | Passes |
| Merge button | **Enabled** — "This branch has no conflicts with the base branch" (or similar) |
| Post-merge job (Phase 4) | Fires on merge, runs `promote-to-prod` |

6. Squash-merge the PR via the GitHub UI.
7. Confirm the head branch was auto-deleted (Settings → Automatically delete head branches).

---

## Sign-Off

Once all four scenarios are complete and documented above:

- [ ] Scenario 1 passed (label absence blocks merge)
- [ ] Scenario 2 passed (unauthorized label is removed, check fails)
- [ ] Scenario 3 passed (smoke failure blocks merge even with label)
- [ ] Scenario 4 passed (happy path unlocks merge)
- [ ] Update MEMORY.md: mark issue #21 done.
- [ ] Remove any test-account collaborator access added for Scenario 2.
