# FarmTrack Overhaul — Frozen-Design Rebuild Spec

**Goal:** rebuild the production app UI so each screen is *identical* to the approved
frozen design (desktop + phone). The skin (retro / teal `#2E7D72` / sharp corners /
hard 4px-offset shadows / DM Serif + Space Grotesk + Space Mono) is ALREADY live in
prod — **the gap is LAYOUT COMPOSITION**, not tokens.

## Sources of truth (read these)
- **Live runnable prototype** (the spec): served at `http://localhost:8842/FarmTrack-Live-Desktop.html` and `.../FarmTrack-Live-Phone.html`. "Whatever renders is the spec."
- **Prototype source** (real React that produces it): `/Users/lucvanrhyn/Downloads/FarmTrack_Overhaul_extracted/claude-code-handoff/` — `app.desktop.jsx` (`TWEAK_DEFAULTS`, `AreaDock`), `adminlayouts.jsx` (`OvCommand` = desktop Operations), `home.jsx`, `map.jsx`/`mapmobile.jsx`, `logger.jsx`/`loggercamp.jsx`, `chat.jsx` (Einstein), `adminmobile.jsx` (phone admin), `data.js` (`window.DOMAINS`).
- **Reference screenshots** (pixel targets): `/Users/lucvanrhyn/Downloads/_spec_extract/desktop/desk_1..5.jpg` (Overview, Animals, Map, Trio B Boerdery=Home, AI Advisor) and `/Users/lucvanrhyn/Downloads/_spec_extract/phone/phone_1..5.jpg` (Launcher, Overview, Camp Rounds, Map, AI Advisor).
- **Build instructions:** `/Users/lucvanrhyn/Downloads/FarmTrack_Overhaul_extracted/claude-code-handoff/BUILD-INSTRUCTIONS.md`.

## Frozen config (LOCKED — only these branches render)
skin `retro` · accent teal `#2E7D72` (hover darker teal, NEVER rust) · headline DM Serif Display · UI Space Grotesk · mono Space Mono · bg aurora.
Home: desktop `rail`, phone `cover`, theme cream. Operations/Admin: layout `command`, nav `studio`, KPIs `tiles`, theme paper, records drawer, radius 16. Admin phone: layout `stat`, nav `dock`. Map: satellite, desktop `split`, phone `overlay`, polygons fill, labels pill, live pins. Logger: phone-first, grid `tiles`, camp `actions`, theme paper, actions `sheet`. Motion: card hover lift, primary button sheen+magnetic+ripple, card border-beam, AI-brief beam, KPI count-up, area-switch fade. Global: bottom-right `AreaDock` island ON.

## Measured desktop Operations metrics (from live prototype @1440px — EXACT)
- Container: `padding:28px 32px 80px; max-width:1560px; margin:0 auto`.
- H1 "Operations": DM Serif Display, **36px / weight 500**, letter-spacing -0.02em; sub mono 12px muted "`<date>` · control room". Right actions: `Export` (ghost/outline btn) + `Ask <Assistant>` (primary teal btn).
- KPI ribbon: `display:grid; grid-template-columns:repeat(6,1fr); gap:10px; margin-top:20px`. SIX tiles.
- KPI tile (`DomainTile`): `Card padding:15px`; top row = icon in **32px square** (`border-radius:var(--ft-r-sm)`, bg `--ft-accent-faint`, color `--ft-accent`, icon size 17) + **7px status dot** (top-right). Then value **23px / weight 500** tabnums + unit (mono 11px subtle). Then label **9.5px** uppercase (`.ft-label`). Then sub 11.5px muted, line-height 1.35. Whole tile is a `Link` to its target. count-up on value via `data-ft-ticker`.
- Body grid: `display:grid; grid-template-columns:1.3fr 1fr .9fr; gap:16px; margin-top:18px; align-items:start` (measured 546/420/378px). Responsive: collapse to 1-col `<lg`.
  - **Col 1 (1.3fr):** crit alert strip (`padding:13px 18px; background:var(--ft-crit-bg); border:1px solid color-mix(in oklab,var(--ft-crit) 35%,transparent); border-radius:var(--ft-r); color:var(--ft-crit)`; alert icon + text) → `DoNextPanel` → `NeedsAttentionPanel`.
  - **Col 2 (1fr):** Einstein "Today's Brief" `.ft-brief` card (existing markup is correct) → Recent Activity card.
  - **Col 3 (.9fr):** `WeatherWidget` (compact) → "Feed on Offer · 30d" card (Label + `Spark w=220 h=48 color=--ft-fair` + caption).

