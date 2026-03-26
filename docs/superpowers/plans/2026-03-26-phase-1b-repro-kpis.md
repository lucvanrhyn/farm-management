# Phase 1B — Reproductive KPIs + Full Connectivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance FarmTrack with SA-benchmarked reproductive KPIs, a calving observation type, and a fully tabbed animal lifecycle page — all connected from Logger → Repro page → Admin Overview → Animal Detail.

**Architecture:** Server-component-only data fetching (direct Prisma, no new API routes). A new `lib/server/reproduction-analytics.ts` module centralises all KPI calculations and is called from both the repro page and the admin overview page. The Logger's `ReproductionForm` gains a 4th "calving" tab. The animal detail page becomes a 5-tab lifecycle view driven by a `?tab=` search param.

**Tech Stack:** Next.js 16 App Router (server components), Prisma 5 + Turso (libSQL), Tailwind, existing `MobKPICard` component. No schema changes needed — "calving" observations use the existing `Observation` model.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/types.ts` | Modify | Add `"calving"` to `ObservationType` |
| `lib/server/reproduction-analytics.ts` | Create | All KPI calculations, single `getReproStats()` entry point |
| `components/logger/ReproductionForm.tsx` | Modify | Add Calving as 4th event type option |
| `app/[farmSlug]/admin/reproduction/page.tsx` | Modify | Replace inline logic with analytics module; add 6-card KPI grid |
| `app/[farmSlug]/admin/page.tsx` | Modify | Add Reproductive Overview card; expand bottom grid to 3 cols |
| `app/[farmSlug]/admin/animals/[id]/page.tsx` | Modify | Replace single history section with 5-tab lifecycle view |

---

## Task 1: Add "calving" to ObservationType

**Files:**
- Modify: `lib/types.ts:17-24`

> **Context:** `ObservationType` is a union type in `lib/types.ts`. The Prisma model stores observation type as a plain string; this type is used for type safety in the client code and `queueObservation` calls. Adding `"calving"` here allows the calving observations queued from the logger to type-check correctly.

- [ ] **Step 1: Edit lib/types.ts**

Replace the `ObservationType` definition (lines 17–24):

```ts
// BEFORE:
export type ObservationType =
  | "camp_check"
  | "animal_movement"
  | "health_issue"
  | "reproduction"
  | "death"
  | "treatment"
  | "camp_condition";

// AFTER:
export type ObservationType =
  | "camp_check"
  | "animal_movement"
  | "health_issue"
  | "reproduction"
  | "calving"
  | "death"
  | "treatment"
  | "camp_condition";
```

- [ ] **Step 2: Verify no type errors**

```bash
cd "/Users/lucvanrhyn/Documents/Obsidian Vault/MainHub/Farm.project/farm-management"
rm -rf .tsbuildinfo .next/cache/tsbuildinfo 2>/dev/null; pnpm tsc --noEmit 2>&1 | head -30
```

Expected: zero new errors (pre-existing `heat_detection`/`insemination`/`pregnancy_scan` type discrepancies are not introduced by this change).

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add calving observation type to ObservationType"
```

---

## Task 2: Create lib/server/reproduction-analytics.ts

**Files:**
- Create: `lib/server/reproduction-analytics.ts`

> **Context:** This module extracts all repro KPI logic out of the page files. It is a pure server-side module — never import into client components. It is called from two pages: `admin/reproduction/page.tsx` and `admin/page.tsx`. The `PrismaClient` instance is always passed in (never imported directly) to support multi-tenant farm databases via `getPrismaForFarm`.

- [ ] **Step 1: Create the file**

