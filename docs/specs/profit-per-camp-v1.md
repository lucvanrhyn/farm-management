# Profit-Per-Camp lite v1 — build-ready spec

**Wave:** `wave/profit-per-camp-v1` (off `main`)
**Status:** specced 2026-06-14 (grilling session); build paused pending GitHub access
**Terms:** CONTEXT.md → Camp Profitability. **Decision:** ADR-0012 (income attribution).

## Why (one line)
Quick win #4, the money-clarity feature for commercial buyers: "which camp (and
per LSU / per hectare) actually makes you money" — built mostly by rolling up
finance calculators that already exist.

## What exists already (so this is genuinely "lite")
- `Transaction { campId?, animalId?, animalIds?, type, category, amount, … }`.
- `lib/server/financial-analytics.ts`: `getCostPerCamp` (with camp
  `sizeHectares`), `getCostPerAnimal`, `getProfitabilityByCategory`,
  `getFinancialKPIs`, `getBudgetVsActual`, `CampCostRow`, `CogByCampRow`.
- `lib/calculators/profitability-per-animal.ts` (`calcProfitabilityByAnimal`) —
  already allocates camp-tagged costs across a camp's animals.
- `cost-of-gain.ts`, `break-even.ts`, merged-LSU (species registry).

## What ships (the gap)
1. **Income attribution (last-camp rule, ADR-0012)** — credit a sale's income
   to the sold animal's `currentCamp` at sale time; batch sales split per animal.
2. **Per-camp profit roll-up** — `profit(camp) = Σ income (attributed) − Σ cost
   (campId or allocated)`, reusing `getCostPerCamp` + `calcProfitabilityByAnimal`.
3. **Per-LSU / per-hectare margin** — normalise by merged-LSU + `sizeHectares`.
4. **Unallocated line** — overhead (no animalId/campId) shown separately, never
   spread.
5. **Profitability screen** — per-camp table (profit, /LSU, /ha, cost-of-gain),
   sortable, with the unallocated line; period selector (default trailing 12mo).
6. **Einstein narration (optional v1)** — "Camp 7 is your top earner at
   R1,240/LSU; Camp 3 runs at a loss on feed cost." Rules compute; LLM narrates.

## Scope boundaries
- **Reporting view, not a second ledger** — `getFinancialKPIs` stays the
  authoritative farm total.
- Known limitation (ADR-0012): sale/holding-camp animals credit income to the
  holding camp; accepted for v1.
- **Online feature** — finance data is server-side (transactions); empty state
  prompts "log sales & costs to unlock." Not a 7-day-trial aha (it needs
  financial data entry) — this is the commercial-buyer value, consistent with
  its #4 rank.

## Reuse leverage
- ~80% exists: cost-per-camp, cost-of-gain-per-camp, per-animal allocation,
  per-ha via `sizeHectares`, merged-LSU.
- Net-new: income last-camp attribution + batch split, per-camp profit roll-up,
  per-LSU normalisation, unallocated line, the screen, optional narration, tests.

## Dependencies / sequencing
- Independent of Triage/Nudges/Briefing (different data domain). Can build any
  time; lowest "AI-leader" pull, highest commercial-buyer pull. Suggested order:
  after the three AI quick wins (1→2→3), then 4.

## TDD order (when build resumes)
1. income last-camp attribution + batch split (table tests).
2. per-camp profit roll-up (income − cost) on existing calculators.
3. per-LSU / per-ha normalisation.
4. unallocated line + period selector.
5. profitability screen; optional narration.
