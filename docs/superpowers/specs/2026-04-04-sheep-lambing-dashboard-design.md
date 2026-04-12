# Sheep Lambing Dashboard — Design Spec

**Date:** 2026-04-04
**Status:** Approved
**Goal:** Add a standalone `/[farmSlug]/sheep/reproduction` route with a lambing dashboard that renders `sheepModule.getReproStats()`, `sheepModule.getAlerts()`, and `sheepModule.getDashboardData()` output in a dashboard-grid layout. This is the first UI deliverable of Phase MS-5 (cross-species UI).

---

## 1. Routing & Layout

### Route Structure

```
app/[farmSlug]/sheep/
  layout.tsx          ← Shared sheep layout (AdminNav + SheepSubNav)
  reproduction/
    page.tsx          ← Lambing dashboard (this spec)
```

**Route:** `/[farmSlug]/sheep/reproduction`

Future sibling routes (not in this spec): `/sheep/health`, `/sheep/wool`, `/sheep/losses`.

### Layout: `app/[farmSlug]/sheep/layout.tsx`

Server component. Same pattern as `app/[farmSlug]/admin/layout.tsx`:

```typescript
export default async function SheepLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const tier = await getTier(farmSlug); // getFarmCreds → tier

  return (
    <TierProvider tier={tier}>
      <div className="flex min-h-screen">
        <AdminNav tier={tier} />
        <main className="flex-1">
          <SheepSubNav farmSlug={farmSlug} />
          {children}
        </main>
      </div>
    </TierProvider>
  );
}
```

- Reuses `AdminNav` (the existing sidebar)
- Renders `SheepSubNav` (new horizontal tab bar) above children
- Wraps in `TierProvider` for tier gating

---

## 2. AdminNav Change

Add a `"Species"` group to `AdminNav.tsx`:

```typescript
// Add to NAV_ITEMS array:
{ path: "/sheep/reproduction", label: "Sheep", icon: Rabbit, group: "Species" },

// Add to GROUP_ORDER:
const GROUP_ORDER = ["Data", "Finance", "Tools", "Species"];
```

- Uses `Rabbit` icon from lucide-react (closest available for sheep)
- Not `premiumOnly` — sheep section is available on all tiers (tier gating is on the page itself)
- Single entry per species; future game entry follows same pattern

---

## 3. SheepSubNav Component

**File:** `components/sheep/SheepSubNav.tsx`

Client component. Horizontal tab bar rendered below the page header, above page content.

```typescript
"use client";

const TABS = [
  { label: "Reproduction", href: "/sheep/reproduction" },
  { label: "Health",       href: "/sheep/health" },
  { label: "Wool",         href: "/sheep/wool" },
  { label: "Losses",       href: "/sheep/losses" },
];
```

**Design tokens:**
- Container: `bg-white border border-[#E0D5C8] rounded-lg p-1`
- Active tab: `bg-[rgba(74,124,89,0.12)] text-[#3A6B49] rounded-md`
- Inactive tab: `text-[#9C8E7A]`
- Tab padding: `px-3 py-1.5`
- Font: `text-sm font-medium`

Future tabs (Health, Wool, Losses) show as disabled/dimmed until those pages exist.

---

## 4. Page: Lambing Dashboard

**File:** `app/[farmSlug]/sheep/reproduction/page.tsx`

Server component. `export const dynamic = "force-dynamic"`.

### 4.1 Tier Gating

Basic tier farms see `<UpgradePrompt feature="Sheep Management" />` instead of the dashboard.

### 4.2 Data Fetching

Three parallel calls via `Promise.all`:

```typescript
const prisma = getPrismaForFarm(farmSlug);
const [reproStats, alerts, dashData] = await Promise.all([
  sheepModule.getReproStats(prisma),
  sheepModule.getAlerts(prisma, farmSlug, {}),
  sheepModule.getDashboardData(prisma),
]);
```

Plus a direct Prisma query for recent events timeline:

```typescript
const recentEvents = await prisma.observation.findMany({
  where: {
    type: { in: ["lambing", "joining", "shearing"] },
  },
  orderBy: { observedAt: "desc" },
  take: 10,
  select: {
    type: true,
    observedAt: true,
    animalId: true,
    campId: true,
  },
});
```

### 4.3 Layout (Dashboard Grid)

Top-to-bottom sections:

```
┌──────────────────────────────────────────────┐
│  Page Header                                 │
│  "Lambing Dashboard"                         │
│  "Sheep reproduction · 12-month window ·     │
│   SA benchmark: ≥85% lambing rate"           │
├──────────────────────────────────────────────┤
│  KPI Row (4 cards, flex)                     │
│  [Lambing %] [Joinings 12m] [Lambings 12m]  │
│  [Due <30d]                                  │
├──────────────────────────────────────────────┤
│  Alert Cards Row (flex, variable count)      │
│  [Overdue]  [Dosing]  [Shearing]  [Predation]│
├───────────────────┬──────────────────────────┤
│  Upcoming Lambings│  Overdue Lambings        │
│  (next 90 days)   │  (>160d since joining)   │
│  Table            │  Table                   │
├───────────────────┬──────────────────────────┤
│  Recent Events    │  Flock Summary           │
│  (timeline)       │  (category counts)       │
└───────────────────┴──────────────────────────┘
```

### 4.4 KPI Cards

Use inline styled cards (same pattern as cattle reproduction page). Four cards:

| KPI | Value Source | Color Logic |
|-----|-------------|-------------|
| Lambing % | `reproStats.lambingPercentage` | Green if ≥85, amber if 70-84, red if <70, neutral if null |
| Joinings (12mo) | `reproStats.joinings12m` | Neutral |
| Lambings (12mo) | `reproStats.lambings12m` | Neutral |
| Due <30 days | `reproStats.upcomingBirths.filter(b => b.daysAway <= 30 && b.daysAway >= 0).length` | Amber if >0 |

