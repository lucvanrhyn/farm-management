# Asymmetric route shape: cattle stays at `/admin`, sheep gets `/sheep`

**Status:** accepted (2026-05-12)

## Context

PRD #222 closes the cosmetic-toggle gap surfaced by the 2026-05-12 stress test: the `FarmMode` switcher writes a cookie but the dashboard, `/api/farm`, `/api/mobs`, the map, and the logger camp tiles all ignore it. While we're rewriting that surface to consult `getFarmMode(farmSlug)`, we have to decide what the route tree looks like.

Two shapes were on the table:

1. **Symmetric** — `/admin/animals` becomes `/cattle/animals` and `/sheep/animals`; a top-level redirect points `/admin/*` at `/cattle/*` for legacy URLs.
2. **Asymmetric** — cattle stays at `/admin/*` exactly where existing customers' bookmarks already point; sheep gets a parallel namespace at `/sheep/*` that mirrors the admin tree page-for-page.

The deciding constraint is the **existing customer base**: Basson Boerdery has been running on `/admin/*` since the multi-tenant cutover, every saved bookmark and Vercel preview link in their team's slack threads points at `/admin/animals`, `/admin/camps`, `/admin/observations`, and forced-renaming the cattle namespace would break URLs that humans use every day. A redirect layer would cover the bookmarks for a release or two, but it would also forever leave `/cattle/*` and `/admin/*` as parallel cached entries in Serwist, two sets of canonical URLs in any analytics, and two sets of nav-handler code paths to keep in sync. The symmetric rename is cleaner on paper and worse in practice.

## Decision

Adopt the **asymmetric** shape:

- **Cattle URLs do not change.** `/admin/animals`, `/admin/camps`, `/admin/observations`, `/admin/map`, `/admin/breeding-ai`, `/admin/breeding-history`, `/admin/methodology`, etc. continue to serve the cattle-mode view (with `mode = cattle` filters applied via the species-scoped Prisma facade from issue #224).
- **Sheep gets a parallel namespace at `/sheep/*`.** Slices #227 (`/sheep` landing redirect), #228 (`/sheep/animals`), #229 (`/sheep/camps`), and #231 (`/sheep/observations`) build out the sheep-mirror of the existing admin tree, page-for-page, with `mode = sheep` filters baked into the queries.
- **The FarmMode toggle hot-swaps the user between the two trees.** Flipping to sheep at `/admin/animals` redirects (via the `/sheep` landing handler in #227) to `/sheep/animals`. Flipping to cattle at `/sheep/animals` lands back at `/admin/animals`. The cookie still gates server reads; the route swap is for navigation continuity.
- **No URL aliases.** We do not introduce `/cattle/*` or `/livestock/*`. Adding aliases makes the canonical URL ambiguous, doubles the Serwist cache surface, and lets analytics fragment across two paths for the same view.

## Why this and not the alternatives

### Why not symmetric `/cattle/*` + `/sheep/*`

The architecturally pleasing answer is "treat both species the same — they're both first-class." The product reality is that one of the two species (cattle) has been in production since the original launch and the other (sheep) is being lit up for the first time as part of this PRD. The work of forced-renaming `/admin/*` to `/cattle/*` is a customer-visible URL break that buys us nothing except symmetry on paper. The cookie + filter work that has to happen anyway (#224 through #234) does the actual isolation; the directory layout is window dressing on top.

A future PRD could revisit this if a third species (game, goats) lands and the asymmetry starts to feel arbitrary. At that point the rename would be one wave of work on top of an already-isolated codebase, which is a much cheaper migration than the symmetric rename would be today (where the cookie isn't even read on most pages).

### Why not put sheep at `/admin/sheep/*`

A nested `/admin/sheep/animals` would re-use the admin layout, which sounds appealing — but the admin layout is full of cattle-coded copy ("Cow", "Bull", "Lambing"-or-"Calving" toggles in some places) and cattle-specific tiles. Untangling that to make one layout serve both species is the same amount of work as forking the tree, with the additional cost of having to do it inside an already-busy admin namespace. The fork at `/sheep/*` gets us a clean sheep-coded layout (`app/[farmSlug]/sheep/layout.tsx` already exists with its own `SheepSubNav`) and leaves the admin layout free to stay cattle-coded — which mirrors the actual product split rather than papering over it.

### Why not redirect `/admin/*` → `/cattle/*`

This is the symmetric option dressed up as a "non-breaking" migration. It's not — every saved URL becomes a 308, every Serwist cache entry has to be invalidated, every external link (email reminders, PDF exports with deep links, the marketing site's onboarding flow) has to be updated. The redirect is a tax we'd pay forever on a rename we don't need.

## Implementation consequences

- The species-scoped Prisma facade (#224) is the **structural** isolation. Every Prisma query for `Animal`, `Camp`, `Observation`, `MobMembership`, etc. flows through `scoped(mode).animal.findMany(...)` so "forget the species filter" becomes a compile error. The route shape is a presentation layer concern on top of that.
- `/admin/*` pages call `getFarmMode(farmSlug)` and pass `mode` through to the facade. They render correctly for both `cattle` and `sheep` modes — but in practice a sheep-mode user navigating to `/admin/animals` will be bounced to `/sheep/animals` by the toggle handler, so the admin tree is effectively cattle-mode-only at the UX layer.
- `/sheep/*` pages are mirrors of their `/admin/*` counterparts. Slices #228/#229/#231 each port the existing admin page logic through the facade rather than rebuilding from scratch — the cattle and sheep versions of "animals list" should diverge only where the species genuinely requires it (e.g., lambing vs calving terminology).
- The single-species upsell pill (#235) renders only when the farm has one species enabled — so a cattle-only farm doesn't see the dormant `/sheep` namespace at all in nav, and the toggle is presented as an upsell. The asymmetric layout supports this because `/admin/*` is the default-everywhere tree; `/sheep/*` only appears when the farm activates sheep.
- The E2E lockdown test (#236) drives the toggle journey through both trees and asserts the redirects + filter behavior hold.

## Rollout

ADR-0003 ships as a single PR off `wave/223-adr-route-shape`. The decision unblocks slices #227, #228, #229, #231, and #232, which can dispatch in parallel (or as the bundled Wave 3 agent per the wave plan) once it lands.

No code changes ship with this ADR — it documents the decision so the implementation slices can cite it and so future contributors don't re-litigate the symmetric vs asymmetric question.
