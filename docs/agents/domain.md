# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring.

## Before exploring, read these

- **`CLAUDE.md`** at the repo root — the source of truth for build rules, branching workflow, data principles, and component contracts. Always read first.
- **`CONTEXT.md`** at the repo root (single-context layout) if it exists — domain glossary.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If `CONTEXT.md` or specific ADRs don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure (single-context)

```
/
├── CLAUDE.md              ← agent instructions (already authoritative)
├── CONTEXT.md             ← domain glossary (created lazily by /grill-with-docs)
├── docs/
│   ├── agents/            ← this folder
│   └── adr/               ← architectural decision records
│       ├── 0001-<decision-slug>.md
│       └── 0002-<decision-slug>.md
└── (Next.js app structure)
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md` — and where applicable, the conventions in `CLAUDE.md` (e.g. "camp" not "field", `Camp[]` snake_case shape, "wave" branches, "soak", "promote").

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR or any rule in CLAUDE.md, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
> _Contradicts CLAUDE.md "main is sacred" rule — flagging for Luc before proceeding._
