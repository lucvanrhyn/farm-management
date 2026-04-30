# Branch Protection Setup — `main-is-sacred`

Run this checklist once, after the wave/21-ci-governance-gate PR is merged to `main`.
All steps happen in the GitHub web UI unless otherwise noted.

---

## 1. Create the `main-is-sacred` Ruleset

1. Navigate to **github.com/lucvanrhyn/farm-management → Settings → Rules → Rulesets**.
2. Click **New ruleset → New branch ruleset**.
3. Fill in:
   - **Ruleset name:** `main-is-sacred`
   - **Enforcement status:** Active
4. **Target branches:**
   - Click **Add target → Include by pattern** → type `main` → Add.
5. **Bypass list:** leave empty. Even Luc does not bypass. Emergency direct-commits must
   be authorized out-of-band (disable the rule temporarily, commit, re-enable).
6. **Rules to enable** (tick all of the following):

   | Rule | Setting |
   |------|---------|
   | Restrict updates (require a pull request before merging) | Enabled |
   | Require a pull request before merging | Enabled — see sub-settings below |
   | Require status checks to pass | Enabled — see required checks below |
   | Block force pushes | Enabled |
   | Restrict deletions | Enabled |
   | Require conversation resolution before merging | Enabled |

   **Pull-request sub-settings:**
   - Required approvals: **0** (during solo-dev phase) — flip to **1** when a second human reviewer joins
   - Dismiss stale reviews when new commits are pushed: **Yes**
   - Require review from Code Owners: **No** (during solo-dev phase) — flip to **Yes** when a second human reviewer joins. With a single CODEOWNER + this enabled + last-push-approval, GitHub deadlocks self-merges (see `feedback-solo-dev-ruleset-trap.md`).
   - Require approval of the most recent reviewable push: **No** (during solo-dev phase) — flip to **Yes** when a second human reviewer joins.

   **Required status checks** (add each by name — they must have run at least once to appear in the picker; if they haven't run yet, type the exact name and select "Add check"):
   - `Governance gate / gate`
   - `Require promote label / require`

   The `Promote label guard / guard` workflow is intentionally NOT a required check — it runs on `pull_request_target: [labeled]` only, so it does not fire on every push and would block unlabelled PRs from ever passing required-checks if marked required. Its enforcement is observational (removes unauthorized `promote` labels), not gating.

7. Click **Save ruleset**.

---

## 2. Restrict Merge Strategies

1. Navigate to **Settings → General → Pull Requests**.
2. Under **Allow merge commits / Allow squash merging / Allow rebase merging**:
   - Uncheck **Allow merge commits**
   - Check **Allow squash merging** — set the default commit message to **Pull request title and commit details**
   - Uncheck **Allow rebase merging**
3. Check **Automatically delete head branches** (keeps the repo clean after promote).
4. Save.

---

## 3. How the `promote` Label Gate Works (Two-Layer Model)

The "only Luc can trigger a merge" guarantee is enforced by two complementary checks:

| Layer | Workflow | What it does |
|-------|----------|--------------|
| **Guard** | `promote-label-guard.yml` | Runs on `pull_request_target: labeled`. If actor is not `lucvanrhyn`, removes the label, comments, and fails the `Promote label guard / guard` check. |
| **Require** | `require-promote-label.yml` | Runs on every `pull_request` event (open, sync, label change). Fails `Require promote label / require` if the `promote` label is absent. |

Together: anyone other than Luc who tries to add the label immediately has it removed (guard);
and merge is blocked until the label is present (require). A PR without Luc's label can never
pass both required checks simultaneously.

**WARNING — cold-start behaviour:** if neither workflow has ever run against the target repo, GitHub
cannot add them to the required-checks picker by name. Workaround: open a throwaway PR, wait
for both checks to run once (they will fail as expected), then add them to the required-checks
list in the ruleset. The meta-test procedure in `tasks/branch-protection-meta-test.md` exercises
exactly this flow.

---

## 4. Confirm CODEOWNERS Is Correct

`.github/CODEOWNERS` was shipped in Phase 2 of this wave. Confirm it reads:

```
* @lucvanrhyn
/.github/ @lucvanrhyn
/CLAUDE.md @lucvanrhyn
...
```

`@lucvanrhyn` is the sole Code Owner. During solo-dev phase the "Require review from Code Owners" rule is **off** (flipping it on with a single CODEOWNER deadlocks self-approval); the substantive protections come from required status checks (`gate` + `require`) plus the `promote` label gate. Re-enable code-owner review when a second human reviewer joins.

---

## 5. Create the `meta-test` Label

1. Navigate to **github.com/lucvanrhyn/farm-management → Issues → Labels**.
2. Click **New label** → name: `meta-test`, colour: `#e4e669` (yellow).
3. This label is used by the helper script `scripts/meta-test/open-meta-test-pr.sh`; it carries
   no enforcement meaning and does not affect branch protection.

---

## 6. Verification

Once the ruleset is saved, proceed to `tasks/branch-protection-meta-test.md` and execute all
four scenarios. Do not sign off issue #21 until all four pass.

Quick smoke-check before opening the meta-test PRs:

```bash
# Confirm workflows are present on main
git fetch origin
git show origin/main:.github/workflows/governance-gate.yml | head -1
git show origin/main:.github/workflows/promote-label-guard.yml | head -1
git show origin/main:.github/workflows/require-promote-label.yml | head -1

# Open meta-test PR — scenario 1 (no label)
bash scripts/meta-test/open-meta-test-pr.sh no-label "scenario 1 — no promote label"
```
