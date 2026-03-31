# FarmTrack Phase 2 + Phase 3 Map — Design Spec

**Date:** 2026-03-31  
**Demo deadline:** 2026-04-03 (Friday)  
**Status:** Approved — ready for implementation

---

## Context

Phase 1 is fully shipped (build green). This spec covers Phase 2 features 7–11 and Phase 3 feature 14 (farm map). All features are additive — no existing pages are broken, only extended.

**Key constraints:**
- Costs are tracked at camp/farm level (not per animal). Per-head metrics are averages.
- Turso (libSQL) is the database. `Transaction` is a reserved SQL keyword — always quote it.
- Build command: `pnpm build --webpack` (never `--turbo`).
- All pages use `getPrismaForFarm(farmSlug)` + Promise.all pattern for data fetching.

---

## Feature 7 & 8: Gross Margin + Cost of Gain Analytics

**Location:** Extend `app/[farmSlug]/admin/finansies/page.tsx` — new analytics section below the existing transaction ledger.

### What it shows

Three summary cards rendered by a new `FinancialAnalyticsPanel` client component:

| Card | Metric | Formula |
|------|--------|---------|
| Gross Margin | ZAR | `sum(income) - sum(expenses)` for selected period |
| Gross Margin / Head | ZAR | `gross_margin / active_headcount` |
| Cost of Gain | R/kg | `sum(expenses) / total_kg_gained` for selected period |

Below the cards: a **cost breakdown bar chart** (recharts `BarChart`) showing expenses by category (feed, vet, labour, etc.) for the selected period.

### Date range picker

A `DateRangePicker` component (reused across features 7, 10) with presets:
- Last 30 days (default)
- Last 90 days
- Last 6 months
- Last 12 months
- Custom (from/to date inputs)

The picker updates URL search params (`?from=YYYY-MM-DD&to=YYYY-MM-DD`). The Finansies page reads `searchParams` to filter. Because Finansies is currently a client-driven page (FinansiesClient handles its own state), the analytics panel fetches its data via a new API route:

```
GET /api/[farmSlug]/financial-analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
```

Returns:
```ts
{
  grossMargin: number;
  grossMarginPerHead: number | null;  // null if no active animals
  costOfGain: number | null;          // null if no weight data
  totalIncome: number;
  totalExpenses: number;
  expensesByCategory: { category: string; amount: number }[];
}
```

### Server-side computation

**Gross margin:** Sum all `Transaction` rows in the date range. `income` type = positive, `expense` type = negative. Gross margin = income total − expense total.

**Per head:** Query `Animal.count({ where: { status: "Active" } })` at time of request.

**Cost of gain:** 
1. Query all `weighing` observations in the date range.
2. Per animal: find earliest weight in range (or last weight before range start) and latest weight in range.
3. Sum weight gained across all animals that have at least two readings bracketing the period.
4. `costOfGain = totalExpenses / totalKgGained`. Return null if totalKgGained ≤ 0.

### New files

| File | Purpose |
|------|---------|
| `lib/server/financial-analytics.ts` | `getFinancialAnalytics(prisma, from, to)` — pure server function |
| `components/admin/FinancialAnalyticsPanel.tsx` | Client component: date picker + 3 stat cards + bar chart |
| `app/api/[farmSlug]/financial-analytics/route.ts` | GET endpoint calling `getFinancialAnalytics` |

### Finansies page change

Add `<FinancialAnalyticsPanel farmSlug={farmSlug} />` at the bottom of the page JSX — no change to existing FinansiesClient.

---

## Feature 9: Camp Performance League Table

**Location:** New page `app/[farmSlug]/admin/league/page.tsx`  
**Nav:** Add "League" link to the admin sidebar/nav (wherever other admin links live).

### What it shows

A ranked table of all camps, sorted by a primary metric (default: ADG). Columns:

