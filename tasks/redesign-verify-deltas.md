# Redesign Verification — Delta Findings & Fix Plan (2026-06-19)

Verified live preview (f815c38, dpl_Gjne…) vs frozen prototype (claude-code-handoff/
FarmTrack-Live-*.html). Reference renders captured to /tmp/ft_ref/{desktop,phone}/*.png
(via request-rewrite of baked `startScreen`). Live captures /tmp/ft_live/live_*_*.png.

## Strong matches — NO fix needed
- Desktop Home (rail masthead) ✓  · Phone Home (cover launcher) ✓
- Desktop Einstein ✓ (minor: missing 4 suggested prompts) · Phone Einstein ✓
- Phone Logger ✓  · Desktop Logger (full-bleed vs framed = acceptable presentation)
- Desktop Map ✓ structure (camps panel, layer tabs, 8-mode tabs) · Phone Map ✓ structure
  - data-driven: map zooms to globe (trio-b has NO polygon geometry, #396 operator task)

## Deltas to FIX
- [x] P1 GLOBAL — Methodology nudge banner on every admin surface (ops/animals/einstein/map).
      NOT in reference. Source: app/[farmSlug]/admin/layout.tsx:205 <MethodologyNudgeBanner>.
      No tests reference it. → remove from layout (component stays in repo).
- [ ] P2 Desktop Operations — Col-1 is giant DoNext "Do soon" weigh-in stack + extra bottom
      sections (TEAM sparklines, dup NEEDS ATTENTION); page ~4x too tall.
      Reference Col-1 = pink CritBanner + compact NEEDS ATTENTION only.
      → DashboardContent Col-1: keep alerts + NeedsAttentionPanel; move DoNextPanel +
        extras into the existing `<details className="ft-more">`. Trim trailing sections.
- [ ] P3 Phone Operations — reflowed desktop layout instead of frozen `stat` composition.
      Target = PA_OverviewStat (adminmobile.jsx:96): Header → hero Card(big serif 875 +
      "animals across N camps" + Spark) → 3-stat grid (Total camps/Health issues/Inspected
      today) → BriefPeek → NeedsAttention. Gate via CSS: desktop `command` = `hidden lg:block`,
      phone `stat` = `lg:hidden`. KEEP data-ft-kpi anchors in the always-present desktop markup.
- [ ] P4 Desktop Animals — filter bar uses Camp/Status dropdowns; reference = animal-TYPE chips
      (All/Cow/Bull/Heifer/Weaner/Calf). Rows render empty WEIGHT/ADG/STATUS/TREND (data-driven
      for trio-b, but STATUS pill should show for active animals). Separate file: AnimalsTable.tsx.

## Tests fixed this session (operations rebuild fallout) — DONE
- __tests__/app/map-camps-crossspecies.test.tsx — added animal.groupBy mock (head-count rollup).
- e2e/multi-species-toggle.spec.ts — 3 "Total Animals" visibility gates → [data-ft-kpi="animals"].
- dashboard/map unit set 32/32 green; tsc clean.

## Session 2 (2026-06-19 cont.) — Einstein polish + phone-map de-congestion
- [x] EINSTEIN desk_5 — composer was bottom-pinned (md:h-[calc(100dvh-62px)]) with a
      large gap under the brief. Removed the viewport height-pin (page.tsx) + the
      panel's `h-full min-h-0`; empty transcript now collapses so the composer flows
      directly under the brief. Added the 4 frozen suggested-prompt chips in a
      labelled 2-up grid below the composer (DEFAULT_SUGGESTED_PROMPTS). Composer
      chrome: Advisor pill → leading search glyph; circular send arrow → "ASK" pill
      (both gated on `bareComposer`, phone bottom-sheet untouched; advisorMode={false}).
- [x] MAP phone congestion (user-flagged) — the always-open 9-row LayerToggle panel
      overlaid a large slice of the narrow map. Collapsed to a floating layers
      launcher <640px (data-collapsed flag + CSS-media gate); tap to open, × to
      re-collapse. Desktop byte-for-byte unchanged. Test-safe (panel stays in DOM;
      hide rule is media-gated to ≤640 which jsdom@1024 never matches). 45/45 green.
- Commit 609568f on wave/overhaul-redesign-2026-06-19. Build OK. Deploy
  dpl_EfXkQLuhMYcab8V2uX3BaYoZBbqZ (farm-management-20c7rgvyd-…) READY.
- [x] VERIFIED LIVE (authed luc/trio-b, /tmp/ft_live3/): einstein desktop+phone now
      match desk_5 (composer flows under brief, search glyph + ASK pill, 4-chip
      SUGGESTED PROMPTS grid 2-up desktop / 1-col phone). Phone map de-congested —
      default = clean map + collapsed launcher; tap launcher → panel opens (× to
      close) → re-collapses (interaction confirmed via ft_map_expand.mjs).
## Session 3 (2026-06-19 cont.) — desktop map collapse + PROMOTE
- [x] MAP desktop collapse (user: "also do that for the desktop map … make it
      collapse"). Unified the launcher/collapse to ALL breakpoints — removed the
      ≤640px gate from the show/hide rules in LayerToggle's `MOBILE_REANCHOR_CSS`;
      the panel now starts collapsed behind the floating launcher on desktop too
      (matches the reference, which shows no floating panel). Kept the phone-only
      re-anchor (≤640 → top:96) so desktop keeps its bottom-right anchor when open.
      SSR-safe (collapsed flag starts `true` both sides; panel always in DOM, only
      `display` flips). Tests updated to open the launcher first:
      LayerToggle.test.tsx (7/7 green) + e2e/map-mobile-controls.spec.ts (creds-
      gated, kept correct). `next build` OK.
- [x] VERIFIED LIVE — see deploy + screenshots recorded below once promoted.
- PROMOTE: Luc gave explicit go-ahead ("promote everything, merge … so it is
  live"). PR → squash-merge to `main`; Vercel git-integration deploys to
  app.farmtrack.app. No new migrations in this wave (UI + test only).

## Verify harness
- Refs: node /tmp/ft_ref_capture.mjs (needs `python3 -m http.server 8899` in handoff dir).
- Live: FT_BYPASS=<vercel share> FT_SLUG=trio-b-boerdery node /tmp/ft_verify.mjs <preview> /tmp/ft_live live
- Creds luc/Batman69. Anchors: data-ft-kpi / data-ft-kpi-value / data-ft-inspections.
