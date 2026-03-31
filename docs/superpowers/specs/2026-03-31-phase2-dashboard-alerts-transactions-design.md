# Phase 2 Design: Dashboard, Alerts, Purchase/Sale, Calvings, Thresholds, Exports

**Date:** 2026-03-31
**Deadline:** 2026-04-03 (Friday demo)
**Status:** Approved

---

## Overview

Six features to transform FarmTrack from an operational data store into a manager-focused decision tool. All build on existing data and infrastructure — no new external services.

### Build Principles

- Visible value over hidden complexity
- Polished dashboards over unfinished systems
- Manager-focused and decision-oriented
- Use existing data wherever possible
- Simple, clean, credible UI for a commercial cattle farmer

---

## 1. Farm Dashboard Redesign

**Goal:** Replace the current "Operations Overview" with a high-level farm overview that surfaces decisions, not just counts.

### Current State

The admin page (`app/[farmSlug]/admin/page.tsx`) shows:
- 7-column connected stats bar (animals, camps, inspections, health issues, calvings, deaths, withdrawal)
- 3-column grid: Reproductive Overview, Recent Health Incidents, Camp Status Summary
- Low-grazing alert banner
- DangerZone (dev only)

### New Layout

#### Top: Connected Stats Bar (enhanced)

Keep the existing 7 stats. Add two more cards to the bar:

| Stat | Source | Icon | Color Logic |
|------|--------|------|-------------|
| **Poor Doers** | Count of animals with best ADG < `adgPoorDoerThreshold` | `TrendingDown` | Red if > 0, grey if 0 |
| **Finance · MTD** | Net income/expense for current month from Transaction table | `DollarSign` | Green if positive, red if negative |

Total: 9 stats in the bar. On smaller screens, wrap to 3 columns.

#### Middle: "Needs Attention" Panel

A single card with amber/red border, grouped by severity. Each row: icon, description, count, link.

**Red (Immediate):**
- Overdue calvings (daysAway < 0) → link to reproduction page
- Animals in withdrawal → link to animals page
- Camps with "Poor" or "Overgrazed" grazing → link to performance page

**Amber (Monitor):**
- Cows due to calve within 7 days → link to reproduction page
- Cows due to calve within 14 days → link to reproduction page
- Open cows above `daysOpenLimit` threshold → link to reproduction page
- Poor doers (ADG < threshold) → link to animals page
- Stale camp inspections (not inspected within `staleCampInspectionHours`) → link to observations page

If no alerts: show a green "All clear" message.

**Data sources (all existing):**
- `getAnimalsInWithdrawal(prisma)` → withdrawal animals
- `reproStats.upcomingCalvings` → calving urgency (bucket by daysAway)
- `reproStats.daysOpen` → open cows above threshold
- `getHerdAdgTrend(prisma)` or new `getPoorDoerCount(prisma)` → poor doers
- `getLatestCampConditions(prisma)` → camp conditions
- `countInspectedToday(prisma)` + camp list → stale inspections

#### Bottom: 3-Column Grid (enhanced)

Keep existing cards (Reproductive Overview, Recent Health Incidents, Camp Status Summary). Add a 4th card:

**Quick Actions card:**
- Record Observation → `/[farmSlug]/logger`
- Add Transaction → `/[farmSlug]/admin/finansies` (with modal trigger)
- View Animals → `/[farmSlug]/admin/animals`
- View Reports → `/[farmSlug]/admin/reports` (new page, see section 6)

Each action: icon + label, styled as a clickable card/button.

### Files Changed

- `app/[farmSlug]/admin/page.tsx` — restructure layout, add alerts data fetching
- New: `components/admin/NeedsAttentionPanel.tsx` — client component for the alert panel
- New: `components/admin/QuickActions.tsx` — quick action links
- New: `lib/server/dashboard-alerts.ts` — aggregates all alert data into a single `DashboardAlerts` type

---

## 2. Upcoming Calvings + Gestation Calculator

**Goal:** Surface calving urgency with clear tiers so the farmer knows who to watch.

### Current State

