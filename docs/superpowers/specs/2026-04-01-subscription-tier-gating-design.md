# Subscription Tier Gating — Design Spec

**Date:** 2026-04-01
**Status:** Approved
**Goal:** Add a `basic` / `premium` subscription tier to the farm management app so that basic-tier farms see only core features (logger, maps, basic admin) while premium farms retain full access. Existing farms default to premium — zero disruption.

---

## 1. Data Model

Add a `tier` field to `FarmSettings`:

```prisma
model FarmSettings {
  // ... existing fields ...
  tier String @default("premium") // "basic" | "premium"
}
```

- Default `"premium"` ensures all existing farms are unaffected.
- New self-service sign-ups get `"basic"`.
- Tier is per-farm, not per-user.

---

## 2. Tier Types & Helpers

New file: `lib/tier.ts`

```typescript
export type FarmTier = "basic" | "premium";

export const PREMIUM_ROUTES = [
  "performance",
  "league",
  "reproduction",
  "grafieke",
  "finansies",
] as const;

export function isPremiumRoute(segment: string): boolean {
  return PREMIUM_ROUTES.includes(segment as any);
}

export function isBasicTier(tier: string): boolean {
  return tier === "basic";
}
```

---

## 3. Tier Context (React)

New file: `components/tier-provider.tsx`

A minimal React context that holds the farm's tier value:

```typescript
"use client";
import { createContext, useContext } from "react";
import type { FarmTier } from "@/lib/tier";

const TierContext = createContext<FarmTier>("premium");

export function TierProvider({ tier, children }: { tier: FarmTier; children: React.ReactNode }) {
  return <TierContext.Provider value={tier}>{children}</TierContext.Provider>;
}

export function useTier(): FarmTier {
  return useContext(TierContext);
}
```

---

## 4. Admin Layout — Fetch & Provide Tier

**File:** `app/[farmSlug]/admin/layout.tsx`

The admin layout fetches the farm's tier from `FarmSettings` server-side and wraps children in `<TierProvider>`:

```typescript
const settings = await prisma.farmSettings.findFirst();
const tier = (settings?.tier ?? "premium") as FarmTier;

return (
  <TierProvider tier={tier}>
    <AdminNav />
    {children}
  </TierProvider>
);
```

---

## 5. Navigation Gating

**File:** `components/admin/AdminNav.tsx`

The sidebar currently groups nav items into Data, Finance, and Tools. Changes:

- Read tier from `useTier()`.
- **Basic tier**: Hide the entire Finance group (Finansies, Grafieke, League, Performance, Reproduction).
- **Premium tier**: No change — all items visible.

The nav items array is filtered before rendering:

```typescript
const tier = useTier();
const visibleGroups = tier === "basic"
  ? groups.filter(g => g.name !== "Finance")
  : groups;
```

---

## 6. Route Protection (Page-Level)

Each premium page checks the tier server-side and redirects basic users:

**Premium pages (5 files):**
- `app/[farmSlug]/admin/performance/page.tsx`
- `app/[farmSlug]/admin/league/page.tsx`
- `app/[farmSlug]/admin/reproduction/page.tsx`
- `app/[farmSlug]/admin/grafieke/page.tsx`
- `app/[farmSlug]/admin/finansies/page.tsx`

Each page adds a server-side check at the top:

```typescript
const settings = await prisma.farmSettings.findFirst();
if (settings?.tier === "basic") {
  redirect(`/${farmSlug}/admin`);
}
```

This matches the existing pattern (no middleware.ts, inline checks).

---

## 7. API Route Protection

Premium API routes return 403 for basic-tier farms:

**Routes to protect:**
- `GET /api/[farmSlug]/financial-analytics`
- `GET /api/[farmSlug]/performance`

```typescript
const settings = await prisma.farmSettings.findFirst();
if (settings?.tier === "basic") {
  return NextResponse.json({ error: "Premium feature" }, { status: 403 });
}
```

---

## 8. Admin Overview (Simplified for Basic)

**File:** Admin overview/dashboard page

For basic tier, conditionally hide:
- Financial trend widget
- ADG summary widget
- Any premium KPI cards

Basic users see:
- Total animals count
- Active camps count
- Today's observations count
- Needs attention panel (flagged animals, overdue calvings, treatment withdrawals)
- Recent observations log
- Data health indicators

Use `useTier()` to conditionally render sections.

---

## 9. Scope — What Does NOT Change

These areas remain completely untouched:

- **Logger** — All 10 observation types, offline capability, sync
- **Dashboard** — Tactical map, schematic map, satellite map, camp detail, animal profile
- **Home page** — 3-card navigation hub
- **Authentication** — Login, session, roles
- **Animals CRUD** — Table, edit, import
- **Camps CRUD** — Table, create/edit, GeoJSON
- **Observations** — Audit log, filter/search
- **Settings** — Farm configuration
- **Import** — Spreadsheet upload
- **Reports** — Basic CSV exports
- **Prisma schema** — Only the single `tier` field addition
- **All existing API routes** — Only 2 premium API routes get a tier check added

---

## 10. Feature Matrix

| Feature | Basic | Premium |
|---------|:-----:|:-------:|
| Logger (all observation types) | Y | Y |
| Offline sync | Y | Y |
| Satellite map | Y | Y |
| Tactical map | Y | Y |
| Schematic map | Y | Y |
| Camp detail / Animal profile | Y | Y |
| Admin overview (simplified) | Y | Y |
| Animals (table, edit, import) | Y | Y |
| Camps (table, create/edit) | Y | Y |
| Observations (audit log) | Y | Y |
| Settings | Y | Y |
| Import (spreadsheet) | Y | Y |
| Reports (CSV) | Y | Y |
| Performance analytics | - | Y |
| League (camp rankings) | - | Y |
| Reproduction analytics | - | Y |
| Charts (Grafieke) | - | Y |
| Financial management | - | Y |
| Financial analytics API | - | Y |
| Hands-on onboarding | - | Y |

---

## 11. Migration

A single Prisma migration adds the `tier` column:

```sql
ALTER TABLE "FarmSettings" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'premium';
```

All existing rows get `"premium"` — zero disruption.

---

## 12. Future Considerations (Out of Scope)

- Stripe/billing integration for automated tier assignment
- Upgrade flow UI ("Upgrade to Premium" CTAs in place of hidden features)
- Per-feature granular gating (beyond basic/premium binary)
- Self-service sign-up page for basic tier creation

These are intentionally deferred. The current implementation provides the gating infrastructure that these features can build on.
