#!/usr/bin/env bash
# open-meta-test-pr.sh — Create a throwaway PR to exercise branch protection.
#
# Usage:
#   bash scripts/meta-test/open-meta-test-pr.sh <scenario-slug> "<scenario description>"
#
# Example:
#   bash scripts/meta-test/open-meta-test-pr.sh no-label "scenario 1 — no promote label"
#
# The script:
#   1. Verifies gh is on PATH.
#   2. Checks out main and fast-forward pulls.
#   3. Creates a dated branch: meta-test/<slug>-<date>.
#   4. Creates a trivial commit (a timestamped run-record file under tasks/.meta-test-runs/).
#   5. Pushes the branch and opens a PR labelled `meta-test`.
#   6. Prints the resulting PR URL.

set -euo pipefail

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <scenario-slug> \"<scenario description>\"" >&2
  exit 1
fi

SLUG="$1"
DESCRIPTION="$2"
DATE="$(date +%Y-%m-%d)"
BRANCH="meta-test/${SLUG}-${DATE}"
RUN_FILE="tasks/.meta-test-runs/${SLUG}-${DATE}.md"

# ---------------------------------------------------------------------------
# Precondition checks
# ---------------------------------------------------------------------------
command -v gh >/dev/null 2>&1 || { echo "gh CLI required — install from https://cli.github.com"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git required"; exit 1; }

# ---------------------------------------------------------------------------
# Sync main
# ---------------------------------------------------------------------------
echo "==> Switching to main and pulling..."
git checkout main
git pull --ff-only

# ---------------------------------------------------------------------------
# Create branch
# ---------------------------------------------------------------------------
echo "==> Creating branch ${BRANCH}..."
git checkout -b "${BRANCH}"

# ---------------------------------------------------------------------------
# Trivial commit — a dated run-record file
# ---------------------------------------------------------------------------
mkdir -p "tasks/.meta-test-runs"

cat > "${RUN_FILE}" <<EOF
# Meta-test run: ${SLUG}

- Date: ${DATE}
- Scenario: ${DESCRIPTION}
- Branch: ${BRANCH}
- Purpose: throwaway PR to verify branch-protection rules (issue #21).
  This file has no functional meaning — it exists only to create a non-empty commit.
  See tasks/branch-protection-meta-test.md for the full checklist.
EOF

git add "${RUN_FILE}"
git commit -m "meta-test: ${SLUG} — ${DESCRIPTION}"

# ---------------------------------------------------------------------------
# Push
# ---------------------------------------------------------------------------
echo "==> Pushing ${BRANCH}..."
git push -u origin HEAD

# ---------------------------------------------------------------------------
# Open PR
# ---------------------------------------------------------------------------
echo "==> Opening PR..."
PR_URL="$(gh pr create \
  --title "[meta-test] ${DESCRIPTION}" \
  --body "Meta-test PR for issue #21 / scenario: ${DESCRIPTION}.

This PR **will be closed without merging**. It exists only to verify that the
branch-protection ruleset (\`main-is-sacred\`) blocks merge in the expected way.

See [\`tasks/branch-protection-meta-test.md\`](../blob/main/tasks/branch-protection-meta-test.md)
for the full checklist and expected outcomes." \
  --label meta-test \
  --base main)"

echo ""
echo "PR created: ${PR_URL}"
echo "Branch:     ${BRANCH}"
echo "Run file:   ${RUN_FILE}"
echo ""
echo "Next steps: wait for CI, then follow tasks/branch-protection-meta-test.md §${SLUG}."