## The 6 domain tiles (from data.js window.DOMAINS) → REAL data mapping
NEVER fabricate. Map each to real values from `getCachedDashboardOverviewByMode`/`...Shared` + `reproStats`:
1. **Animals** — icon `animals`, href `/admin/animals`, value `totalAnimals`, unit `head`, sub `<healthIssuesThisWeek> health flags · <withdrawalCount> in withdrawal` (or "all clear"), tone good. **KEEP literal text `Total Animals` adjacent to the value digits** (3 e2e specs grep it — see Constraints). Use label "Total Animals".
2. **Breeding** — icon `breeding`, href `/admin/reproduction`, value `reproStats.scanCounts.pregnant`, unit `in calf`, sub `<pregnancyRate>% conception · <calvingsDue30d> calving 30d` (degrade gracefully when null/0), tone good.
3. **Camps** — icon `camps`, href `/admin/camps`, value `totalCamps`, unit `camps`, sub `<lowGrazingCount> below 7d grazing` or "grazing steady", tone crit/good. **KEEP literal `Total Camps` adjacent to digits** (e2e).
4. **Grazing** — icon `grass`, href `/admin/grazing`, value = real grazeable count from `grazingCounts` (e.g. Good+Fair), unit `grazing`, sub `<poor+overgrazed> need rest · feed <trend>`, tone fair.
5. **Finance** — icon `finance`, href `/admin/finansies`, value `mtdFormatted` (real MTD), unit `MTD`, sub real margin if derivable else "month to date", tone good/poor. (basic tier hides — keep 5 tiles then.)
6. **Compliance** — icon `reports`, href `/admin/compliance` (or data-health route), value = REAL `dataHealth.score`%, unit `complete`, sub real completeness breakdown. (No farm "compliance %" metric exists — dataHealth is the truthful proxy; label it truthfully, e.g. "Records".)
- **Inspections** invariant: `dashboard-counter-stability.spec.ts` greps `(\d+)/(\d+) ... Inspections Today` and asserts denominator==Total Camps. Preserve a real `inspectedToday/totalCamps` render adjacent to the literal `Inspections Today` (put it in the Camps tile sub OR keep test passing by updating the spec to the new location — do NOT silently drop the invariant).

## Relocate (decision: "match spec, relocate extras — nothing lost")
Spec Operations ends after the 3-col body. The extra production cards move into a **collapsed `<details>` "More" section** below the body (default-closed so the above-fold view matches the reference exactly): Reproductive Overview, Weekly Briefing (`ThisWeekBriefing`), Camp Status Summary, Quick Actions, `DataHealthCard`, `DangerZone`. Nothing deleted.
- Remove the standalone `WeatherWidget` block from `app/[farmSlug]/admin/page.tsx` (it now lives in body col 3).

## Constraints
- **e2e anchors (do not break):** `e2e/admin-journey.spec.ts`, `e2e/dashboard-counter-stability.spec.ts`, `e2e/multi-species-toggle.spec.ts` grep HTML for digits immediately followed by `Total Animals` / `Total Camps` / `Inspections Today` (regex `(\d[\d,]*)\s*(?:</[^>]+>\s*)*<label>`). The value span must sit directly before the label text with only closing tags between. If a label MUST change, update the spec's regex + `getByText` in the SAME change and keep the underlying invariant.
- Keep `{" "}` explicit space in the low-grazing alert (#369 SWC whitespace strip).
- Server components stay server; interactive panels stay client. Token-driven styles only (`--ft-*`), retro radius/shadows.
- `pnpm build` (`prisma generate && eslint && next build`) must pass; `pnpm test` (vitest) green.

## Verification (the user demands real proof — no false "done")
1. Local: build a no-auth layout harness route, screenshot at 1440 desktop, diff vs `desk_1.jpg` + live prototype (grid ratios, gaps, tile sizes, fonts). Delete harness before merge.
2. Authed: deploy preview / prod, log in `luc / Batman69` (trio-b active) via playwright-cli, screenshot each screen at desktop(1440) + phone(390), side-by-side vs the reference jpgs. Report measured deltas honestly.

## Screen status
- [ ] Desktop Operations (`OvCommand`) — components/admin/DashboardContent.tsx + app/[farmSlug]/admin/page.tsx
- [ ] Phone Operations ("stat" — adminmobile.jsx → phone_2.jpg)
- [ ] Home desktop "rail" / "Trio B Boerdery" masthead (home.jsx → desk_4.jpg) + phone "cover" (phone_1.jpg)
- [ ] Animals table (desk_2.jpg)
- [ ] Einstein / AI Advisor (chat.jsx → desk_5.jpg / phone_5.jpg)
- [ ] Map split desktop + overlay phone (map.jsx/mapmobile.jsx → desk_3.jpg / phone_4.jpg)
- [ ] Logger Camp Rounds phone (loggercamp.jsx → phone_3.jpg)
