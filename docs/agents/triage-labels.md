# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual GitHub label strings configured on `lucvanrhyn/farm-management`.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table via `gh issue edit <number> --add-label "<label>"`.

## Distinct from the merge-gate `promote` label

Don't confuse triage labels with the workflow label `promote` (described in CLAUDE.md). `promote` is applied by `@lucvanrhyn` only, to unlock PR merge to `main`. The triage labels above are about issue lifecycle, not merge gates.
