# FarmTrack Phase 1B — Reproductive KPIs + Full Connectivity Design

**Date:** 2026-03-26
**Status:** Approved
**Scope:** Expands original Phase 1B + folds in Phase 2B (animal lifecycle tabs)

---

## Overview

Phase 1B enhances the Reproductive Performance dashboard with SA-benchmarked KPI cards,
adds a calving observation type to the Logger, surfaces a reproduction summary on the admin
Overview page, and delivers a fully tabbed animal detail page with lifecycle history.

All data fetching follows the existing server-component pattern (direct Prisma queries,
no client-side fetching, no new API routes).

---

## Scope

1. `"calving"` observation type in Logger
2. `lib/server/reproduction-analytics.ts` — extracted KPI calculation module
3. Enhanced `/admin/reproduction` page — 6 SA-benchmarked KPI cards
4. Admin Overview page — Reproductive Overview summary card
5. Tabbed animal detail page — Overview / Reproduction / Health / Movement / Weight & ADG

---

## Section 1: Data Layer

### New observation type

Add `"calving"` to `ObservationType` union in `lib/types.ts`:

```ts
// details shape
{ calf_status: "live" | "stillborn", calf_tag?: string, notes?: string }
```

No Prisma schema change needed. Uses existing `campId`, `animalId`, `observedAt` fields.

### New file: `lib/server/reproduction-analytics.ts`

Exports a single entry-point function and its return type:

```ts
export interface ReproStats {
  pregnancyRate: number | null;        // pregnant scans / eligible females × 100
  calvingRate: number | null;          // live calvings / cows mated × 100
  avgCalvingIntervalDays: number | null; // avg days between consecutive calvings per animal
  upcomingCalvings: UpcomingCalving[]; // sorted by daysAway asc
  inHeat7d: number;
  inseminations30d: number;
  calvingsDue30d: number;
  scanCounts: { pregnant: number; empty: number; uncertain: number };
  conceptionRate: number | null;       // pregnant / (pregnant + empty) × 100
}

export async function getReproStats(prisma: PrismaClient): Promise<ReproStats>
```

**Formula details:**

| KPI | Formula | Notes |
|-----|---------|-------|
| Pregnancy Rate | pregnant scans ÷ all females with ≥1 repro event in 12m window | Denominator: `Animal.sex = "Female"` with any repro obs in 12m |
| Calving Rate | live calvings ÷ inseminations (12m window) | Null if 0 inseminations |
| Avg Calving Interval | avg(calving_n+1 − calving_n) per animal | Only animals with ≥2 calving obs |
| Upcoming Calvings | latest `pregnancy_scan` date + 285d; fallback: insemination + 285d | Shows next 90d + up to 7d overdue |

`getReproStats` is called from both the reproduction page and the admin overview page.

---

## Section 2: Logger — Calving Form

**File:** `app/[farmSlug]/logger/[campId]/page.tsx`

Add a **Calving** tab alongside existing Heat / Insemination / Scan tabs.

**Form fields (mobile-first, max 3):**
1. **Animal tag** — text input (which dam calved)
2. **Calf status** — toggle: `Live calf` (default) / `Stillborn`
3. **Calf tag** — optional text input

`observedAt` defaults to `new Date()`. Goes through `queueObservation()` → IndexedDB → sync. No special offline handling.

**Observation stored as:**
```ts
{
  type: "calving",
  animalId: damTag,
  campId: currentCampId,
  details: JSON.stringify({ calf_status, calf_tag }),
}
```

---

## Section 3: Enhanced `/admin/reproduction` Page

**Data:** Calls `getReproStats(prisma)` replacing all inline calculations.

### KPI grid — Row 1: Rate KPIs (3 cards)

| Card | Value | Green | Amber | Red |
|------|-------|-------|-------|-----|
| Pregnancy Rate | % | ≥85% | 70–84% | <70% |
| Calving Rate | % | ≥85% | 70–84% | <70% |
| Avg Calving Interval | days | ≤365d | 366–395d | >395d |

Empty state (no calving obs): sub-text "Log calving events via Logger", status `neutral`.

### KPI grid — Row 2: Activity KPIs (3 cards)

| Card | Value |
|------|-------|
| In Heat (7d) | count |
| Inseminations (30d) | count |
| Calvings Due (30d) | count (uses scan date + 285d if available) |

### Sections below KPI grid (unchanged except calving events added to timeline)

- Expected Calvings table
- Pregnancy Scan Results
- Recent Events timeline — adds `"calving"` events with 🐮 icon

