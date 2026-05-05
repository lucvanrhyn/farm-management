# PRD — FarmTrack Stabilization Wave + Multi-Species Refactor + Dev/Live Workflow

**Date:** 2026-04-28
**Author:** Luc (founder) + Claude (synthesized from grill-me sessions 2026-04-27 and 2026-04-28)
**Status:** Draft — awaiting Luc sign-off before any sub-branch dispatch
**Live baseline:** `main @ 426d98e` — demo-safe, 1 paying tenant (`basson-boerdery`), 0 outages tolerated

---

## Problem Statement

Luc is a non-technical founder running FarmTrack as a multi-tenant SaaS for South African farmers. He has one paying tenant (basson-boerdery, 103 cattle) and is preparing to onboard more. Three problems are blocking him from confidently shipping:

1. **He cannot work on new features without risking the live app.** The recent demo failed because in-flight work had landed on the same branch tenants were running. He needs a hard guarantee: tenant-facing code at `farmtrack.app` only changes when *he* explicitly says so. Bug fixes and feature work must happen on a parallel "developer" version that tenants cannot reach.

2. **The product silently treats a multi-species farm as one farm.** When a farmer with both cattle and sheep switches to "cattle mode", the dashboard still shows sheep, the map still shows sheep camps, the mob list mixes both. This contradicts the vision (each species feels like a separate farm-within-tenant) and will hard-break the product the moment any farmer enables a second species.

3. **A bug-dump of 41 user-reported issues is unsorted and unfixed.** Many trace to 2-3 shared root causes (a layout container bug affects 9 pages, a scroll-ratio bug affects 7 more, a tenant-cache race leaks branding across farms). Tenants are seeing them today.

These are blocking the next phase of work (5 flagship features for the differentiation moat). Luc needs them resolved in an order that never threatens the live app.

## Solution

A four-pillar stabilization wave executed in strict sequence on isolated sub-branches, each with its own ephemeral database clone, before any new feature work resumes:

**Pillar 1 — Dev/Live Workflow (governance, not code).** Formalize that `main` is the live tenant branch and is mutated only by explicit `promote` events from Luc. All code changes — bug fixes, refactors, new features — happen on sub-branches off `main`. Each sub-branch gets its own Vercel preview deployment AND its own cloned database (no shared state with prod). Merging a sub-branch into `main` requires (a) preview green, (b) Playwright smoke green on the cloned DB, (c) Luc-typed approval. This becomes the inviolable rule going forward.

**Pillar 2 — Option C: Per-branch Turso DB clones.** Stand up the infrastructure that makes Pillar 1 real. Every PR/branch gets a fresh Turso clone of basson's prod DB, wired into its Vercel preview via build hook. Migrations run on the clone first; only after a green soak does the migration run on prod. ~6 hours of ops setup, then permanent.

**Pillar 3 — Bug Wave (5 sub-waves on the new infrastructure).** With sub-branch isolation in place, batch-fix the 41 bugs in pattern-aware waves:
- Wave 3a: shared layout container (resolves 16 surfaces of "black page" / "excessive scroll" at once)
- Wave 3b: tenant background leak — both quick "one default for all tenants" AND the deeper epoch-token cache invalidation refactor
- Wave 3c: broken interactive elements (game toggle, tasks calendar clicks, hidden charts)
- Wave 3d: regulatory accuracy (NVD, SARS IT3, task templates)
- Wave 3e: notifications correctness + onboarding expansion

**Pillar 4 — Multi-Species Refactor.** With the bug surface clean, ship the locked architectural spec: `Camp.species`, `Mob.species`, hard-block cross-species writes, AI Grill Wizard for CSV import, weighted-LSU pricing. basson sees zero visible change; the capability becomes available to enable per-tenant.

After Pillar 4, the deferred work resumes: AI Grill Wizard polish → Methodology v1.5 completion → 5 flagships (Vision Logger, Farm Einstein extensions, Weekly Plan, Disease Radar, District Benchmarks).

## User Stories

### Founder — dev/live workflow

1. As Luc, I want `main` to never change without my explicit say-so, so that I never get a panicked call from a tenant during a demo because a bug fix accidentally shipped.
2. As Luc, I want every sub-branch to deploy to its own Vercel preview URL with its own database, so that I can poke at a fix in a real browser without affecting tenants.
3. As Luc, I want to see a one-click "promote to live" action that runs the production migration only after preview is green, so that I never have to remember a multi-step cutover by hand.
4. As Luc, I want a CI gate that blocks merging to `main` unless the preview's Playwright smoke suite passed, so that broken code physically cannot reach tenants.
5. As Luc, I want the sub-branch's database to be discarded automatically when the branch is deleted, so that I don't accumulate orphaned Turso instances costing money.
6. As Luc, I want a daily summary in memory of which sub-branches are live, what they cost in Turso quota, and how stale their clone is, so that ops debt doesn't pile up invisibly.
7. As Luc, I want the rule that "main is sacred" to be encoded as a CLAUDE.md instruction Claude reads before every implementation task, so that no future agent forgets and pushes a bug fix straight to main.