`reproStats.upcomingCalvings` already returns `UpcomingCalving[]` with `daysAway` (range: -7 to +90). The reproduction page shows calvings due in 30 days as a count.

### New: Urgency Tiers

**New function** in `lib/server/reproduction-analytics.ts`:

```typescript
interface CalvingUrgencyTiers {
  overdue: UpcomingCalving[];   // daysAway < 0
  due7d: UpcomingCalving[];     // daysAway 0–7
  due14d: UpcomingCalving[];    // daysAway 8–14
  upcoming: UpcomingCalving[];  // daysAway 15–90
}

function getCalvingUrgencyTiers(calvings: UpcomingCalving[]): CalvingUrgencyTiers
```

### Dashboard Integration

The Needs Attention panel (section 1) uses these tiers for its calving alert rows.

### Reproduction Page Enhancement

Add an "Upcoming Calvings" section above the existing pregnancy rate chart:

- Table columns: Animal ID (link), Camp, Expected Date, Days Away, Source (scan/insemination badge), Urgency (color badge)
- Urgency badges: Red "OVERDUE", Dark amber "Due in 7d", Light amber "Due in 14d", Grey "Upcoming"
- Sorted by daysAway ascending (most urgent first)

### Files Changed

- `lib/server/reproduction-analytics.ts` — add `getCalvingUrgencyTiers()` function
- `app/[farmSlug]/admin/reproduction/page.tsx` — add upcoming calvings table
- New: `components/admin/UpcomingCalvingsTable.tsx` — client component for the table

---

## 3. Purchase & Sale Records

**Goal:** Extend the existing Transaction model to capture livestock-specific purchase/sale data.

### Current State

`Transaction` model: type, category, amount, date, description, animalId (single), campId, reference, createdBy. Finance UI fully working with ledger, categories, charts.

### Schema Changes (via turso db shell)

Add columns to the `Transaction` table:

```sql
ALTER TABLE Transaction ADD COLUMN saleType TEXT;        -- "auction" | "private" | null
ALTER TABLE Transaction ADD COLUMN counterparty TEXT;     -- buyer or seller name
ALTER TABLE Transaction ADD COLUMN quantity INTEGER;      -- number of animals in batch
ALTER TABLE Transaction ADD COLUMN avgMassKg REAL;        -- average mass at transaction
ALTER TABLE Transaction ADD COLUMN fees REAL;             -- auction fees, commission
ALTER TABLE Transaction ADD COLUMN transportCost REAL;    -- transport cost
ALTER TABLE Transaction ADD COLUMN animalIds TEXT;        -- JSON array of animal IDs for batches
```

Update `prisma/schema.prisma` to match (but do NOT run `prisma db push`).

### API Changes

**`POST /api/[farmSlug]/transactions`** — Accept new optional fields in request body. Validate `saleType` is one of `["auction", "private"]` or null.

**`GET /api/[farmSlug]/transactions`** — Return new fields in response. New optional filter: `?category=Animal+Sales` or `?category=Animal+Purchases` to get livestock transactions only.

### UI Changes

**`TransactionModal.tsx`** — When the selected category is "Animal Sales" or "Animal Purchases", show additional fields:
- Sale Type (dropdown: Auction / Private Sale)
- Buyer/Seller Name (text input)
- Quantity (number input)
- Average Mass (kg) (number input)
- Auction Fees (currency input, shown only for "auction" type)
- Transport Cost (currency input)

**`TransactionLedger.tsx`** — Add columns for saleType, counterparty, quantity when viewing livestock categories. Expandable row detail for fees/transport.

**`AnimalActions.tsx`** — Populate new fields when triggering buy/sell from animal page.

### Files Changed

- `prisma/schema.prisma` — add new Transaction columns
- `app/api/[farmSlug]/transactions/route.ts` — handle new fields in POST/GET
- `components/admin/finansies/TransactionModal.tsx` — livestock-specific fields
- `components/admin/finansies/TransactionLedger.tsx` — show new columns
- `components/admin/finansies/AnimalActions.tsx` — populate new fields

---

## 4. Configurable Farm Thresholds