### 4.5 Alert Cards

Render `alerts` array from `sheepModule.getAlerts()`. Each alert maps to a card:

| Alert ID | Icon | Severity | Color |
|----------|------|----------|-------|
| `sheep-lambing-overdue` | AlertTriangle | red | `bg-red-50/60 border-red-200 text-red-800` |
| `sheep-lambing-imminent` | Baby | amber | `bg-amber-50/70 border-amber-200 text-amber-800` |
| `sheep-dosing-due` | Droplets | amber | same |
| `sheep-shearing-due` | Scissors | amber | same |
| `sheep-predation` | AlertTriangle | red | same as overdue |

Cards are clickable, linking to `alert.href`. If no alerts, this row is hidden.

### 4.6 Upcoming Lambings Table

**New component:** `components/sheep/UpcomingLambingsTable.tsx`

Data source: `reproStats.upcomingBirths` filtered to `daysAway >= 0`, sorted by `daysAway` ascending.

Columns:
| Column | Source | Width |
|--------|--------|-------|
| Ewe ID | `animalId` (monospace) | 80px |
| Camp | `campName` | flex |
| Expected Date | `expectedDate` (formatted) | 90px |
| Status Badge | daysAway → badge | auto |

Badge colors:
- `daysAway <= 7` → red badge ("3d")
- `daysAway <= 14` → amber badge ("8d")
- `daysAway > 14` → green badge ("28d")

### 4.7 Overdue Lambings Table

**New component:** `components/sheep/OverdueLambingsTable.tsx`

Data source: `reproStats.upcomingBirths` filtered to `daysAway < 0`, sorted by `daysAway` ascending (most overdue first).

Columns:
| Column | Source | Width |
|--------|--------|-------|
| Ewe ID | `animalId` (monospace) | 80px |
| Camp | `campName` | flex |
| Joined | `expectedDate - 150 days` (formatted) | 90px |
| Status Badge | `Math.abs(daysAway)` → "169d ago" | auto |

All badges are red.

### 4.8 Recent Events Timeline

Inline component (no separate file needed). Vertical timeline with colored dots:

| Event Type | Dot Color | Label |
|------------|-----------|-------|
| `lambing` | teal (`#0D9488`) | "Lambing" |
| `joining` | gold (`#8B6914`) | "Joining" |
| `shearing` | stone (`#9C8E7A`) | "Shearing" |

Shows `type · animalId · campName · date`. Max 10 events.

### 4.9 Flock Summary

Inline card showing active sheep by category. Data source: `dashData.speciesSpecific`:

| Row | Value |
|-----|-------|
| Ewes | `speciesSpecific.ewesActive` |
| Rams | `speciesSpecific.ramsActive` |
| Lambs | `speciesSpecific.lambsActive` |
| Total | `dashData.activeCount` |

Uses simple flex rows with label on left, bold count on right.

---

## 5. Design Tokens

Consistent with existing FarmTrack design system:

| Token | Value | Usage |
|-------|-------|-------|
| Page bg | `#FAFAF8` | Main content background |
| Text primary | `#1C1815` | Headings, KPI values |
| Text secondary | `#9C8E7A` | Labels, subtitles |
| Border | `#E0D5C8` | Card borders, table rows |
| Card bg | `#FFFFFF` | KPI cards, tables, sections |
| Green accent | `#166534` | Positive KPI values |
| Red accent | `#991B1B` | Negative/overdue values |
| Amber accent | `#92400E` | Warning values |
| Sheep green | `rgba(74,124,89,0.12)` | Active subnav tab bg |
| Sheep green text | `#3A6B49` | Active subnav tab text |
| Teal (lambing) | `#0D9488` | Timeline dot |
| Gold (joining) | `#8B6914` | Timeline dot, nav accent |

---

## 6. New Files Summary

| File | Type | Description |
|------|------|-------------|
| `app/[farmSlug]/sheep/layout.tsx` | Server component | Sheep section layout (AdminNav + SheepSubNav + TierProvider) |
| `app/[farmSlug]/sheep/reproduction/page.tsx` | Server component | Lambing dashboard page |
| `components/sheep/SheepSubNav.tsx` | Client component | Horizontal tab bar for sheep sub-sections |
| `components/sheep/UpcomingLambingsTable.tsx` | Server component | Table for upcoming lambings |
| `components/sheep/OverdueLambingsTable.tsx` | Server component | Table for overdue lambings |

## 7. Modified Files Summary

| File | Change |
|------|--------|
| `components/admin/AdminNav.tsx` | Add `Rabbit` import, add sheep entry to `NAV_ITEMS`, add `"Species"` to `GROUP_ORDER` |

---

## 8. Empty States

| Section | Empty State |
|---------|-------------|
| KPI: Lambing % | Show "—" when `lambingPercentage` is null |
| Upcoming table | "No upcoming lambings in the next 90 days" |
| Overdue table | "No overdue lambings — all on track" (green text) |
| Alert cards | Row hidden entirely |
| Timeline | "No recent sheep events" |
| Flock Summary | Shows 0 for all categories |

---

## 9. Constraints & Non-Goals

**In scope:**
- Lambing dashboard page with full data rendering
- AdminNav species entry
- SheepSubNav component
- Tier gating (basic → UpgradePrompt)

**Not in scope (future):**
- Health, Wool, Losses sub-pages (tabs show as disabled)
- Observation recording from dashboard (read-only for now)
- Date range picker (fixed 12-month window)
- Export/download functionality
- Mobile-specific layout adaptations beyond responsive flex
- Game species UI (separate spec)