```ts
// lib/server/reproduction-analytics.ts
import type { PrismaClient } from "@prisma/client";

const GESTATION_DAYS = 285; // SA midpoint: Bonsmara/Brangus/Nguni 283–285d

export interface UpcomingCalving {
  animalId: string;
  campId: string;
  campName: string;
  expectedCalving: Date;
  daysAway: number;
  source: "scan" | "insemination";
}

export interface ReproStats {
  pregnancyRate: number | null;        // pregnant scans / eligible females × 100
  calvingRate: number | null;          // live calvings / inseminations (12m) × 100
  avgCalvingIntervalDays: number | null; // avg days between consecutive calvings per animal
  upcomingCalvings: UpcomingCalving[]; // sorted by daysAway asc; next 90d + up to 7d overdue
  inHeat7d: number;
  inseminations30d: number;
  calvingsDue30d: number;
  scanCounts: { pregnant: number; empty: number; uncertain: number };
  conceptionRate: number | null;       // pregnant / (pregnant + empty) × 100
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function daysFromNow(date: Date): number {
  return Math.round((date.getTime() - Date.now()) / 86_400_000);
}

function parseDetails(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function getReproStats(prisma: PrismaClient): Promise<ReproStats> {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

  const selectFields = {
    id: true,
    type: true,
    animalId: true,
    campId: true,
    observedAt: true,
    loggedBy: true,
    details: true,
  } as const;

  const [reproObs, calvingObs, allCamps] = await Promise.all([
    prisma.observation.findMany({
      where: {
        type: { in: ["heat_detection", "insemination", "pregnancy_scan"] },
        observedAt: { gte: twelveMonthsAgo },
      },
      orderBy: { observedAt: "desc" },
      select: selectFields,
    }),
    prisma.observation.findMany({
      where: {
        type: "calving",
        observedAt: { gte: twelveMonthsAgo },
      },
      orderBy: { observedAt: "asc" },
      select: selectFields,
    }),
    prisma.camp.findMany({ select: { campId: true, campName: true } }),
  ]);

  type ObsRow = (typeof reproObs)[0];

  const campMap = new Map(allCamps.map((c) => [c.campId, c.campName]));

  // ── Activity KPIs ────────────────────────────────────────────────────────

  const inHeat7d = new Set(
    reproObs
      .filter((o) => o.type === "heat_detection" && o.observedAt >= sevenDaysAgo && o.animalId)
      .map((o) => o.animalId as string)
  ).size;

  const inseminations30d = reproObs.filter(
    (o) => o.type === "insemination" && o.observedAt >= thirtyDaysAgo
  ).length;

  // ── Scan results (latest scan per animal) ───────────────────────────────

  const latestScanByAnimal = new Map<string, ObsRow>();
  for (const obs of reproObs.filter((o) => o.type === "pregnancy_scan" && o.animalId)) {
    if (!latestScanByAnimal.has(obs.animalId!)) {
      latestScanByAnimal.set(obs.animalId!, obs);
    }
  }

  const scanCounts = { pregnant: 0, empty: 0, uncertain: 0 };
  for (const obs of latestScanByAnimal.values()) {
    const d = parseDetails(obs.details);
    const result = (d.result ?? "uncertain") as keyof typeof scanCounts;
    if (result in scanCounts) scanCounts[result]++;
  }

  const scanTotal = scanCounts.pregnant + scanCounts.empty;
  const conceptionRate =
    scanTotal > 0 ? Math.round((scanCounts.pregnant / scanTotal) * 100) : null;

  // ── Pregnancy Rate ────────────────────────────────────────────────────────
  // pregnant scans ÷ all females with ≥1 repro event in rolling 12m window × 100
  const femalesWithReproEvents = new Set(
    reproObs.filter((o) => o.animalId).map((o) => o.animalId as string)
  ).size;
  const pregnancyRate =
    femalesWithReproEvents > 0
      ? Math.round((scanCounts.pregnant / femalesWithReproEvents) * 100)
      : null;

  // ── Calving Rate ──────────────────────────────────────────────────────────
  // live calvings ÷ total inseminations (12m) × 100
  const totalInseminations12m = reproObs.filter((o) => o.type === "insemination").length;
  const liveCalvings12m = calvingObs.filter(
    (o) => parseDetails(o.details).calf_status === "live"
  ).length;
  const calvingRate =
    totalInseminations12m > 0
      ? Math.round((liveCalvings12m / totalInseminations12m) * 100)
      : null;

  // ── Avg Calving Interval ──────────────────────────────────────────────────
  // avg(calving_n+1 − calving_n) per animal — only animals with ≥2 calvings
  const calvingsByAnimal = new Map<string, Date[]>();
  for (const obs of calvingObs) {
    if (!obs.animalId) continue;
    const existing = calvingsByAnimal.get(obs.animalId) ?? [];
    existing.push(obs.observedAt);
    calvingsByAnimal.set(obs.animalId, existing);
  }

  const intervals: number[] = [];
  for (const dates of calvingsByAnimal.values()) {
    if (dates.length < 2) continue;
    dates.sort((a, b) => a.getTime() - b.getTime());
    for (let i = 1; i < dates.length; i++) {
      intervals.push((dates[i].getTime() - dates[i - 1].getTime()) / 86_400_000);
    }
  }
  const avgCalvingIntervalDays =
    intervals.length > 0
      ? Math.round(intervals.reduce((sum, v) => sum + v, 0) / intervals.length)
      : null;

  // ── Upcoming Calvings ─────────────────────────────────────────────────────
  // Prefer latest pregnancy_scan (confirmed pregnant) + 285d as base date.
  // Fallback: latest insemination + 285d.
  // Window: -7d (overdue) to +90d (upcoming).
  const latestInsemByAnimal = new Map<string, ObsRow>();
  for (const obs of reproObs.filter((o) => o.type === "insemination" && o.animalId)) {
    if (!latestInsemByAnimal.has(obs.animalId!)) {
      latestInsemByAnimal.set(obs.animalId!, obs);
    }
  }

  // Candidate animal IDs: confirmed-pregnant scans + all inseminations
  const candidateIds = new Set<string>([
    ...Array.from(latestScanByAnimal.entries())
      .filter(([, o]) => parseDetails(o.details).result === "pregnant")
      .map(([id]) => id),
    ...latestInsemByAnimal.keys(),
  ]);

  const upcomingCalvings: UpcomingCalving[] = [];
  for (const animalId of candidateIds) {
    const scanObs = latestScanByAnimal.get(animalId);
    const insemObs = latestInsemByAnimal.get(animalId);
    const useScan = scanObs != null && parseDetails(scanObs.details).result === "pregnant";
    const baseObs = useScan ? scanObs! : insemObs;
    if (!baseObs) continue;

    const expectedCalving = addDays(baseObs.observedAt, GESTATION_DAYS);
    const daysAway = daysFromNow(expectedCalving);
    if (daysAway < -7 || daysAway > 90) continue;

    upcomingCalvings.push({
      animalId,
      campId: baseObs.campId,
      campName: campMap.get(baseObs.campId) ?? baseObs.campId,
      expectedCalving,
      daysAway,
      source: useScan ? "scan" : "insemination",
    });
  }
  upcomingCalvings.sort((a, b) => a.daysAway - b.daysAway);

  const calvingsDue30d = upcomingCalvings.filter(
    (c) => c.daysAway >= 0 && c.daysAway <= 30
  ).length;

  return {
    pregnancyRate,
    calvingRate,
    avgCalvingIntervalDays,
    upcomingCalvings,
    inHeat7d,
    inseminations30d,
    calvingsDue30d,
    scanCounts,
    conceptionRate,
  };
}
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/lucvanrhyn/Documents/Obsidian Vault/MainHub/Farm.project/farm-management"
rm -rf .tsbuildinfo .next/cache/tsbuildinfo 2>/dev/null; pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors from the new file.

- [ ] **Step 3: Commit**

```bash
git add lib/server/reproduction-analytics.ts
git commit -m "feat: add reproduction-analytics module with SA-benchmarked KPIs"
```

---

## Task 3: Add Calving tab to ReproductionForm

**Files:**
- Modify: `components/logger/ReproductionForm.tsx`

> **Context:** The logger's per-animal "Reproduction" modal uses `ReproductionForm.tsx`. It currently has 3 event types: heat detection, insemination, pregnancy scan. We add "calving" as a 4th type. When submitted, the logger's `handleReproSubmit` stores it as `type: "calving"` with `details: { calf_status, calf_tag? }`. This is separate from the existing full `CalvingForm` (which creates a new calf animal record) — this is a lightweight reproductive event for KPI tracking.

- [ ] **Step 1: Update ReproType and TYPE_OPTIONS in ReproductionForm.tsx**

Replace the `ReproType` type and `TYPE_OPTIONS` array at the top of the file:

```ts
// BEFORE:
type ReproType = "heat_detection" | "insemination" | "pregnancy_scan";