---

## Section 4: Admin Overview — Reproductive Overview Card

**File:** `app/[farmSlug]/admin/page.tsx`

Calls `getReproStats(prisma)` in the existing `Promise.all` block.

**New card added to the bottom grid:**
- Title: "Reproductive Overview"
- 3 inline stats: Pregnancy Rate % · Calvings Due (30d) · In Heat (7d)
- Conditional warning: amber text "Below SA target" if pregnancy rate < 70%
- Footer: "View Reproduction →" link to `/{farmSlug}/admin/reproduction`
- Empty state: "No reproductive events recorded yet" + "Start in Logger →"

**Grid change:** Bottom section shifts from `xl:grid-cols-2` → `xl:grid-cols-3`.

---

## Section 5: Tabbed Animal Detail Page

**File:** `app/[farmSlug]/admin/animals/[id]/page.tsx`

**Data fetch:** Single `prisma.observation.findMany({ where: { animalId: id } })` added to existing query block. Observations grouped by type in component logic.

### Tab bar

```
[ Overview ] [ Reproduction ] [ Health ] [ Movement ] [ Weight & ADG ]
```

Active tab controlled by `?tab=` search param (server-readable, no client state needed).

### Tab: Overview (default)
Existing animal info card — tag, category, camp, status, breed, DOB, notes. Unchanged.

### Tab: Reproduction
Chronological timeline of all repro observations for this animal.
- Each entry: date · event type badge · detail (scan result / method / calf status) · logged-by
- Colour system matches `/admin/reproduction` page (heat=pink, insem=amber, scan=green, calving=teal)
- Connects to the reproduction page: "View all farm repro →" link in card header
- Empty state: "No reproductive events recorded for this animal"

### Tab: Health
All `health_issue` observations, newest first.
- Date · symptoms list · severity badge · treatment · logged-by
- Empty state: "No health issues recorded"

### Tab: Movement
All `animal_movement` observations.
- From camp → To camp · date · logged-by
- Camp names resolved via camp lookup map
- Empty state: "No movement records"

### Tab: Weight & ADG
Placeholder — ships now, fills when Phase 1C is deployed.
- Header: "No weighing sessions recorded yet"
- Sub: "Weigh this animal to track daily gain"
- Button: "Start weighing session" — rendered as a non-clickable dimmed badge labelled "Coming in next update"
  (Phase 1C route does not exist yet; do NOT render a broken link)
- Empty chart area with dashed border and "Weight data will appear here" caption

---

## Files Changed / Created

| File | Action |
|------|--------|
| `lib/types.ts` | Add `"calving"` to ObservationType |
| `lib/server/reproduction-analytics.ts` | New — all KPI functions |
| `app/[farmSlug]/logger/[campId]/page.tsx` | Add Calving tab + form |
| `app/[farmSlug]/admin/reproduction/page.tsx` | Replace inline logic with analytics module, new KPI grid |
| `app/[farmSlug]/admin/page.tsx` | Add repro summary card, expand grid to 3 cols |
| `app/[farmSlug]/admin/animals/[id]/page.tsx` | Add tab bar + 5 tab sections |

---

## Connectivity Map

```
Admin Overview
  └── Reproductive Overview card → /admin/reproduction

/admin/reproduction
  └── Animal IDs in tables/timeline → /admin/animals/[id]?tab=reproduction

/admin/animals/[id]
  └── Reproduction tab ← fed by repro obs from logger
  └── Weight & ADG tab → /logger/[campId]/weighing (Phase 1C)

Logger /logger/[campId]
  └── Calving tab → stores calving obs → feeds reproduction page + animal detail
```

---

## Build & Verification

- `pnpm build --webpack` must pass before deploying
- **Verify reproduction page:** KPI cards show Pregnancy Rate, Calving Rate, Calving Interval with correct SA benchmark colours
- **Verify Overview:** Reproductive Overview card appears with live stats
- **Verify Logger:** Calving tab logs an observation → appears in Recent Events on reproduction page
- **Verify animal detail:** All 5 tabs render; Reproduction tab shows correct events for that animal

---

## SA Benchmark Reference

| KPI | Red | Amber | Green | Source |
|-----|-----|-------|-------|--------|
| Pregnancy Rate | <70% | 70–84% | ≥85% | DoA SA target |
| Calving Rate | <70% | 70–84% | ≥85% | DoA SA target; 62% commercial avg |
| Calving Interval | >395d | 366–395d | ≤365d | ARC recommendation |