### Founder — multi-species

8. As Luc, I want a sheep-and-cattle farm to feel like two separate farms inside one tenant, so that switching mode actually changes what the farmer sees.
9. As Luc, I want camp creation to force a species pick, so that no camp ends up unscoped and accidentally visible across modes.
10. As Luc, I want the API to hard-block cross-species animal moves and parent assignments, so that data corruption is impossible — not merely warned against.
11. As Luc, I want notifications and Einstein answers to span all species (with breakdown by species), so that the farmer never misses a sheep alert because they happened to be in cattle mode.
12. As Luc, I want CSV imports of mixed-species data to walk the farmer through the ambiguities (which breed is cattle vs sheep, which "Camp 5" belongs to which species), so that bad imports never silently corrupt the farm's state.
13. As Luc, I want pricing for multi-species farms to be a single bill computed from weighted total LSU (sheep ÷ 6, game discounted), so that adding a species doesn't multiply the customer's invoice the way BenguFarm does.

### Tenant farmer (basson) — bug fixes

14. As a basson admin, I want pages like alerts, mobs, rainfall, veld, drought, reports, tasks, and import to render full-height with a proper background instead of a black/cut-off shell, so that the app stops looking broken.
15. As a basson admin, I want pages like observations, reproduction, camps, finances, animal catalog, break-even, and subscription to fit the viewport without excessive scroll, so that I can see content without feeling I'm wrestling the layout.
16. As a basson admin, I want to never briefly see another tenant's branding when I switch farms, so that I trust the app's data isolation.
17. As a basson admin, I want the map to default to satellite view and stop having layer controls block other UI buttons, so that I can use the map without fighting it.
18. As a basson admin, I want the game toggle in species settings to actually do something when clicked (or be replaced with an "+ Add species" button per the spec), so that broken UI elements don't undermine my trust.
19. As a basson admin, I want the tasks calendar's color clicks to respond, so that I can use the feature I was sold.
20. As a basson admin, I want camp analytics, finances charts, and animal analytics to be visible above the fold (not buried at the bottom of long pages), so that I see the value of the data I've entered.
21. As a basson admin, I want NVD (National Vendor Declaration) and SARS IT3 tax exports to match SA legislation exactly, so that I'm not personally liable for an incorrect filing.
22. As a basson admin, I want every preset task template to be a real SA-livestock task (not LLM-hallucinated content), so that I trust the templates I'm seeing.
23. As a basson admin, I want a "back to farm selector" link visible whenever I manage more than one farm, so that I'm not trapped in one farm.
24. As a basson admin, I want push notifications and (later) WhatsApp alerts to actually fire after the Phase J rollout, so that I'm reached on the channel I configured.

### Tenant farmer (basson) — onboarding & UX

25. As a basson admin, I want the Quick Wins panel to expand into a guided tutorial when I'm new, so that I'm not staring at empty dashboards wondering where to start.
26. As a basson admin, I want the Breeding AI page to explain what pedigree data is and show me an example upload format, so that I can actually use the feature without a phone call.
27. As a basson admin, I want the Import wizard to walk me through ambiguous fields conversationally (the AI Grill Wizard methodology), so that imports stop failing silently.
28. As a basson admin, I want page chrome (notifications bell, home, sign-out) reachable without scrolling, so that I'm not hunting for primary navigation.

### Future tenant — multi-species onboarding