// AFTER:
type ReproType = "heat_detection" | "insemination" | "pregnancy_scan" | "calving";
```

Replace `TYPE_OPTIONS`:

```ts
const TYPE_OPTIONS: { value: ReproType; label: string; icon: string; desc: string }[] = [
  {
    value: "heat_detection",
    label: "Heat / Oestrus",
    icon: "🔥",
    desc: "Animal observed in standing heat",
  },
  {
    value: "insemination",
    label: "Insemination",
    icon: "💉",
    desc: "AI or natural service recorded",
  },
  {
    value: "pregnancy_scan",
    label: "Pregnancy Scan",
    icon: "🔬",
    desc: "Pregnancy diagnosis result",
  },
  {
    value: "calving",
    label: "Calving",
    icon: "🐮",
    desc: "Dam calved — record calf status",
  },
];
```

- [ ] **Step 2: Add calving state variables**

After the existing `const [scanNotes, setScanNotes] = useState("")` line, add:

```ts
// Calving
const [calfStatus, setCalfStatus] = useState<"live" | "stillborn">("live");
const [calfTag, setCalfTag] = useState("");
```

- [ ] **Step 3: Add calving to handleSubmit**

In `handleSubmit`, add a calving branch before the closing brace. Replace:

```ts
  function handleSubmit() {
    if (!selectedType) return;

    let details: Record<string, string>;
    if (selectedType === "heat_detection") {
      details = { method: heatMethod };
    } else if (selectedType === "insemination") {
      details = {
        method: insemMethod,
        ...(bullId.trim() ? { bullId: bullId.trim() } : {}),
      };
    } else {
      details = {
        result: scanResult,
        ...(scanNotes.trim() ? { notes: scanNotes.trim() } : {}),
      };
    }

    onSubmit({ type: selectedType, details });
  }
```

With:

```ts
  function handleSubmit() {
    if (!selectedType) return;

    let details: Record<string, string>;
    if (selectedType === "heat_detection") {
      details = { method: heatMethod };
    } else if (selectedType === "insemination") {
      details = {
        method: insemMethod,
        ...(bullId.trim() ? { bullId: bullId.trim() } : {}),
      };
    } else if (selectedType === "calving") {
      details = {
        calf_status: calfStatus,
        ...(calfTag.trim() ? { calf_tag: calfTag.trim() } : {}),
      };
    } else {
      details = {
        result: scanResult,
        ...(scanNotes.trim() ? { notes: scanNotes.trim() } : {}),
      };
    }

    onSubmit({ type: selectedType, details });
  }
```

- [ ] **Step 4: Add calving details UI**

After the closing `</>` of the pregnancy scan block (the last `{step === "details" && selectedType === "pregnancy_scan" && (...)}`), add:

```tsx
{/* Step 2d: calving */}
{step === "details" && selectedType === "calving" && (
  <>
    <div
      className="rounded-xl px-4 py-3 text-sm"
      style={{
        backgroundColor: "rgba(44, 21, 8, 0.5)",
        border: "1px solid rgba(92, 61, 46, 0.4)",
        color: "#D2B48C",
      }}
    >
      Dam: <span className="font-bold" style={{ color: "#F5F0E8" }}>{animalId}</span>
    </div>

    <p className="text-sm font-semibold" style={{ color: "#D2B48C" }}>
      Calf status
    </p>
    {(
      [
        { value: "live" as const, label: "🐮  Live calf" },
        { value: "stillborn" as const, label: "✗  Stillborn" },
      ] as const
    ).map((opt) => (
      <button
        key={opt.value}
        onClick={() => setCalfStatus(opt.value)}
        className="w-full text-left px-4 py-3.5 rounded-xl text-sm font-medium transition-colors"
        style={calfStatus === opt.value ? SELECTED_STYLE : DEFAULT_STYLE}
      >
        {opt.label}
      </button>
    ))}

    <div>
      <p className="text-sm font-semibold mb-2" style={{ color: "#D2B48C" }}>
        Calf tag (optional)
      </p>
      <input
        type="text"
        value={calfTag}
        onChange={(e) => setCalfTag(e.target.value)}
        placeholder="e.g. CALF-042"
        className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#B87333] placeholder:opacity-40"
        style={{
          backgroundColor: "rgba(26, 13, 5, 0.6)",
          border: "1px solid rgba(92, 61, 46, 0.5)",
          color: "#F5F0E8",
        }}
      />
    </div>

    <button
      onClick={handleSubmit}
      className="w-full font-bold py-4 rounded-2xl text-base mt-2"
      style={{ backgroundColor: "#B87333", color: "#F5F0E8" }}
    >
      Record Calving
    </button>
  </>
)}
```

- [ ] **Step 5: Type-check**

```bash
cd "/Users/lucvanrhyn/Documents/Obsidian Vault/MainHub/Farm.project/farm-management"
rm -rf .tsbuildinfo .next/cache/tsbuildinfo 2>/dev/null; pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add components/logger/ReproductionForm.tsx
git commit -m "feat: add calving event type to logger ReproductionForm"
```

---

## Task 4: Refactor reproduction/page.tsx with new KPI grid

**Files:**
- Modify: `app/[farmSlug]/admin/reproduction/page.tsx`

> **Context:** The current page has all KPI calculations inline. This task: (1) imports `getReproStats` from the analytics module, (2) replaces the inline calculation block, (3) adds a new 6-card KPI grid with SA benchmark colours, (4) adds calving events to the Recent Events timeline. The Expected Calvings table and Pregnancy Scan Results sections are kept — just fed from the analytics module's data.

- [ ] **Step 1: Replace the entire file**

```tsx
import Link from "next/link";
import AdminNav from "@/components/admin/AdminNav";
import MobKPICard from "@/components/admin/MobKPICard";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getReproStats } from "@/lib/server/reproduction-analytics";

export const dynamic = "force-dynamic";

const GESTATION_DAYS = 285;

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

function calvingUrgency(daysAway: number): "good" | "warning" | "alert" {
  if (daysAway < 0) return "alert"; // overdue
  if (daysAway <= 14) return "alert";
  if (daysAway <= 30) return "warning";
  return "good";
}

function parseDetails(raw: string): Record<string, string> {
  try { return JSON.parse(raw) as Record<string, string>; } catch { return {}; }
}

// SA benchmark colour helpers
function rateStatus(value: number | null): "good" | "warning" | "alert" | "neutral" {
  if (value === null) return "neutral";
  if (value >= 85) return "good";
  if (value >= 70) return "warning";
  return "alert";
}

function intervalStatus(days: number | null): "good" | "warning" | "alert" | "neutral" {
  if (days === null) return "neutral";
  if (days <= 365) return "good";
  if (days <= 395) return "warning";
  return "alert";
}

