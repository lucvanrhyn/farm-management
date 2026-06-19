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

## Verify harness
- Refs: node /tmp/ft_ref_capture.mjs (needs `python3 -m http.server 8899` in handoff dir).
- Live: FT_BYPASS=<vercel share> FT_SLUG=trio-b-boerdery node /tmp/ft_verify.mjs <preview> /tmp/ft_live live
- Creds luc/Batman69. Anchors: data-ft-kpi / data-ft-kpi-value / data-ft-inspections.
