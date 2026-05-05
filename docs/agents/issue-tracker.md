# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues on `lucvanrhyn/farm-management`. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue with `gh issue create`. Apply the `needs-triage` label so it enters the standard triage flow.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Project-specific notes

- New issues should reference relevant **wave / sub-branch convention** described in CLAUDE.md (`wave/<issue-number>-<short-slug>`).
- Issues that touch the prod database must call out the migration/soak requirements (`migrations/`, ≥1h clone soak).
- `promote` is a workflow label (only `@lucvanrhyn` applies it to unlock merge to `main`); don't confuse with triage labels.