| # | Column | Source |
|---|--------|--------|
| 1 | Rank | Computed |
| 2 | Camp Name | `Camp.campName` |
| 3 | Avg ADG (kg/day) | Mean of all active animals' `rolling90Adg` in camp |
| 4 | Headcount | `Animal.count` where `currentCamp = campId AND status = Active` |
| 5 | LSU/ha | Existing formula from PerformancePage |
| 6 | Condition | Latest `camp_condition` observation |
| 7 | Days Grazing Left | From `CampCoverReading` + `calcDaysGrazingRemaining` |
| 8 | Last Inspection | Latest `camp_condition` observation date |

**Sorting:** Clicking any column header re-sorts. Rank column always reflects current sort order.

**Visual indicators:**
- Rank badge: gold/silver/bronze medal for top 3 by ADG.
- ADG cell: green if avg > 0.9, amber if 0.7–0.9, red if < 0.7.
- Condition cell: colored dot matching the existing Good/Fair/Poor scheme.
- Days Grazing: red if ≤ `campGrazingWarningDays`, amber if ≤ 2×, green otherwise.

**Each row links to:** `/{farmSlug}/admin/camps/{campId}`

### Server-side computation

The page server component queries:
1. All camps.
2. For each camp in parallel: active animals, their latest weight observations (to compute avg ADG), latest camp condition, latest cover reading.
3. ADG per camp = average of each active animal's best available ADG (rolling90 → longRun → lastInterval). Animals with no weight data are excluded from the average (but counted in headcount).

### New files

| File | Purpose |
|------|---------|
| `lib/server/league-analytics.ts` | `getCampLeagueData(prisma, farmSlug, thresholds)` → `CampLeagueRow[]` |
| `app/[farmSlug]/admin/league/page.tsx` | Server page — fetches league data, renders LeagueTable |
| `components/admin/LeagueTable.tsx` | Client component — sortable table with rank badges |

---

## Feature 10: Date Range Picker (Grafieke, Reproduction, Performance)

**Approach:** Per-page URL search params. Each analytics page becomes `force-dynamic` (already is) and reads `searchParams` to filter its queries.

### DateRangePicker component

`components/admin/DateRangePicker.tsx` — client component.

Props:
```ts
{ defaultDays?: number }  // default 90
```

Behaviour:
- Renders preset buttons + optional custom date inputs.
- On change: calls `router.replace` with updated `?from=&to=` params (shallow navigation).
- Reads current params on mount to restore state from URL.

### Pages to update

| Page | Change |
|------|--------|
| `grafieke/page.tsx` | Read `from`/`to` searchParams; pass to analytics functions as date filters; add `<DateRangePicker>` at top of GrafiekeClient (via prop). |
| `reproduction/page.tsx` | Same pattern — filter calving and reproduction analytics by date range. |
| `performance/page.tsx` | Add date range filter to condition/cover queries; add `<DateRangePicker>`. |

### Analytics function changes

Each server analytics function already accepts Prisma. Add optional `from?: Date, to?: Date` parameters to:
- `getCampConditionTrend` — already takes `lookbackDays`; add explicit date override.
- `getHealthIssuesByCamp` — same.
- `getHerdAdgTrend` — already takes `lookbackDays`; add explicit date override.
- `getReproStats` — add date range filter.

The `lookbackDays` default is kept for backwards compatibility; if `from`/`to` are passed they take precedence.

---

## Feature 11: Data Health Score

**Location:** New card in the existing admin dashboard (`app/[farmSlug]/admin/page.tsx`) — inserted into the bottom grid as a 4th card (grid is currently 3 wide on desktop; becomes a full-width card below the grid or the 4th cell).

### Score computation

`getDataHealthScore(prisma, thresholds)` in `lib/server/data-health.ts`:

```ts
interface DataHealthScore {
  overall: number;   // 0–100
  grade: "A" | "B" | "C" | "D";
  breakdown: {
    animalsWeighedRecently: { score: number; pct: number; label: string };
    campsInspectedRecently: { score: number; pct: number; label: string };
    animalsWithCampAssigned:  { score: number; pct: number; label: string };
    transactionsThisMonth:    { score: number; present: boolean; label: string };
  };
}
```

Scoring rules:

| Dimension | Weight | Calculation |
|-----------|--------|-------------|
| Animals weighed in last 30 days | 40% | `weighedCount / activeCount` capped at 100% |
| Camps inspected in last 7 days | 30% | `inspectedCount / totalCamps` capped at 100% |
| Animals with camp assigned | 20% | `assignedCount / activeCount` |
| Any transactions recorded this month | 10% | Binary: 10 if yes, 0 if no |

Overall = weighted sum. Grade: A ≥ 80, B ≥ 60, C ≥ 40, D < 40.

### DataHealthCard component

`components/admin/DataHealthCard.tsx` — displays:
- Large letter grade (A/B/C/D) with colour (green/amber/amber/red).
- Overall score as a progress bar.
- 4 dimension rows with individual progress bars and percentage labels.
- Title: "Data Health".

---

## Feature 14: Interactive Farm Map

**Location:** New page `app/[farmSlug]/admin/map/page.tsx`  
**Nav:** Add "Map" link to admin sidebar.

### What it shows

The existing `FarmMap` component wired with live data:
- Camp polygons from `Camp.geojson` (GeoJSON strings).
- Each polygon color-coded by camp condition: green (Good), amber (Fair), red (Poor), grey (no data).
- Stock count badge overlaid on each polygon centroid.
- Click → `CampPopup` showing: camp name, headcount, condition, LSU/ha, last inspection date, days grazing remaining.

### Data fetching

The page server component queries (in parallel):
1. All camps with `geojson`.
2. Latest `camp_condition` observation per camp.
3. Active animal count per camp.
4. Latest `CampCoverReading` per camp.

Assembled into `CampMapFeature[]`:

```ts
interface CampMapFeature {
  campId: string;
  campName: string;
  geojson: string;          // GeoJSON polygon string
  condition: "Good" | "Fair" | "Poor" | null;
  headcount: number;
  lsuPerHa: number | null;
  lastInspection: string | null;  // ISO date
  daysGrazingLeft: number | null;
}
```

Passed as `features` prop to `FarmMap`.

### FarmMap wiring

The existing `FarmMap.tsx` likely renders Maplibre GL. We pass `features` and:
- `CampPolygon` renders each polygon with `fill-color` based on `condition`.
- `CampPopup` renders on click with the feature data.
- A legend in the top-right corner (Good/Fair/Poor/No data).

If `Camp.geojson` is null for a camp, that camp is skipped on the map (shown in a fallback list below the map instead).

### New files

| File | Purpose |
|------|---------|
| `app/[farmSlug]/admin/map/page.tsx` | Server page — queries camp map data |
| `lib/server/map-analytics.ts` | `getCampMapFeatures(prisma)` → `CampMapFeature[]` |

`FarmMap`, `CampPolygon`, `CampPopup` are wired — not rewritten. Minimal prop changes only.

---

## Implementation Order (demo priority)

Given the Friday deadline, implement in this order:

1. **Feature 10** — DateRangePicker component + wire into Performance page (highest demo value, low risk)
2. **Feature 9** — Camp League Table (visually impressive, data already mostly exists in PerformancePage)
3. **Feature 7/8** — Gross Margin + Cost of Gain analytics panel on Finansies
4. **Feature 11** — Data Health Score card on dashboard
5. **Feature 10 (continued)** — Wire DateRangePicker into Grafieke + Reproduction
6. **Feature 14** — Farm Map page

---

## What is NOT in scope

- Per-animal cost tracking (costs remain camp/farm level)
- Budget forecasting or projections
- Real-time push updates
- New Prisma schema migrations (all features use existing data)
- Breaking changes to existing pages