29. As a future Karoo sheep-and-game farmer, I want to add a species to my account from the mode switcher (with an upsell path to Advanced if I'm Basic), so that I can grow into the product.
30. As a future mixed farmer, I want the AI Grill Wizard to ask me only about the 3-5 hard ambiguities in my CSV (not every column), so that import feels conversational instead of bureaucratic.
31. As a future mixed farmer, I want the import to skip ambiguous rows and give me a `skipped.csv` with reasons, so that one bad row doesn't block the whole import.
32. As a future game farmer, I want the app to support quarterly census workflows (not daily ear-tag observations), so that the product fits how I actually work.

### Operator (Luc-as-ops)

33. As Luc-as-ops, I want a documented runbook for "promoting a sub-branch to main", so that I can do it confidently or hand it to a future contractor.
34. As Luc-as-ops, I want every Wave's CI run to upload Playwright screenshots/videos of the affected surfaces, so that I can spot-check the fixes without re-running tests locally.
35. As Luc-as-ops, I want the visual-screenshot QA against logged-in admin surfaces to use my account (luc / Batman69) so that we can audit pages no demo user can reach.
36. As Luc-as-ops, I want every dispatched sub-agent to be given the file allow-list it can edit, so that scope creep is structurally impossible.

## Implementation Decisions

### Modules

**M1 — Per-branch DB clone provisioner (Option C).** New ops module owning the verbs `clone-for-branch <branch>`, `promote-to-prod <branch>`, `destroy-branch-db <branch>`. Wraps `turso db create --from <prod-snapshot>`. Stores branch→DB mapping in meta-DB. Vercel build hook injects the cloned `TURSO_DATABASE_URL` into preview deployments. Migrations always run against the clone first, soak for ≥1h, then run against prod only on explicit promote. Auto-destroy on branch delete.

**M2 — Branch governance gate.** GitHub Actions workflow: any PR targeting `main` must pass (a) build green, (b) Vitest green, (c) Playwright smoke green against the branch's clone, (d) human approval label `promote`. Without all four, merge is blocked. The `promote` label is added by Luc only — encoded in CODEOWNERS.

**M3 — Tenant cache epoch token.** A monotonic counter `farmEpoch` keyed by `farmSlug`. Bumped on every farm switch in `OfflineProvider`. ALL cached reads (`getCachedCamps`, `lastSyncedAt`, image cache, etc.) include the epoch in their cache key. Stale-epoch reads are dropped, not returned. Fixes the entire class of cross-tenant leak bugs (background flash + any future cache races).

**M4 — Default tenant background.** Single `/farm-hero.jpg` shipped with the app, used for ALL tenants. Per-tenant background URLs in meta-DB are deprecated/unused. Removes the cache-leak symptom in ~5 minutes. Bundled with M3 so the class-of-bug fix lands alongside the symptom fix.

**M5 — Layout shell component.** One `<AdminPage>` wrapper enforcing `min-h-dvh`, the brand background color, safe-area insets, and consistent header/footer slots. Migrate the 9 Pattern-A pages and 7 Pattern-B pages onto it. Most Pattern A/B bugs collapse into "this page doesn't use the shell yet."

**M6 — Species-scoped data layer.**
- Schema: `Camp.species` NOT NULL, `Mob.species` NOT NULL, drop global unique on `Camp.campId`, add composite unique on `(species, campId)`.
- API contract: every read endpoint that takes a `mode` parameter filters server-side; every write endpoint validates target-species match. Cross-species writes throw typed `CrossSpeciesError` with HTTP 422.
- Exception: `/api/notifications` and `/api/einstein/chat` deliberately span all species (per locked spec Q10.2 + Q10.3) — flagged in code comments with spec reference.
- Migration: backfill all existing camps + mobs to `species = "cattle"` before the NOT NULL constraint flips. basson sees zero visible change.

**M7 — AI Grill Wizard.** Server-side function `analyseCsv(rows, speciesContext) → {applied: ColumnMap[], questions: Ambiguity[], skipped: Row[]}`. 90% confidence threshold for silent application. Hybrid UX: chat dialog for ≤5 hard ambiguities, batch-confirm screen for routine maps. Failure mode: skip ambiguous rows, generate `skipped.csv`, never block whole import. English only at v1.

**M8 — Pricing engine (single source of truth).** `farm-website-v2/lib/pricing.ts` exports `computeTotalLsu({cattle, sheep, goats, gameLsu})` plus per-tier rates. Marketing pricing page + app subscribe screen + register copy ALL read from this module. Eliminates the R195/R200/R450/R500 inconsistency across surfaces.

**M9 — Methodology completeness + nudge.** `methodologyCompleteness(blob): 0..1` returns ratio of filled fields. Drives the dashboard banner ("🤖 Einstein doesn't know your farm yet — 3 min to fix") which renders only when ratio < 0.5 AND tier is Advanced/Consulting. Dismissible with 7-day re-show.

**M10 — Wizard mode for MethodologyForm.** New `mode: "form" | "wizard"` prop. Wizard renders one field per step with progress dots and Next/Back. Auto-prefills `tier` and `speciesMix` from `FarmSettings.farmName + breed` heuristics.

**M11 — Structured breeding-calendar editor.** Replace the freeform textarea with two rows of 12 month chips ("Joining" / "Calving"). Round-trips to and from the existing freeform string column — no schema change.

### API contracts (additions)

- `POST /api/ops/clone-branch` — admin-only, creates Turso clone for a branch
- `POST /api/ops/promote-branch` — admin-only, runs prod migration after preview soak
- `DELETE /api/ops/branch-db/:branch` — admin-only, destroys branch clone
- `GET /api/farm/:slug/methodology-completeness` — returns 0..1 ratio
- All existing list endpoints (`/api/camps`, `/api/animals`, `/api/observations`, `/api/mobs`) gain a server-side `mode` filter respecting `Camp.species` / `Mob.species` / `Animal.species`
- All write endpoints accepting `campId`, `motherId`, `fatherId` validate species match and return HTTP 422 with `CROSS_SPECIES_VIOLATION` code on mismatch

### Schema changes (one migration, run in this order)

1. Add `Camp.species TEXT` nullable
2. Backfill `UPDATE Camp SET species = 'cattle' WHERE species IS NULL`
3. Alter `Camp.species` NOT NULL
4. Drop unique index on `Camp.campId`
5. Add unique index on `(Camp.species, Camp.campId)`
6. Add `Mob.species TEXT` nullable
7. Backfill `UPDATE Mob SET species = 'cattle' WHERE species IS NULL`
8. Alter `Mob.species` NOT NULL
9. (No change to `Animal.species` — already correct with default `'cattle'`)
10. (No change to `Observation` — derives `species` from `Camp` at write time)

Migration runs on per-branch clone first, soaks ≥1h, then prod with Luc-typed approval.

### Architectural decisions

- **`main` is sacred** — encoded in CLAUDE.md, enforced by CI gate. Every implementation agent must be told its allow-list and target sub-branch in its initial prompt.
- **Sub-branch + worktree per wave** — each wave (3a, 3b, 3c, 3d, 3e, 4) gets its own worktree under `.worktrees/`, its own Turso clone, its own Vercel preview. Waves do not share branches.
- **No bundling of regulatory + UX work** — Wave 3d (NVD, IT3, templates) is dispatched alone with a regulatory-compliance reviewer agent, never alongside layout fixes.
- **Notifications and Einstein span all species** — locked deviation from "current mode only", per Luc's Q10.2 + Q10.3 overrides.
- **Game is a first-class species** — same `Camp` / `Animal` / `Observation` tables with `species: "game"`; existing `GameSpecies` / `HuntAnimal` / `CensusResult` tables become opt-in supplements, not parallel data models.
- **Pricing — weighted single bill** — never stacked-module like BenguFarm. Game LSU at discounted rate (R0.50 Basic / R7 Advanced) to reflect lower cost-to-serve.
- **Background-image strategy — single default for all tenants** — no per-tenant branding at v1; ships alongside the epoch-token refactor, not instead of it.

## Testing Decisions

### What makes a good test (project rule)

Test external behavior, not implementation details. A test should fail when the user-visible contract breaks, not when an internal helper is renamed. Prior pattern in the codebase: `lib/server/cached.test.ts` mocks Prisma at the module boundary and asserts cache-key shape, not the internal Map. Repeat that pattern.

### Modules with test coverage required (Luc to confirm)

- **M1 (clone provisioner):** integration test against a real Turso dev account verifying clone → migrate → promote → destroy round-trip. Run once per CI run, not per commit (cost).
- **M2 (governance gate):** workflow YAML lint + a meta-test PR that intentionally fails one gate and asserts merge is blocked.
- **M3 (epoch token):** unit tests for `bumpEpoch`, `getEpochKey`, plus integration test simulating a farm switch mid-flight and asserting no stale read returns.
- **M5 (layout shell):** Playwright visual regression — screenshot each of the 16 migrated pages at 1280×800 and 375×667, assert no overflow / no black-page artifacts.
- **M6 (species data layer):** unit tests for `withSpeciesScope`; integration tests for cross-species 422 on every write endpoint; basson regression suite asserting cattle-only output unchanged.
- **M7 (AI Grill Wizard):** unit tests for `analyseCsv` against a fixture CSV with known ambiguities; snapshot test for `skipped.csv` output shape.
- **M8 (pricing engine):** unit tests for `computeTotalLsu` covering single-species, mixed cattle+sheep, mixed cattle+sheep+game, and the BenguFarm differentiation reference (300-LSU mixed farm = R6,000/yr).
- **M9 + M10 + M11 (methodology):** Vitest for completeness helper + wizard step navigation + chip-state ↔ string round-trip; Playwright for end-to-end "open wizard → fill → save → Einstein answers using methodology."
- **Visual screenshot audit (Wave 3 prerequisite):** Playwright authenticated session using credentials `luc` / `Batman69`, screenshots all admin surfaces, output under `playwright-report/screenshots/` for human review.

### Prior art

- `lib/server/cached.test.ts` — module-boundary mocking pattern
- `tests/playwright/smoke.spec.ts` — Playwright smoke pattern (extend with branch-clone DB)
- `app/api/observations/route.test.ts` — typed-error API contract pattern (replicate for cross-species 422)

### What NOT to test

- Internal cache Map shape (tested at the read-API level instead)
- Specific Tailwind classes on the layout shell (visual regression covers this)
- Per-page render output for the 16 Pattern A/B pages (one shell test covers all)

## Out of Scope

- **Rule editor for Methodology Object** — defer to Weekly Plan flagship
- **Learned preferences from Weekly Plan swipes** — Weekly Plan doesn't exist yet
- **Schema migration to typed Methodology columns** — current freeform JSON works; premature
- **Vision Logger breed-prior consumption** — Vision Logger doesn't exist yet
- **Fine-grained convert-camp-species admin flow** — v2; for now species is set at create time and immutable
- **Detailed RBAC by species** — never (locked Q10.6)
- **Disease Radar / District Benchmarks species scoping** — deferred until those features exist
- **Marketplace / cross-tenant social** — post-launch
- **Afrikaans translation of new copy** — one-week add post-launch (Q9.5)
- **Tru-Test BLE integration (Phase O)** — uses Classic SPP not BLE; deferred post-launch
- **WhatsApp setup polish (Phase P)** — verify what's live today; defer further work
- **Logix CSV (Phase Q)** — deferred post-launch
- **SA moats polish (Phase N)** — deferred post-launch
- **Auction feed** — deferred post-launch
- **Per-tenant background images** — explicitly removed in M4; revisit only after a paying tenant requests it

## Further Notes

### Sequencing (locked)

1. **PRD sign-off** (this document)
2. **CLAUDE.md update** encoding the "main is sacred + sub-branch + governance gate" rule (~30 min, separate sub-branch)
3. **Option C build** (Pillar 2 — M1 + M2) — ~6 hrs ops setup, no tenant impact
4. **Visual screenshot audit** using `luc` / `Batman69` to fill in the bug list with concrete evidence — runs against the new clone, not prod
5. **Wave 3a** — layout shell (M5) — resolves 16 surfaces
6. **Wave 3b** — background fix (M3 + M4 bundled) — resolves tenant leak class
7. **Wave 3c** — broken interactives — resolves F1-F6
8. **Wave 3d** — regulatory accuracy — resolves C3-C5 (regulatory-compliance reviewer agent)
9. **Wave 3e** — notifications + onboarding — resolves S1-S3 + O1-O3
10. **Wave 4** — multi-species refactor (M6) — resolves Pattern C
11. **Wave 5** — AI Grill Wizard polish (M7)
12. **Wave 6** — Methodology v1.5 (M9 + M10 + M11)
13. **Flagships** — Vision Logger → Weekly Plan → Disease Radar → District Benchmarks (per master plan)

Each Wave is one TDD-agent dispatch with file allow-list, against its own worktree, against its own DB clone. Each Wave ends with the 8-gate demo-ready check (build green, Vitest green, Playwright green, deep-audit green, telemetry green, beta soak ≥24h, cold demo dry-run, Luc-typed promote).

### Credentials for QA

- **Visual audit account:** `luc` / `Batman69` — use only against branch clones, never against prod (never log in via the live `farmtrack.app` for QA, always via the preview URL)

### What I'm NOT doing without confirmation

- I am not modifying `main`. Anything that touches code lands on a sub-branch.
- I am not running migrations against basson's prod DB until the clone has soaked ≥1h and Luc types `promote`.
- I am not dispatching a TDD agent for any Wave until the PRD is signed off and Option C is live.

### Why this PRD exists

Three weeks ago, in-flight bug fixes and feature work landed on the same branch tenants were running, and a demo failed because the app was mid-refactor. This PRD encodes the lesson: tenant-facing code only changes when the founder explicitly says so, and the only way to enforce that is to physically separate dev and live infrastructure. Pillars 1 + 2 are the structural fix; Pillars 3 + 4 are the work that becomes safe to do once the structure exists.

---

**Sign-off:** Luc — please reply with `LGTM` to authorize Option C dispatch, or call out any module / story / sequencing change you want first.