export default async function ReproductionPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);

  if (!prisma) {
    return (
      <div className="flex min-h-screen bg-[#FAFAF8] items-center justify-center">
        <p className="text-red-500 text-sm">Farm not found.</p>
      </div>
    );
  }

  const stats = await getReproStats(prisma);

  // Fetch recent events for timeline (includes calving)
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

  const [recentTimeline, allCamps] = await Promise.all([
    prisma.observation.findMany({
      where: {
        type: { in: ["heat_detection", "insemination", "pregnancy_scan", "calving"] },
        observedAt: { gte: twelveMonthsAgo },
      },
      orderBy: { observedAt: "desc" },
      take: 15,
      select: {
        id: true,
        type: true,
        animalId: true,
        campId: true,
        observedAt: true,
        loggedBy: true,
        details: true,
      },
    }),
    prisma.camp.findMany({ select: { campId: true, campName: true } }),
  ]);

  const campMap = new Map(allCamps.map((c) => [c.campId, c.campName]));
  const totalEventCount = recentTimeline.length;

  const EVENT_CONFIG: Record<string, { label: string; dotColor: string }> = {
    heat_detection: { label: "Heat detected",    dotColor: "#D47EB5" },
    insemination:   { label: "Insemination",     dotColor: "#8B6914" },
    pregnancy_scan: { label: "Pregnancy scan",   dotColor: "#4A7C59" },
    calving:        { label: "Calving",          dotColor: "#2A8B7A" },
  };

  return (
    <div className="flex min-h-screen bg-[#FAFAF8]">
      <AdminNav />
      <main className="flex-1 min-w-0 p-4 md:p-8 max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold" style={{ color: "#1C1815" }}>
            Reproductive Performance
          </h1>
          <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
            {totalEventCount > 0
              ? `${totalEventCount} recent events · SA target: Pregnancy Rate ≥85% · Calving Interval ≤365d`
              : "No reproductive events recorded yet — log heat, insemination, scan or calving via the Logger"}
          </p>
        </div>

        {/* KPI Row 1 — Rate KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <MobKPICard
            label="Pregnancy Rate"
            value={stats.pregnancyRate !== null ? `${stats.pregnancyRate}%` : "—"}
            sub={
              stats.pregnancyRate !== null
                ? stats.pregnancyRate >= 85
                  ? "SA target met (≥85%)"
                  : `SA target ≥85% · ${stats.pregnancyRate < 70 ? "below minimum" : "below target"}`
                : "Log reproductive events to calculate"
            }
            detail={stats.pregnancyRate !== null ? (stats.pregnancyRate >= 85 ? "On target" : stats.pregnancyRate >= 70 ? "Monitor" : "Below target") : undefined}
            status={rateStatus(stats.pregnancyRate)}
            icon="🤰"
          />
          <MobKPICard
            label="Calving Rate"
            value={stats.calvingRate !== null ? `${stats.calvingRate}%` : "—"}
            sub={
              stats.calvingRate !== null
                ? stats.calvingRate >= 85
                  ? "SA target met (≥85%)"
                  : `SA target ≥85% · SA commercial avg ~62%`
                : "Log calving events to calculate"
            }
            detail={stats.calvingRate !== null ? (stats.calvingRate >= 85 ? "On target" : stats.calvingRate >= 70 ? "Monitor" : "Below target") : undefined}
            status={rateStatus(stats.calvingRate)}
            icon="🐮"
          />
          <MobKPICard
            label="Avg Calving Interval"
            value={stats.avgCalvingIntervalDays !== null ? `${stats.avgCalvingIntervalDays}d` : "—"}
            sub={
              stats.avgCalvingIntervalDays !== null
                ? stats.avgCalvingIntervalDays <= 365
                  ? "ARC target met (≤365d)"
                  : `ARC target ≤365d · currently ${stats.avgCalvingIntervalDays - 365}d over`
                : "Need ≥2 calvings per animal to calculate"
            }
            detail={
              stats.avgCalvingIntervalDays !== null
                ? stats.avgCalvingIntervalDays <= 365
                  ? "On target"
                  : stats.avgCalvingIntervalDays <= 395
                  ? "Monitor"
                  : "Above target"
                : undefined
            }
            status={intervalStatus(stats.avgCalvingIntervalDays)}
            icon="📅"
          />
        </div>

        {/* KPI Row 2 — Activity KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <MobKPICard
            label="In Heat (7 days)"
            value={stats.inHeat7d}
            sub={stats.inHeat7d === 0 ? "No animals flagged" : "Animals showing oestrus"}
            status={stats.inHeat7d > 0 ? "warning" : "neutral"}
            icon="🔥"
          />
          <MobKPICard
            label="Inseminations (30 days)"
            value={stats.inseminations30d}
            sub={stats.inseminations30d === 0 ? "None recorded" : "Services logged"}
            status={stats.inseminations30d > 0 ? "good" : "neutral"}
            icon="💉"
          />
          <MobKPICard
            label="Calvings Due (30 days)"
            value={stats.calvingsDue30d}
            sub={
              stats.upcomingCalvings.length === 0
                ? "No inseminations on record"
                : `Based on ${stats.upcomingCalvings[0]?.source === "scan" ? "scan" : "insemination"} + ${GESTATION_DAYS}d gestation`
            }
            status={stats.calvingsDue30d > 0 ? "warning" : "neutral"}
            icon="🐄"
          />
        </div>

        {/* Expected Calvings table */}
        <div
          className="rounded-2xl border mb-6"
          style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
        >
          <div className="px-6 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
            <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
              Expected Calvings
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
              Scan date or insemination date + {GESTATION_DAYS} days · showing next 90 days
            </p>
          </div>
          {stats.upcomingCalvings.length === 0 ? (
            <p className="px-6 py-5 text-sm" style={{ color: "#9C8E7A" }}>
              No upcoming calvings calculated. Log insemination or pregnancy scan events via the Logger.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-xs font-semibold uppercase tracking-wide"
                    style={{ color: "#9C8E7A", borderBottom: "1px solid #E0D5C8" }}
                  >
                    <th className="px-6 py-3 text-left">Animal</th>
                    <th className="px-4 py-3 text-left">Camp</th>
                    <th className="px-4 py-3 text-left">Source</th>
                    <th className="px-4 py-3 text-left">Expected Calving</th>
                    <th className="px-4 py-3 text-right">Days Away</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.upcomingCalvings.map((c) => {
                    const urgency = calvingUrgency(c.daysAway);
                    return (
                      <tr
                        key={c.animalId}
                        className="border-b last:border-0"
                        style={{ borderColor: "#F0EAE0" }}
                      >
                        <td className="px-6 py-3">
                          <Link
                            href={`/${farmSlug}/admin/animals/${c.animalId}?tab=reproduction`}
                            className="font-mono font-semibold hover:underline"
                            style={{ color: "#1C1815" }}
                          >
                            {c.animalId}
                          </Link>
                        </td>
                        <td className="px-4 py-3" style={{ color: "#6B5E50" }}>
                          {c.campName}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={
                              c.source === "scan"
                                ? { backgroundColor: "rgba(74,124,89,0.12)", color: "#4A7C59" }
                                : { backgroundColor: "rgba(139,105,20,0.12)", color: "#7A5C00" }
                            }
                          >
                            {c.source === "scan" ? "Scan confirmed" : "Insemination"}
                          </span>
                        </td>
                        <td className="px-4 py-3 tabular-nums" style={{ color: "#1C1815" }}>
                          {formatDate(c.expectedCalving)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className="text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full"
                            style={
                              urgency === "alert"
                                ? { backgroundColor: "rgba(220,38,38,0.1)", color: "#991B1B" }
                                : urgency === "warning"
                                ? { backgroundColor: "rgba(245,158,11,0.12)", color: "#92400E" }
                                : { backgroundColor: "rgba(34,197,94,0.1)", color: "#166534" }
                            }
                          >
                            {c.daysAway < 0
                              ? `${Math.abs(c.daysAway)}d overdue`
                              : `${c.daysAway}d`}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pregnancy Scan Results */}
        <div
          className="rounded-2xl border mb-6"
          style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
        >
          <div className="px-6 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
            <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
              Pregnancy Scan Results
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
              Most recent scan per animal · SA commercial target ≥80% conception rate
            </p>
          </div>
          <div className="px-6 py-5 grid grid-cols-3 gap-4">
            {(
              [
                { key: "pregnant" as const, label: "Pregnant", color: "#166534", bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.2)" },
                { key: "empty"    as const, label: "Empty",    color: "#991B1B", bg: "rgba(220,38,38,0.07)", border: "rgba(220,38,38,0.2)" },
                { key: "uncertain"as const, label: "Recheck",  color: "#92400E", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)" },
              ] as const
            ).map((item) => (
              <div
                key={item.key}
                className="rounded-xl p-4 text-center"
                style={{ backgroundColor: item.bg, border: `1px solid ${item.border}` }}
              >
                <p className="text-3xl font-bold tabular-nums" style={{ color: item.color }}>
                  {stats.scanCounts[item.key]}
                </p>
                <p className="text-xs font-medium mt-1" style={{ color: item.color }}>
                  {item.label}
                </p>
              </div>
            ))}
          </div>
          {stats.conceptionRate !== null && (
            <div className="px-6 pb-5 pt-1 flex items-center gap-2" style={{ borderTop: "1px solid #F0EAE0" }}>
              <span className="text-sm font-semibold" style={{ color: "#1C1815" }}>
                Scan conception rate:
              </span>
              <span
                className="text-sm font-bold px-2 py-0.5 rounded-full"
                style={
                  stats.conceptionRate >= 80
                    ? { backgroundColor: "rgba(34,197,94,0.1)", color: "#166534" }
                    : { backgroundColor: "rgba(245,158,11,0.12)", color: "#92400E" }
                }
              >
                {stats.conceptionRate}%
              </span>
              <span className="text-xs" style={{ color: "#9C8E7A" }}>(target ≥80%)</span>
            </div>
          )}
        </div>

        {/* Recent Events timeline */}
        <div
          className="rounded-2xl border"
          style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
        >
          <div className="px-6 py-4 border-b" style={{ borderColor: "#E0D5C8" }}>
            <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
              Recent Events
            </h2>
          </div>
          {recentTimeline.length === 0 ? (
            <p className="px-6 py-5 text-sm" style={{ color: "#9C8E7A" }}>
              No reproductive events recorded yet.
            </p>
          ) : (
            <div className="px-6 py-4" style={{ borderLeft: "2px solid #E0D5C8", marginLeft: "29px" }}>
              {recentTimeline.map((obs) => {
                const det = parseDetails(obs.details);
                const cfg = EVENT_CONFIG[obs.type] ?? { label: obs.type, dotColor: "#9C8E7A" };
                const campName = campMap.get(obs.campId) ?? obs.campId;

                let subDetail = "";
                if (obs.type === "heat_detection") {
                  subDetail = det.method === "scratch_card" ? "Scratch card" : "Visual";
                } else if (obs.type === "insemination") {
                  subDetail = det.method === "AI" ? "AI" : "Natural service";
                  if (det.bullId) subDetail += ` · ${det.bullId}`;
                } else if (obs.type === "pregnancy_scan") {
                  subDetail =
                    det.result === "pregnant"
                      ? "Pregnant"
                      : det.result === "empty"
                      ? "Empty"
                      : "Uncertain — recheck";
                } else if (obs.type === "calving") {
                  subDetail = det.calf_status === "live" ? "Live calf" : "Stillborn";
                  if (det.calf_tag) subDetail += ` · ${det.calf_tag}`;
                }

                return (
                  <div key={obs.id} className="relative flex items-start gap-4 pl-5 py-2 -ml-px">
                    <div
                      className="absolute left-0 top-[11px] w-2.5 h-2.5 rounded-full -translate-x-[6px]"
                      style={{ background: cfg.dotColor, border: "2px solid #FFFFFF", boxShadow: `0 0 0 1px ${cfg.dotColor}` }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium" style={{ color: "#1C1815" }}>
                          {cfg.label}
                        </span>
                        {subDetail && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(139,105,20,0.1)", color: "#8B6914" }}
                          >
                            {subDetail}
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
                        {formatDate(obs.observedAt)}
                        {obs.animalId && (
                          <>
                            {" · "}
                            <Link
                              href={`/${farmSlug}/admin/animals/${obs.animalId}?tab=reproduction`}
                              className="hover:underline"
                            >
                              {obs.animalId}
                            </Link>
                          </>
                        )}
                        {` · ${campName}`}
                        {obs.loggedBy && ` · ${obs.loggedBy}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Type-check and build**

```bash
cd "/Users/lucvanrhyn/Documents/Obsidian Vault/MainHub/Farm.project/farm-management"
rm -rf .tsbuildinfo .next/cache/tsbuildinfo 2>/dev/null; pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add "app/[farmSlug]/admin/reproduction/page.tsx"
git commit -m "feat: refactor reproduction page with SA-benchmarked 6-card KPI grid"
```

---

## Task 5: Add Reproductive Overview card to Admin Overview page

**Files:**
- Modify: `app/[farmSlug]/admin/page.tsx`

> **Context:** The admin overview page currently has a 2-column bottom grid (Recent Health Incidents + Camp Status Summary). We add `getReproStats(prisma)` to the existing `Promise.all`, add a Reproductive Overview card as the 3rd column, and expand the grid to `xl:grid-cols-3`.

- [ ] **Step 1: Add import for getReproStats**

At the top of `app/[farmSlug]/admin/page.tsx`, add the import alongside existing imports:

```ts
import { getReproStats } from "@/lib/server/reproduction-analytics";
```

- [ ] **Step 2: Add getReproStats to the Promise.all block**

Replace:

```ts
  const [healthIssuesThisWeek, inspectedToday, recentHealth, liveConditions, lowGrazingCount] = await Promise.all([
    countHealthIssuesSince(prisma, sevenDaysAgo),
    countInspectedToday(prisma),
    getRecentHealthObservations(prisma, 8),
    getLatestCampConditions(prisma),
    getLowGrazingCampCount(prisma),
  ]);
```

With:

```ts
  const [healthIssuesThisWeek, inspectedToday, recentHealth, liveConditions, lowGrazingCount, reproStats] = await Promise.all([
    countHealthIssuesSince(prisma, sevenDaysAgo),
    countInspectedToday(prisma),
    getRecentHealthObservations(prisma, 8),
    getLatestCampConditions(prisma),
    getLowGrazingCampCount(prisma),
    getReproStats(prisma),
  ]);
```

- [ ] **Step 3: Expand grid and add Reproductive Overview card**

Replace:

```tsx
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
```

With:

```tsx
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
```

After the closing `</div>` of the Camp Status Summary card (before `<DangerZone />`), add the Reproductive Overview card:

```tsx
          {/* Reproductive Overview card */}
          <div
            className="rounded-xl p-4"
            style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
          >
            <div className="flex items-center justify-between mb-3">
              <h2
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: "#9C8E7A" }}
              >
                Reproductive Overview
              </h2>
              <Link
                href={`/${farmSlug}/admin/reproduction`}
                className="text-xs font-mono hover:underline"
                style={{ color: "#4A7C59" }}
              >
                View Reproduction →
              </Link>
            </div>

            {reproStats.pregnancyRate === null && reproStats.inHeat7d === 0 && reproStats.calvingsDue30d === 0 ? (
              <div>
                <p className="text-xs" style={{ color: "#9C8E7A" }}>No reproductive events recorded yet.</p>
                <Link
                  href={`/${farmSlug}/logger`}
                  className="text-xs font-medium mt-2 inline-block hover:underline"
                  style={{ color: "#4A7C59" }}
                >
                  Start in Logger →
                </Link>
              </div>
            ) : (
              <>
                <div className="flex gap-4 mb-3">
                  <div>
                    <p className="text-xs" style={{ color: "#9C8E7A" }}>Pregnancy Rate</p>
                    <p className="text-lg font-bold font-mono" style={{ color: "#1C1815" }}>
                      {reproStats.pregnancyRate !== null ? `${reproStats.pregnancyRate}%` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs" style={{ color: "#9C8E7A" }}>Calvings Due (30d)</p>
                    <p className="text-lg font-bold font-mono" style={{ color: "#1C1815" }}>
                      {reproStats.calvingsDue30d}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs" style={{ color: "#9C8E7A" }}>In Heat (7d)</p>
                    <p className="text-lg font-bold font-mono" style={{ color: "#1C1815" }}>
                      {reproStats.inHeat7d}
                    </p>
                  </div>
                </div>
                {reproStats.pregnancyRate !== null && reproStats.pregnancyRate < 70 && (
                  <p className="text-xs font-medium" style={{ color: "#8B6914" }}>
                    ⚠ Below SA target (≥85% pregnancy rate)
                  </p>
                )}
              </>
            )}
          </div>
```

- [ ] **Step 4: Type-check**

```bash
cd "/Users/lucvanrhyn/Documents/Obsidian Vault/MainHub/Farm.project/farm-management"
rm -rf .tsbuildinfo .next/cache/tsbuildinfo 2>/dev/null; pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add "app/[farmSlug]/admin/page.tsx"
git commit -m "feat: add Reproductive Overview card to admin overview, expand grid to 3 cols"
```

---

## Task 6: Replace animal detail page with tabbed lifecycle view

**Files:**
- Modify: `app/[farmSlug]/admin/animals/[id]/page.tsx`

> **Context:** The current page has a simple observation history list. We replace it with a 5-tab lifecycle view: Overview (existing animal info), Reproduction, Health, Movement, Weight & ADG (placeholder). The tab is controlled by `?tab=` search param — server-readable, no client state needed. Animal IDs in the Reproduction tab link back to `/admin/reproduction`.

- [ ] **Step 1: Replace the entire file**

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getCategoryLabel, getCategoryChipColor, getAnimalAge } from "@/lib/utils";
import type { AnimalCategory } from "@/lib/types";
import AnimalActions from "@/components/admin/finansies/AnimalActions";
import AdminNav from "@/components/admin/AdminNav";

export const dynamic = "force-dynamic";

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function parseDetails(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

const TABS = [
  { id: "overview",     label: "Overview"     },
  { id: "reproduction", label: "Reproduction" },
  { id: "health",       label: "Health"       },
  { id: "movement",     label: "Movement"     },
  { id: "weight",       label: "Weight & ADG" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default async function AnimalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ farmSlug: string; id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { farmSlug, id } = await params;
  const { tab: rawTab = "overview" } = await searchParams;
  const activeTab: TabId = TABS.some((t) => t.id === rawTab)
    ? (rawTab as TabId)
    : "overview";

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p>Farm not found.</p>;

  const animal = await prisma.animal.findUnique({ where: { animalId: id } });
  if (!animal) notFound();

  const [observations, camp, allCamps] = await Promise.all([
    prisma.observation.findMany({
      where: { animalId: id },
      orderBy: { observedAt: "desc" },
      take: 200,
    }),
    prisma.camp.findFirst({ where: { campId: animal.currentCamp } }),
    prisma.camp.findMany({ select: { campId: true, campName: true } }),
  ]);

  const campMap = new Map(allCamps.map((c) => [c.campId, c.campName]));

  // Group observations by type
  const reproObs = observations.filter((o) =>
    ["heat_detection", "insemination", "pregnancy_scan", "calving"].includes(o.type)
  );
  const healthObs = observations.filter((o) => o.type === "health_issue");
  const movementObs = observations.filter((o) => o.type === "animal_movement");

  const REPRO_BADGE: Record<string, { label: string; bg: string; color: string }> = {
    heat_detection: { label: "Heat",       bg: "rgba(212,126,181,0.15)", color: "#8B2F7A" },
    insemination:   { label: "Insemination", bg: "rgba(139,105,20,0.12)", color: "#7A5C00" },
    pregnancy_scan: { label: "Scan",        bg: "rgba(74,124,89,0.12)", color: "#2A6040" },
    calving:        { label: "Calving",     bg: "rgba(42,139,122,0.12)", color: "#1A6B5A" },
  };

  const SEVERITY_BADGE: Record<string, { bg: string; color: string }> = {
    low:      { bg: "rgba(139,105,20,0.1)", color: "#7A5C00" },
    moderate: { bg: "rgba(192,87,76,0.1)", color: "#A0402B" },
    high:     { bg: "rgba(139,58,58,0.15)", color: "#8B1A1A" },
    critical: { bg: "rgba(100,20,20,0.2)", color: "#6B0000" },
  };

  const tabHref = (t: TabId) => `/${farmSlug}/admin/animals/${id}?tab=${t}`;

  return (
    <div className="flex min-h-screen bg-[#FAFAF8]">
      <AdminNav />
      <main className="flex-1 min-w-0 p-4 md:p-8 max-w-4xl">
        {/* Back */}
        <Link
          href={`/${farmSlug}/admin/animals`}
          className="inline-flex items-center gap-1 text-sm mb-4 hover:opacity-70"
          style={{ color: "#9C8E7A" }}
        >
          ← Back to Animals
        </Link>

        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap mb-6">
          <h1 className="text-2xl font-bold font-mono" style={{ color: "#1C1815" }}>
            {animal.animalId}
          </h1>
          {animal.name && (
            <span className="text-lg" style={{ color: "#9C8E7A" }}>— {animal.name}</span>
          )}
          <span
            className={`px-2.5 py-1 rounded-full text-sm font-medium ${getCategoryChipColor(animal.category as AnimalCategory)}`}
          >
            {getCategoryLabel(animal.category as AnimalCategory)}
          </span>
          {animal.status === "Active" && (
            <div className="ml-auto">
              <AnimalActions animalId={animal.animalId} campId={animal.currentCamp} variant="detail" />
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div
          className="flex gap-1 rounded-xl p-1 mb-6 overflow-x-auto"
          style={{ background: "#EEEBE6", border: "1px solid #E0D5C8" }}
        >
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={tabHref(t.id)}
              className="px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
              style={
                activeTab === t.id
                  ? { background: "#FFFFFF", color: "#1C1815", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }
                  : { color: "#9C8E7A" }
              }
            >
              {t.label}
            </Link>
          ))}
        </div>

        {/* ─── Tab: Overview ─────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div
            className="rounded-2xl border p-5"
            style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
          >
            <h2 className="text-sm font-semibold mb-4" style={{ color: "#9C8E7A" }}>
              Identity
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs" style={{ color: "#9C8E7A" }}>Sex</p>
                <p className="font-semibold" style={{ color: "#1C1815" }}>{animal.sex}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "#9C8E7A" }}>Breed</p>
                <p className="font-semibold" style={{ color: "#1C1815" }}>{animal.breed}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "#9C8E7A" }}>Age</p>
                <p className="font-semibold" style={{ color: "#1C1815" }}>
                  {getAnimalAge(animal.dateOfBirth ?? undefined)}
                </p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "#9C8E7A" }}>Date of Birth</p>
                <p className="font-semibold" style={{ color: "#1C1815" }}>
                  {animal.dateOfBirth ?? "Unknown"}
                </p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "#9C8E7A" }}>Current Camp</p>
                <Link
                  href={`/${farmSlug}/dashboard/camp/${animal.currentCamp}`}
                  className="font-semibold hover:underline"
                  style={{ color: "#4A7C59" }}
                >
                  {camp?.campName ?? animal.currentCamp}
                </Link>
              </div>
              <div>
                <p className="text-xs" style={{ color: "#9C8E7A" }}>Status</p>
                <span
                  className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
                  style={
                    animal.status === "Active"
                      ? { background: "rgba(74,124,89,0.12)", color: "#2A6040" }
                      : animal.status === "Sold"
                      ? { background: "rgba(156,142,122,0.12)", color: "#6B5E50" }
                      : { background: "rgba(192,87,76,0.12)", color: "#A0402B" }
                  }
                >
                  {animal.status}
                </span>
              </div>
              {animal.motherId && (
                <div>
                  <p className="text-xs" style={{ color: "#9C8E7A" }}>Mother</p>
                  <Link
                    href={`/${farmSlug}/admin/animals/${animal.motherId}`}
                    className="font-mono font-semibold hover:underline"
                    style={{ color: "#4A7C59" }}
                  >
                    {animal.motherId}
                  </Link>
                </div>
              )}
              {animal.fatherId && (
                <div>
                  <p className="text-xs" style={{ color: "#9C8E7A" }}>Sire (Bull)</p>
                  <Link
                    href={`/${farmSlug}/admin/animals/${animal.fatherId}`}
                    className="font-mono font-semibold hover:underline"
                    style={{ color: "#4A7C59" }}
                  >
                    {animal.fatherId}
                  </Link>
                </div>
              )}
              {animal.notes && (
                <div className="col-span-2 md:col-span-3">
                  <p className="text-xs" style={{ color: "#9C8E7A" }}>Notes</p>
                  <p style={{ color: "#1C1815" }}>{animal.notes}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Tab: Reproduction ─────────────────────────────────────── */}
        {activeTab === "reproduction" && (
          <div
            className="rounded-2xl border p-5"
            style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold" style={{ color: "#9C8E7A" }}>
                Reproductive History
              </h2>
              <Link
                href={`/${farmSlug}/admin/reproduction`}
                className="text-xs font-mono hover:underline"
                style={{ color: "#4A7C59" }}
              >
                View all farm repro →
              </Link>
            </div>
            {reproObs.length === 0 ? (
              <p className="text-sm" style={{ color: "#9C8E7A" }}>
                No reproductive events recorded for this animal.
              </p>
            ) : (
              <ol className="space-y-3">
                {reproObs.map((obs) => {
                  const d = parseDetails(obs.details);
                  const badge = REPRO_BADGE[obs.type] ?? { label: obs.type, bg: "rgba(156,142,122,0.1)", color: "#6B5E50" };

                  let detail = "";
                  if (obs.type === "heat_detection") {
                    detail = d.method === "scratch_card" ? "Scratch card" : "Visual";
                  } else if (obs.type === "insemination") {
                    detail = d.method === "AI" ? "AI" : "Natural service";
                    if (d.bullId) detail += ` · Bull ${String(d.bullId)}`;
                  } else if (obs.type === "pregnancy_scan") {
                    detail =
                      d.result === "pregnant"
                        ? "Pregnant ✓"
                        : d.result === "empty"
                        ? "Empty"
                        : "Uncertain — recheck";
                  } else if (obs.type === "calving") {
                    detail = d.calf_status === "live" ? "Live calf" : "Stillborn";
                    if (d.calf_tag) detail += ` · Calf: ${String(d.calf_tag)}`;
                  }

                  return (
                    <li key={obs.id} className="flex gap-3 text-sm">
                      <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ background: badge.color }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-semibold"
                            style={{ background: badge.bg, color: badge.color }}
                          >
                            {badge.label}
                          </span>
                          {detail && (
                            <span className="text-sm" style={{ color: "#1C1815" }}>
                              {detail}
                            </span>
                          )}
                        </div>
                        <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
                          {formatDate(obs.observedAt)}
                          {obs.loggedBy && ` · ${obs.loggedBy}`}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}

        {/* ─── Tab: Health ───────────────────────────────────────────── */}
        {activeTab === "health" && (
          <div
            className="rounded-2xl border p-5"
            style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
          >
            <h2 className="text-sm font-semibold mb-4" style={{ color: "#9C8E7A" }}>
              Health History
            </h2>
            {healthObs.length === 0 ? (
              <p className="text-sm" style={{ color: "#9C8E7A" }}>
                No health issues recorded.
              </p>
            ) : (
              <ol className="space-y-4">
                {healthObs.map((obs) => {
                  const d = parseDetails(obs.details);
                  const symptoms = Array.isArray(d.symptoms)
                    ? (d.symptoms as string[]).join(", ")
                    : String(d.symptoms ?? "");
                  const severity = String(d.severity ?? "").toLowerCase();
                  const severityStyle = SEVERITY_BADGE[severity] ?? {
                    bg: "rgba(156,142,122,0.1)",
                    color: "#6B5E50",
                  };
                  return (
                    <li key={obs.id} className="flex gap-3 text-sm">
                      <span className="text-xl leading-none mt-0.5 shrink-0">🏥</span>
                      <div>
                        {symptoms && (
                          <p className="font-medium" style={{ color: "#1C1815" }}>
                            {symptoms}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {severity && (
                            <span
                              className="text-xs px-2 py-0.5 rounded-full font-medium capitalize"
                              style={{ background: severityStyle.bg, color: severityStyle.color }}
                            >
                              {severity}
                            </span>
                          )}
                          {d.treatment && (
                            <span className="text-xs" style={{ color: "#6B5E50" }}>
                              Treatment: {String(d.treatment)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
                          {formatDate(obs.observedAt)}
                          {obs.loggedBy && ` · ${obs.loggedBy}`}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}

        {/* ─── Tab: Movement ─────────────────────────────────────────── */}
        {activeTab === "movement" && (
          <div
            className="rounded-2xl border p-5"
            style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
          >
            <h2 className="text-sm font-semibold mb-4" style={{ color: "#9C8E7A" }}>
              Movement History
            </h2>
            {movementObs.length === 0 ? (
              <p className="text-sm" style={{ color: "#9C8E7A" }}>
                No movement records.
              </p>
            ) : (
              <ol className="space-y-3">
                {movementObs.map((obs) => {
                  const d = parseDetails(obs.details);
                  const fromCamp = String(d.sourceCampId ?? d.from_camp ?? "?");
                  const toCamp = String(d.destCampId ?? d.to_camp ?? "?");
                  const fromName = campMap.get(fromCamp) ?? fromCamp;
                  const toName = campMap.get(toCamp) ?? toCamp;
                  return (
                    <li key={obs.id} className="flex gap-3 text-sm">
                      <span className="text-xl leading-none mt-0.5 shrink-0">🚚</span>
                      <div>
                        <p className="font-medium" style={{ color: "#1C1815" }}>
                          {fromName} → {toName}
                        </p>
                        <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
                          {formatDate(obs.observedAt)}
                          {obs.loggedBy && ` · ${obs.loggedBy}`}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}

        {/* ─── Tab: Weight & ADG ─────────────────────────────────────── */}
        {activeTab === "weight" && (
          <div
            className="rounded-2xl border p-5"
            style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
          >
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-sm font-semibold" style={{ color: "#9C8E7A" }}>
                Weight & Daily Gain
              </h2>
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium opacity-50 cursor-not-allowed"
                style={{ background: "#E0D5C8", color: "#6B5E50" }}
              >
                Coming in next update
              </span>
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: "#1C1815" }}>
              No weighing sessions recorded yet
            </p>
            <p className="text-xs mb-4" style={{ color: "#9C8E7A" }}>
              Weigh this animal to track daily gain
            </p>
            <div
              className="rounded-xl flex items-center justify-center h-32"
              style={{
                border: "2px dashed #E0D5C8",
                color: "#9C8E7A",
                fontSize: "0.75rem",
              }}
            >
              Weight data will appear here
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/lucvanrhyn/Documents/Obsidian Vault/MainHub/Farm.project/farm-management"
rm -rf .tsbuildinfo .next/cache/tsbuildinfo 2>/dev/null; pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Full build**

```bash
cd "/Users/lucvanrhyn/Documents/Obsidian Vault/MainHub/Farm.project/farm-management"
pnpm build --webpack 2>&1 | tail -20
```

Expected: Build completes with no errors. Note the build output size — should not be significantly larger.

- [ ] **Step 4: Commit**

```bash
git add "app/[farmSlug]/admin/animals/[id]/page.tsx"
git commit -m "feat: replace animal detail page with 5-tab lifecycle view"
```

---

## Task 7: Final integration commit and deploy preparation

- [ ] **Step 1: Verify all 6 feature files are committed**

```bash
cd "/Users/lucvanrhyn/Documents/Obsidian Vault/MainHub/Farm.project/farm-management"
git log --oneline -8
```

Expected: 6 commits visible from this work session.

- [ ] **Step 2: Full build (pre-deploy gate)**

```bash
cd "/Users/lucvanrhyn/Documents/Obsidian Vault/MainHub/Farm.project/farm-management"
pnpm build --webpack 2>&1 | tail -20
```

Expected: `✓ Compiled successfully` with no errors.

- [ ] **Step 3: Update v3 progress memory**

In `/Users/lucvanrhyn/.claude/projects/-Users-lucvanrhyn-Documents-Obsidian-Vault-MainHub/memory/farmtrack-v3-progress.md`, update Phase 1B status from `🔲 NOT STARTED` to `✅ CODED · ❌ NOT COMMITTED · ❌ NOT DEPLOYED` and document the files changed.

---

## Verification Checklist (post-deploy)

After `vercel --prod`:

- [ ] Reproduction page: 6 KPI cards render; Pregnancy Rate, Calving Rate, Calving Interval show SA benchmark colours
- [ ] Reproduction page: Expected Calvings table has "Source" column (scan/insemination)
- [ ] Reproduction page: Animal links go to `?tab=reproduction`
- [ ] Admin overview: Reproductive Overview card appears as 3rd column in bottom grid
- [ ] Logger: Reproduction modal has 4th "Calving" option with live/stillborn toggle
- [ ] Animal detail: All 5 tabs render; Reproduction tab shows correct events; Weight & ADG shows placeholder badge (not a broken link)

---

## SA Benchmark Reference

| KPI | Red | Amber | Green |
|-----|-----|-------|-------|
| Pregnancy Rate | <70% | 70–84% | ≥85% |
| Calving Rate | <70% | 70–84% | ≥85% |
| Calving Interval | >395d | 366–395d | ≤365d |