**Goal:** Let the farmer set their own thresholds instead of using hardcoded values.

### Current State

`FarmSettings` model has: `alertThresholdHours` (48), `farmName`, `breed`. Thresholds are hardcoded:
- ADG poor doer: 0.7 kg/day in `weight-analytics.ts`
- Calving alert: hardcoded in reproduction page
- Days open: no threshold used
- Camp grazing warning: 7 days in `camp-status.ts`

### Schema Changes (via turso db shell)

```sql
ALTER TABLE FarmSettings ADD COLUMN adgPoorDoerThreshold REAL DEFAULT 0.7;
ALTER TABLE FarmSettings ADD COLUMN calvingAlertDays INTEGER DEFAULT 14;
ALTER TABLE FarmSettings ADD COLUMN daysOpenLimit INTEGER DEFAULT 365;
ALTER TABLE FarmSettings ADD COLUMN campGrazingWarningDays INTEGER DEFAULT 7;
```

Keep existing `alertThresholdHours` as-is (it serves the stale-inspection purpose).

Update `prisma/schema.prisma` to match.

### New Settings Page

**`app/[farmSlug]/admin/settings/page.tsx`** — Server component that reads current `FarmSettings`.

**`components/admin/SettingsForm.tsx`** — Client component with form fields:
- Farm Name (text)
- Primary Breed (text)
- ADG Poor Doer Threshold (number, kg/day, default 0.7)
- Calving Alert Window (number, days, default 14)
- Days Open Limit (number, days, default 365)
- Stale Inspection Alert (number, hours, default 48) — maps to existing `alertThresholdHours`
- Camp Grazing Warning (number, days remaining, default 7)

Save via `PATCH /api/farm/settings`.

### New API Route

**`PATCH /api/farm/settings`** — Update FarmSettings singleton. Validate all values are positive numbers.

### Analytics Integration

All analytics functions that use hardcoded thresholds must accept the threshold as a parameter:

- `weight-analytics.ts`: `isPoorDoer` uses `threshold` param instead of hardcoded 0.7
- `camp-status.ts`: `getLowGrazingCampCount` uses `campGrazingWarningDays` param
- `dashboard-alerts.ts`: reads FarmSettings and passes thresholds to each analytics function
- `reproduction-analytics.ts`: `getCalvingUrgencyTiers` uses `calvingAlertDays` for the 14-day tier

### Navigation

Add "Settings" to `AdminNav.tsx` with a gear icon, placed at the bottom of the nav list.

### Files Changed

- `prisma/schema.prisma` — add threshold columns to FarmSettings
- New: `app/[farmSlug]/admin/settings/page.tsx` — settings page
- New: `components/admin/SettingsForm.tsx` — settings form
- New: `app/api/farm/settings/route.ts` — PATCH endpoint
- `lib/server/weight-analytics.ts` — parameterize threshold
- `lib/server/camp-status.ts` — parameterize threshold
- `lib/server/reproduction-analytics.ts` — parameterize calving alert days
- `components/admin/AdminNav.tsx` — add Settings link

---

## 5. Exports / Reports

**Goal:** Let the farmer download CSV or PDF reports for key data sets.

### Approach

- **CSV:** Server-side string concatenation (no extra dependency)
- **PDF:** `jspdf` + `jspdf-autotable` (install as production dependencies)

### New API Route

**`GET /api/[farmSlug]/export?type=X&format=csv|pdf`**

| Type | Columns | Data Source |
|------|---------|-------------|
| `animals` | Animal ID, Name, Sex, Breed, Category, Camp, Status, DOB | `prisma.animal.findMany()` |
| `withdrawal` | Animal ID, Name, Camp, Treatment Type, Treated Date, Withdrawal Ends, Days Remaining | `getAnimalsInWithdrawal(prisma)` |
| `calvings` | Animal ID, Camp, Expected Date, Days Away, Source, Urgency | `reproStats.upcomingCalvings` + urgency tiers |
| `camps` | Camp ID, Name, Size (ha), Grazing Quality, Water Status, LSU/ha, Last Inspected | `prisma.camp.findMany()` + `getLatestCampConditions()` |
| `transactions` | Date, Type, Category, Amount, Description, Animal ID, Sale Type, Counterparty, Qty | `prisma.transaction.findMany()` with optional `?from=&to=` |

Response: `Content-Type: text/csv` or `application/pdf` with `Content-Disposition: attachment; filename=...`.

### Reports Page

**`app/[farmSlug]/admin/reports/page.tsx`** — A simple page listing all available reports with download buttons. Each report card shows: title, description, format selector (CSV/PDF), download button.

### Per-Page Export Buttons

Also add an export button (download icon) to the header of:
- Animals page → exports `animals`
- Reproduction page → exports `calvings`
- Performance page → exports `camps`
- Finansies page → exports `transactions`

### Files Changed

- New: `app/api/[farmSlug]/export/route.ts` — export API
- New: `lib/server/export-csv.ts` — CSV generation helpers
- New: `lib/server/export-pdf.ts` — PDF generation helpers
- New: `app/[farmSlug]/admin/reports/page.tsx` — reports page
- New: `components/admin/ExportButton.tsx` — reusable export button component
- `components/admin/AdminNav.tsx` — add Reports link

### Dependencies

```bash
pnpm add jspdf jspdf-autotable
pnpm add -D @types/jspdf
```

---

## 6. Navigation Updates

Add to `AdminNav.tsx`:
- **Reports** (FileDown icon) — between Grafieke and Performance in nav order
- **Settings** (Settings/Gear icon) — at the bottom, before any dev tools

---

## Database Migration Summary

All changes via `turso db shell delta-livestock`:

```sql
-- Transaction livestock fields
ALTER TABLE Transaction ADD COLUMN saleType TEXT;
ALTER TABLE Transaction ADD COLUMN counterparty TEXT;
ALTER TABLE Transaction ADD COLUMN quantity INTEGER;
ALTER TABLE Transaction ADD COLUMN avgMassKg REAL;
ALTER TABLE Transaction ADD COLUMN fees REAL;
ALTER TABLE Transaction ADD COLUMN transportCost REAL;
ALTER TABLE Transaction ADD COLUMN animalIds TEXT;

-- FarmSettings thresholds
ALTER TABLE FarmSettings ADD COLUMN adgPoorDoerThreshold REAL DEFAULT 0.7;
ALTER TABLE FarmSettings ADD COLUMN calvingAlertDays INTEGER DEFAULT 14;
ALTER TABLE FarmSettings ADD COLUMN daysOpenLimit INTEGER DEFAULT 365;
ALTER TABLE FarmSettings ADD COLUMN campGrazingWarningDays INTEGER DEFAULT 7;
```

---

## New Files Summary

| File | Purpose |
|------|---------|
| `lib/server/dashboard-alerts.ts` | Aggregate all alert data |
| `components/admin/NeedsAttentionPanel.tsx` | Alert panel component |
| `components/admin/QuickActions.tsx` | Quick action links |
| `components/admin/UpcomingCalvingsTable.tsx` | Calving urgency table |
| `components/admin/SettingsForm.tsx` | Farm settings form |
| `components/admin/ExportButton.tsx` | Reusable export button |
| `app/[farmSlug]/admin/settings/page.tsx` | Settings page |
| `app/[farmSlug]/admin/reports/page.tsx` | Reports page |
| `app/api/farm/settings/route.ts` | Settings PATCH endpoint |
| `app/api/[farmSlug]/export/route.ts` | Export API |
| `lib/server/export-csv.ts` | CSV generation |
| `lib/server/export-pdf.ts` | PDF generation |

---

## Implementation Order

1. **Thresholds** — Schema + settings page + API (unblocks everything else)
2. **Dashboard alerts** — `dashboard-alerts.ts` + `NeedsAttentionPanel` + calving urgency tiers
3. **Dashboard redesign** — Restructure admin page with alerts panel, quick actions, enhanced stats
4. **Purchase/sale** — Schema + API + UI extensions
5. **Exports** — API + per-page buttons + reports page
6. **Navigation** — Settings + Reports links in AdminNav
