# Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DateRangePicker, Camp League Table, Financial Analytics Panel, and Data Health Score card to FarmTrack — all before the Friday 2026-04-03 demo.

**Architecture:** All features are additive. New server utility functions in `lib/server/`, client components in `components/admin/`, and new pages/API routes in `app/`. No Prisma schema changes. The Performance, Grafieke, and Reproduction pages become date-range-aware by reading `searchParams` and passing `from`/`to` to existing query functions.

**Tech Stack:** Next.js 16 App Router, Prisma 5 + Turso (libSQL), Tailwind (inline styles), Recharts 3, framer-motion, lucide-react, next-auth v4.

---

## Critical Rules (read before touching any file)

- **Build command:** `pnpm build --webpack` — never `--turbo`. Run from `farm-management/`.
- **Next.js 16 params:** All route params AND searchParams are Promises — always `await` them.
- **Never run `prisma db push`** — use Turso shell for schema changes (none needed here).
- **Styling:** inline `style={{}}` props, color palette: `#1C1815` text, `#FAFAF8` bg, `#9C8E7A` muted, `#4A7C59` green, `#8B6914` amber, `#C0574C` red, `#E0D5C8` border.
- **No dummy data.** All data from Prisma via `getPrismaForFarm(farmSlug)`.
- **`useSearchParams()` needs `<Suspense>`** when rendered inside server components.
- **Transaction.date** is stored as `YYYY-MM-DD` string — compare with `gte`/`lte` string comparisons.

---

## File Map

| Action | Path |
|--------|------|
| **Create** | `components/admin/DateRangePicker.tsx` |
| **Modify** | `app/[farmSlug]/admin/performance/page.tsx` |
| **Create** | `lib/server/league-analytics.ts` |
| **Create** | `components/admin/LeagueTable.tsx` |
| **Create** | `app/[farmSlug]/admin/league/page.tsx` |
| **Modify** | `components/admin/AdminNav.tsx` |
| **Create** | `lib/server/financial-analytics.ts` |
| **Create** | `app/api/[farmSlug]/financial-analytics/route.ts` |
| **Create** | `components/admin/FinancialAnalyticsPanel.tsx` |
| **Modify** | `app/[farmSlug]/admin/finansies/page.tsx` |
| **Create** | `lib/server/data-health.ts` |
| **Create** | `components/admin/DataHealthCard.tsx` |
| **Modify** | `app/[farmSlug]/admin/page.tsx` |
| **Modify** | `app/[farmSlug]/admin/grafieke/page.tsx` *(bonus — last)* |
| **Modify** | `app/[farmSlug]/admin/reproduction/page.tsx` *(bonus — last)* |

---

## Task 1: DateRangePicker component

**Files:**
- Create: `components/admin/DateRangePicker.tsx`

- [ ] **Step 1: Create the file**

```tsx
// components/admin/DateRangePicker.tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

const PRESETS = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "6m", days: 180 },
  { label: "12m", days: 365 },
];

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface Props {
  defaultDays?: number;
}

export default function DateRangePicker({ defaultDays = 90 }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentFrom = searchParams.get("from") ?? "";
  const currentTo = searchParams.get("to") ?? "";

  const setRange = useCallback(
    (from: string, to: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("from", from);
      params.set("to", to);
      router.replace(`?${params.toString()}`);
    },
    [router, searchParams],
  );

  const applyPreset = (days: number) => {
    const to = new Date();
    const from = new Date(Date.now() - days * 86_400_000);
    setRange(toYMD(from), toYMD(to));
  };

  const activeDays = currentFrom && currentTo
    ? Math.round((new Date(currentTo).getTime() - new Date(currentFrom).getTime()) / 86_400_000)
    : defaultDays;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map(({ label, days }) => {
        const isActive = currentFrom !== "" && Math.abs(activeDays - days) < 2;
        return (
          <button
            key={label}
            onClick={() => applyPreset(days)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: isActive ? "rgba(139,105,20,0.15)" : "transparent",
              color: isActive ? "#8B6914" : "#9C8E7A",
              border: `1px solid ${isActive ? "rgba(139,105,20,0.35)" : "#E0D5C8"}`,
            }}
          >
            {label}
          </button>
        );
      })}
      <div className="flex items-center gap-1.5 ml-2">
        <input
          type="date"
          value={currentFrom}
          onChange={(e) =>
            setRange(e.target.value, currentTo || toYMD(new Date()))
          }
          className="text-xs rounded-lg px-2 py-1.5 outline-none"
          style={{ background: "#F5F2EE", color: "#1C1815", border: "1px solid #E0D5C8" }}
        />
        <span className="text-xs" style={{ color: "#9C8E7A" }}>→</span>
        <input
          type="date"
          value={currentTo}
          onChange={(e) =>
            setRange(
              currentFrom || toYMD(new Date(Date.now() - defaultDays * 86_400_000)),
              e.target.value,
            )
          }
          className="text-xs rounded-lg px-2 py-1.5 outline-none"
          style={{ background: "#F5F2EE", color: "#1C1815", border: "1px solid #E0D5C8" }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd "farm-management" && pnpm build --webpack 2>&1 | tail -20
```

Expected: no TypeScript errors. If `useSearchParams` causes a warning about missing Suspense boundary, that's expected at this stage — it will be fixed when the component is used.

- [ ] **Step 3: Commit**

```bash
cd "farm-management" && git add components/admin/DateRangePicker.tsx
git commit -m "feat: add DateRangePicker client component with presets + custom range"
```

---

## Task 2: Wire DateRangePicker into Performance page

**Files:**
- Modify: `app/[farmSlug]/admin/performance/page.tsx`

The page reads `searchParams` (a Promise in Next.js 16) and filters `latestCondition` and `latestCover` queries by the date range. `DateRangePicker` is rendered wrapped in `<Suspense>`.

- [ ] **Step 1: Replace the full page file**

```tsx
// app/[farmSlug]/admin/performance/page.tsx
import { Suspense } from "react";
import PerformanceTable from "@/components/admin/PerformanceTable";
import ExportButton from "@/components/admin/ExportButton";
import DateRangePicker from "@/components/admin/DateRangePicker";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { calcDaysGrazingRemaining } from "@/lib/server/analytics";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ farmSlug: string }>;
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const { farmSlug } = await params;
  const { from, to } = searchParams ? await searchParams : {};
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p>Farm not found</p>;

  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to) : undefined;

  const camps = await prisma.camp.findMany({ orderBy: { campId: "asc" } });
  const rows = await Promise.all(
    camps.map(async (camp) => {
      const conditionWhere: Record<string, unknown> = {
        campId: camp.campId,
        type: "camp_condition",
      };
      if (fromDate) conditionWhere.observedAt = { gte: fromDate, ...(toDate && { lte: toDate }) };
      else if (toDate) conditionWhere.observedAt = { lte: toDate };

      const coverWhere: Record<string, unknown> = { campId: camp.campId };
      if (fromDate) coverWhere.recordedAt = { gte: fromDate, ...(toDate && { lte: toDate }) };
      else if (toDate) coverWhere.recordedAt = { lte: toDate };

      const [animalsByCategory, latestCondition, latestCover] = await Promise.all([
        prisma.animal.groupBy({
          by: ["category"],
          where: { currentCamp: camp.campId, status: "Active" },
          _count: { id: true },
        }),
        prisma.observation.findFirst({ where: conditionWhere, orderBy: { observedAt: "desc" } }),
        prisma.campCoverReading.findFirst({ where: coverWhere, orderBy: { recordedAt: "desc" } }),
      ]);

      const animalCount = animalsByCategory.reduce((sum, r) => sum + r._count.id, 0);
      const LSU_FACTOR: Record<string, number> = {
        Cow: 1.0, Bull: 1.2, Heifer: 0.7, Calf: 0.3, Ox: 1.1,
      };
      const totalLSU = animalsByCategory.reduce(
        (sum, r) => sum + r._count.id * (LSU_FACTOR[r.category] ?? 1.0),
        0,
      );
      const density =
        camp.sizeHectares && camp.sizeHectares > 0
          ? (totalLSU / camp.sizeHectares).toFixed(2)
          : null;

      let details: Record<string, string> | null = null;
      if (latestCondition?.details) {
        try {
          details = JSON.parse(latestCondition.details) as Record<string, string>;
        } catch {
          // malformed details — leave as null
        }
      }

      const daysGrazingRemaining =
        latestCover && camp.sizeHectares && camp.sizeHectares > 0
          ? calcDaysGrazingRemaining(
              latestCover.kgDmPerHa,
              latestCover.useFactor,
              camp.sizeHectares,
              animalsByCategory.map((r) => ({ category: r.category, count: r._count.id })),
            )
          : null;

      return {
        campId: camp.campId,
        campName: camp.campName,
        sizeHectares: camp.sizeHectares,
        animalCount,
        stockingDensity: density,
        grazingQuality: details?.grazing ?? null,
        fenceStatus: details?.fence ?? null,
        lastInspection: latestCondition?.observedAt
          ? new Date(latestCondition.observedAt).toISOString().split("T")[0]
          : null,
        coverCategory: latestCover?.coverCategory ?? null,
        daysGrazingRemaining:
          daysGrazingRemaining !== null ? Math.round(daysGrazingRemaining) : null,
      };
    }),
  );

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#1C1815]">Performance</h1>
          <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
            {camps.length} camps · stocking density, grazing, pasture cover
          </p>
        </div>
        <ExportButton farmSlug={farmSlug} exportType="camps" label="Export" />
      </div>
      <div className="mb-4">
        <Suspense fallback={<div className="h-9" />}>
          <DateRangePicker defaultDays={90} />
        </Suspense>
      </div>
      <PerformanceTable rows={rows} farmSlug={farmSlug} />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd "farm-management" && pnpm build --webpack 2>&1 | tail -20
```

Expected: Build succeeds. No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
cd "farm-management" && git add app/[farmSlug]/admin/performance/page.tsx
git commit -m "feat: add DateRangePicker to Performance page with date-range filtering"
```

---

## Task 3: League analytics server function

**Files:**
- Create: `lib/server/league-analytics.ts`

This function queries all camps, their active animals, weighing observations (batched per camp), and computes avg ADG using the same best-ADG logic as `weight-analytics.ts` (rolling90 → longRun → lastInterval).

- [ ] **Step 1: Create the file**

```ts
// lib/server/league-analytics.ts
import type { PrismaClient } from "@prisma/client";
import { calcDaysGrazingRemaining } from "./analytics";

export interface CampLeagueRow {
  campId: string;
  campName: string;
  sizeHectares: number | null;
  headcount: number;
  avgAdg: number | null;
  lsuPerHa: number | null;
  condition: "Good" | "Fair" | "Poor" | null;
  daysGrazingRemaining: number | null;
  lastInspection: string | null;
}

const LSU_FACTOR: Record<string, number> = {
  Cow: 1.0, Bull: 1.2, Heifer: 0.7, Calf: 0.3, Ox: 1.1,
};

function parseDetails(raw: string): Record<string, string> {
  try { return JSON.parse(raw) as Record<string, string>; }
  catch { return {}; }
}

function parseWeightDetails(raw: string): { weight_kg?: number } {
  try { return JSON.parse(raw) as { weight_kg?: number }; }
  catch { return {}; }
}

export async function getCampLeagueData(prisma: PrismaClient): Promise<CampLeagueRow[]> {
  const camps = await prisma.camp.findMany({ orderBy: { campId: "asc" } });

  const rows = await Promise.all(
    camps.map(async (camp) => {
      const [activeAnimals, latestCondition, latestCover] = await Promise.all([
        prisma.animal.findMany({
          where: { currentCamp: camp.campId, status: "Active" },
          select: { id: true, category: true },
        }),
        prisma.observation.findFirst({
          where: { campId: camp.campId, type: "camp_condition" },
          orderBy: { observedAt: "desc" },
        }),
        prisma.campCoverReading.findFirst({
          where: { campId: camp.campId },
          orderBy: { recordedAt: "desc" },
        }),
      ]);

      const headcount = activeAnimals.length;

      // LSU/ha
      const categoryCount = new Map<string, number>();
      for (const a of activeAnimals) {
        categoryCount.set(a.category, (categoryCount.get(a.category) ?? 0) + 1);
      }
      const totalLSU = [...categoryCount.entries()].reduce(
        (s, [cat, cnt]) => s + cnt * (LSU_FACTOR[cat] ?? 1.0),
        0,
      );
      const lsuPerHa =
        camp.sizeHectares && camp.sizeHectares > 0
          ? Math.round((totalLSU / camp.sizeHectares) * 100) / 100
          : null;

      // Batch-query all weighings for active animals in this camp
      const weighings =
        activeAnimals.length > 0
          ? await prisma.observation.findMany({
              where: {
                type: "weighing",
                animalId: { in: activeAnimals.map((a) => a.id) },
              },
              select: { animalId: true, observedAt: true, details: true },
              orderBy: { observedAt: "asc" },
            })
          : [];

      // Group by animal
      const byAnimal = new Map<string, { date: Date; weightKg: number }[]>();
      for (const obs of weighings) {
        if (!obs.animalId) continue;
        const d = parseWeightDetails(obs.details);
        if (typeof d.weight_kg !== "number") continue;
        const existing = byAnimal.get(obs.animalId) ?? [];
        existing.push({ date: obs.observedAt, weightKg: d.weight_kg });
        byAnimal.set(obs.animalId, existing);
      }

      // Compute best ADG per animal (rolling90 → longRun → lastInterval)
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
      const adgs: number[] = [];
      for (const records of byAnimal.values()) {
        if (records.length < 2) continue;
        const last = records[records.length - 1];
        const first = records[0];

        let bestAdg: number | null = null;

        // rolling90
        const window90 = records.filter((r) => r.date >= ninetyDaysAgo);
        if (window90.length >= 2) {
          const days =
            (last.date.getTime() - window90[0].date.getTime()) / 86_400_000;
          if (days > 0) bestAdg = (last.weightKg - window90[0].weightKg) / days;
        } else if (window90.length === 1) {
          const baseIdx =
            records.findIndex((r) => r.date.getTime() === window90[0].date.getTime()) - 1;
          if (baseIdx >= 0) {
            const baseline = records[baseIdx];
            const days =
              (last.date.getTime() - baseline.date.getTime()) / 86_400_000;
            if (days > 0) bestAdg = (last.weightKg - baseline.weightKg) / days;
          }
        }

        // fallback: longRun
        if (bestAdg === null) {
          const days =
            (last.date.getTime() - first.date.getTime()) / 86_400_000;
          if (days > 0) bestAdg = (last.weightKg - first.weightKg) / days;
        }

        if (bestAdg !== null) adgs.push(bestAdg);
      }

      const avgAdg =
        adgs.length > 0
          ? Math.round((adgs.reduce((s, v) => s + v, 0) / adgs.length) * 100) / 100
          : null;

      // Condition from latest camp_condition observation
      let condition: "Good" | "Fair" | "Poor" | null = null;
      if (latestCondition?.details) {
        const details = parseDetails(latestCondition.details);
        const g = details.grazing;
        if (g === "Good" || g === "Fair" || g === "Poor") condition = g;
      }

      // Days grazing remaining
      const animalsByCategory = [...categoryCount.entries()].map(([category, count]) => ({
        category,
        count,
      }));
      const daysGrazingRemaining =
        latestCover && camp.sizeHectares && camp.sizeHectares > 0
          ? Math.round(
              calcDaysGrazingRemaining(
                latestCover.kgDmPerHa,
                latestCover.useFactor,
                camp.sizeHectares,
                animalsByCategory,
              ),
            )
          : null;

      const lastInspection = latestCondition?.observedAt
        ? new Date(latestCondition.observedAt).toISOString().slice(0, 10)
        : null;

      return {
        campId: camp.campId,
        campName: camp.campName,
        sizeHectares: camp.sizeHectares,
        headcount,
        avgAdg,
        lsuPerHa,
        condition,
        daysGrazingRemaining,
        lastInspection,
      };
    }),
  );

  return rows;
}
```

- [ ] **Step 2: Verify build**

```bash
cd "farm-management" && pnpm build --webpack 2>&1 | tail -20
```

Expected: Build succeeds. No TypeScript errors. The function is not yet used so it may produce an "unused" lint warning — that's fine.

- [ ] **Step 3: Commit**

```bash
cd "farm-management" && git add lib/server/league-analytics.ts
git commit -m "feat: add getCampLeagueData server function for camp league table"
```

---

## Task 4: LeagueTable client component

**Files:**
- Create: `components/admin/LeagueTable.tsx`

Sortable table — clicking a column header re-sorts. Rank badge uses gold/silver/bronze for top 3 when sorted by ADG. Each row links to `/{farmSlug}/admin/camps/{campId}`.

- [ ] **Step 1: Create the file**

```tsx
// components/admin/LeagueTable.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { CampLeagueRow } from "@/lib/server/league-analytics";

type SortKey = "rank" | "avgAdg" | "headcount" | "lsuPerHa" | "condition" | "daysGrazingRemaining" | "lastInspection";

const CONDITION_COLORS: Record<string, string> = {
  Good: "#4A7C59",
  Fair: "#8B6914",
  Poor: "#C0574C",
};

function MedalBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span title="Gold">🥇</span>;
  if (rank === 2) return <span title="Silver">🥈</span>;
  if (rank === 3) return <span title="Bronze">🥉</span>;
  return <span className="font-mono text-xs" style={{ color: "#9C8E7A" }}>{rank}</span>;
}

function AdgCell({ adg, threshold = 0.9 }: { adg: number | null; threshold?: number }) {
  if (adg === null) return <span style={{ color: "#9C8E7A" }}>—</span>;
  const color = adg > threshold ? "#4A7C59" : adg >= 0.7 ? "#8B6914" : "#C0574C";
  return (
    <span className="font-mono font-semibold" style={{ color }}>
      {adg.toFixed(2)}
    </span>
  );
}

interface Props {
  rows: CampLeagueRow[];
  farmSlug: string;
  campGrazingWarningDays?: number;
}

export default function LeagueTable({ rows, farmSlug, campGrazingWarningDays = 7 }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("avgAdg");
  const [asc, setAsc] = useState(false);

  const sorted = [...rows].sort((a, b) => {
    const dir = asc ? 1 : -1;
    if (sortKey === "avgAdg") {
      if (a.avgAdg === null && b.avgAdg === null) return 0;
      if (a.avgAdg === null) return 1;
      if (b.avgAdg === null) return -1;
      return dir * (a.avgAdg - b.avgAdg);
    }
    if (sortKey === "headcount") return dir * (a.headcount - b.headcount);
    if (sortKey === "lsuPerHa") {
      if (a.lsuPerHa === null && b.lsuPerHa === null) return 0;
      if (a.lsuPerHa === null) return 1;
      if (b.lsuPerHa === null) return -1;
      return dir * (a.lsuPerHa - b.lsuPerHa);
    }
    if (sortKey === "daysGrazingRemaining") {
      if (a.daysGrazingRemaining === null && b.daysGrazingRemaining === null) return 0;
      if (a.daysGrazingRemaining === null) return 1;
      if (b.daysGrazingRemaining === null) return -1;
      return dir * (a.daysGrazingRemaining - b.daysGrazingRemaining);
    }
    if (sortKey === "condition") {
      const order = { Good: 0, Fair: 1, Poor: 2 };
      const av = order[a.condition ?? ""] ?? 3;
      const bv = order[b.condition ?? ""] ?? 3;
      return dir * (av - bv);
    }
    if (sortKey === "lastInspection") {
      return dir * ((a.lastInspection ?? "").localeCompare(b.lastInspection ?? ""));
    }
    return 0;
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setAsc(!asc);
    else { setSortKey(key); setAsc(false); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => (
    <span className="ml-1 text-[10px]" style={{ color: sortKey === col ? "#8B6914" : "#9C8E7A" }}>
      {sortKey === col ? (asc ? "↑" : "↓") : "↕"}
    </span>
  );

  const ThBtn = ({ col, children }: { col: SortKey; children: React.ReactNode }) => (
    <button
      onClick={() => handleSort(col)}
      className="flex items-center gap-0.5 text-left w-full"
      style={{ color: sortKey === col ? "#8B6914" : "#9C8E7A" }}
    >
      {children}
      <SortIcon col={col} />
    </button>
  );

  if (rows.length === 0) {
    return (
      <p className="text-sm" style={{ color: "#9C8E7A" }}>
        No camps found. Add camps and observations to see the league table.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid #E0D5C8" }}>
      <table className="w-full text-sm" style={{ background: "#FFFFFF" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #E0D5C8", background: "#FAFAF8" }}>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A", width: "3rem" }}>
              <ThBtn col="rank">#</ThBtn>
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
              Camp
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
              <ThBtn col="avgAdg">Avg ADG</ThBtn>
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
              <ThBtn col="headcount">Head</ThBtn>
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
              <ThBtn col="lsuPerHa">LSU/ha</ThBtn>
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
              <ThBtn col="condition">Condition</ThBtn>
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
              <ThBtn col="daysGrazingRemaining">Days Grazing</ThBtn>
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
              <ThBtn col="lastInspection">Last Inspection</ThBtn>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const rank = i + 1;
            const daysColor =
              row.daysGrazingRemaining !== null
                ? row.daysGrazingRemaining <= campGrazingWarningDays
                  ? "#C0574C"
                  : row.daysGrazingRemaining <= campGrazingWarningDays * 2
                  ? "#8B6914"
                  : "#4A7C59"
                : "#9C8E7A";

            return (
              <tr
                key={row.campId}
                style={{ borderBottom: "1px solid #E0D5C8" }}
                className="hover:bg-[#F5F2EE] transition-colors"
              >
                <td className="px-3 py-3 text-center">
                  <MedalBadge rank={rank} />
                </td>
                <td className="px-3 py-3">
                  <Link
                    href={`/${farmSlug}/admin/camps/${row.campId}`}
                    className="font-medium hover:underline"
                    style={{ color: "#1C1815" }}
                  >
                    {row.campName}
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <AdgCell adg={row.avgAdg} />
                  {row.avgAdg !== null && (
                    <span className="ml-1 text-xs" style={{ color: "#9C8E7A" }}>kg/d</span>
                  )}
                </td>
                <td className="px-3 py-3 font-mono text-xs" style={{ color: "#1C1815" }}>
                  {row.headcount}
                </td>
                <td className="px-3 py-3 font-mono text-xs" style={{ color: "#1C1815" }}>
                  {row.lsuPerHa !== null ? row.lsuPerHa : "—"}
                </td>
                <td className="px-3 py-3">
                  {row.condition !== null ? (
                    <span className="flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: CONDITION_COLORS[row.condition] ?? "#9C8E7A" }}
                      />
                      <span className="text-xs" style={{ color: "#1C1815" }}>
                        {row.condition}
                      </span>
                    </span>
                  ) : (
                    <span style={{ color: "#9C8E7A" }}>—</span>
                  )}
                </td>
                <td className="px-3 py-3 font-mono text-xs" style={{ color: daysColor }}>
                  {row.daysGrazingRemaining !== null ? `${row.daysGrazingRemaining}d` : "—"}
                </td>
                <td className="px-3 py-3 font-mono text-xs" style={{ color: "#9C8E7A" }}>
                  {row.lastInspection ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd "farm-management" && pnpm build --webpack 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd "farm-management" && git add components/admin/LeagueTable.tsx
git commit -m "feat: add LeagueTable client component with sortable columns and medal badges"
```

---

## Task 5: League page + nav link

**Files:**
- Create: `app/[farmSlug]/admin/league/page.tsx`
- Modify: `components/admin/AdminNav.tsx`

- [ ] **Step 1: Create the league page**

```tsx
// app/[farmSlug]/admin/league/page.tsx
import LeagueTable from "@/components/admin/LeagueTable";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getCampLeagueData } from "@/lib/server/league-analytics";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LeaguePage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p>Farm not found</p>;

  const settings = await prisma.farmSettings.findFirst();
  const campGrazingWarningDays = settings?.campGrazingWarningDays ?? 7;

  const rows = await getCampLeagueData(prisma);

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[#1C1815]">Camp League</h1>
        <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
          {rows.length} camps · ranked by ADG — click any column to re-sort
        </p>
      </div>
      <LeagueTable rows={rows} farmSlug={farmSlug} campGrazingWarningDays={campGrazingWarningDays} />
    </div>
  );
}
```

- [ ] **Step 2: Add "League" to AdminNav.tsx**

Open `components/admin/AdminNav.tsx`. Add the import for `Trophy` from `lucide-react` and the nav item.

In the import block, add `Trophy` to the lucide-react imports:
```tsx
import {
  LayoutDashboard,
  ClipboardList,
  PawPrint,
  Tent,
  Upload,
  BarChart3,
  Receipt,
  HeartPulse,
  TrendingUp,
  Settings,
  FileDown,
  Trophy,       // ← add this
} from "lucide-react";
```

In `NAV_ITEMS`, add the league entry after Performance (still in "Data" group):
```tsx
  { path: "/admin/performance",   label: "Performance",   icon: TrendingUp,      group: "Data"    },
  { path: "/admin/league",        label: "League",        icon: Trophy,          group: "Data"    },  // ← add this line
  { path: "/admin/reproduction",  label: "Reproduction",  icon: HeartPulse,      group: "Data"    },
```

- [ ] **Step 3: Verify build**

```bash
cd "farm-management" && pnpm build --webpack 2>&1 | tail -20
```

Expected: Build succeeds. Navigate to `/{farmSlug}/admin/league` — table renders.

- [ ] **Step 4: Commit**

```bash
cd "farm-management" && git add app/[farmSlug]/admin/league/page.tsx components/admin/AdminNav.tsx
git commit -m "feat: add Camp League Table page with trophy nav link"
```

---

## Task 6: Financial analytics server function

**Files:**
- Create: `lib/server/financial-analytics.ts`

Computes gross margin, gross margin per head, cost of gain, and expenses by category for a given date range. Transaction.date is a `YYYY-MM-DD` string — use string `gte`/`lte` comparisons.

- [ ] **Step 1: Create the file**

```ts
// lib/server/financial-analytics.ts
import type { PrismaClient } from "@prisma/client";

export interface FinancialAnalyticsResult {
  grossMargin: number;
  grossMarginPerHead: number | null;
  costOfGain: number | null;
  totalIncome: number;
  totalExpenses: number;
  expensesByCategory: { category: string; amount: number }[];
}

function parseWeightDetails(raw: string): { weight_kg?: number } {
  try { return JSON.parse(raw) as { weight_kg?: number }; }
  catch { return {}; }
}

export async function getFinancialAnalytics(
  prisma: PrismaClient,
  from: Date,
  to: Date,
): Promise<FinancialAnalyticsResult> {
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  const [transactions, activeCount, weighingsRaw] = await Promise.all([
    prisma.transaction.findMany({
      where: { date: { gte: fromStr, lte: toStr } },
      select: { type: true, amount: true, category: true },
    }),
    prisma.animal.count({ where: { status: "Active" } }),
    // Fetch all weighings up to `to` (includes pre-period baselines)
    prisma.observation.findMany({
      where: {
        type: "weighing",
        observedAt: { lte: to },
        animalId: { not: null },
      },
      select: { animalId: true, observedAt: true, details: true },
      orderBy: { observedAt: "asc" },
    }),
  ]);

  // Gross margin
  let totalIncome = 0;
  let totalExpenses = 0;
  const expenseMap = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.type === "income") {
      totalIncome += tx.amount;
    } else {
      totalExpenses += tx.amount;
      expenseMap.set(tx.category, (expenseMap.get(tx.category) ?? 0) + tx.amount);
    }
  }
  const grossMargin = totalIncome - totalExpenses;
  const grossMarginPerHead = activeCount > 0 ? grossMargin / activeCount : null;

  // Expenses by category (sorted descending)
  const expensesByCategory = [...expenseMap.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  // Cost of gain: total expenses / total kg gained across animals with two readings bracketing period
  const byAnimal = new Map<string, { date: Date; weightKg: number }[]>();
  for (const obs of weighingsRaw) {
    if (!obs.animalId) continue;
    const d = parseWeightDetails(obs.details);
    if (typeof d.weight_kg !== "number") continue;
    const existing = byAnimal.get(obs.animalId) ?? [];
    existing.push({ date: obs.observedAt, weightKg: d.weight_kg });
    byAnimal.set(obs.animalId, existing);
  }

  let totalKgGained = 0;
  for (const records of byAnimal.values()) {
    // Baseline: last reading strictly before `from`
    const baseline = [...records].reverse().find((r) => r.date < from);
    // Latest reading within the period
    const inRange = records.filter((r) => r.date >= from && r.date <= to);
    const latest = inRange[inRange.length - 1];
    if (baseline && latest && latest.weightKg > baseline.weightKg) {
      totalKgGained += latest.weightKg - baseline.weightKg;
    }
  }
  const costOfGain = totalKgGained > 0 ? totalExpenses / totalKgGained : null;

  return {
    grossMargin,
    grossMarginPerHead,
    costOfGain,
    totalIncome,
    totalExpenses,
    expensesByCategory,
  };
}
```

- [ ] **Step 2: Verify build**

```bash
cd "farm-management" && pnpm build --webpack 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd "farm-management" && git add lib/server/financial-analytics.ts
git commit -m "feat: add getFinancialAnalytics server function (gross margin + cost of gain)"
```

---

## Task 7: Financial analytics API route

**Files:**
- Create: `app/api/[farmSlug]/financial-analytics/route.ts`

- [ ] **Step 1: Create the file**

```ts
// app/api/[farmSlug]/financial-analytics/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getFinancialAnalytics } from "@/lib/server/financial-analytics";
import type { SessionFarm } from "@/types/next-auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug } = await params;
  const accessible = (session.user?.farms as SessionFarm[] | undefined)?.some(
    (f) => f.slug === farmSlug,
  );
  if (!accessible) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return NextResponse.json({ error: "Farm not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam
    ? new Date(fromParam)
    : new Date(Date.now() - 30 * 86_400_000);

  // Validate dates
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "Invalid date params" }, { status: 400 });
  }

  const result = await getFinancialAnalytics(prisma, from, to);
  return NextResponse.json(result);
}
```

- [ ] **Step 2: Verify build**

```bash
cd "farm-management" && pnpm build --webpack 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd "farm-management" && git add "app/api/[farmSlug]/financial-analytics/route.ts"
git commit -m "feat: add /api/[farmSlug]/financial-analytics GET endpoint"
```

---

## Task 8: FinancialAnalyticsPanel client component

**Files:**
- Create: `components/admin/FinancialAnalyticsPanel.tsx`

Client component that renders a DateRangePicker, 3 stat cards, and a recharts BarChart. Fetches from the API using the current URL search params for date range. Must be wrapped in `<Suspense>` by its parent (finansies/page.tsx).

- [ ] **Step 1: Create the file**

```tsx
// components/admin/FinancialAnalyticsPanel.tsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import DateRangePicker from "@/components/admin/DateRangePicker";
import type { FinancialAnalyticsResult } from "@/lib/server/financial-analytics";

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function FinancialAnalyticsPanel({ farmSlug }: { farmSlug: string }) {
  const searchParams = useSearchParams();
  const rawFrom = searchParams.get("from");
  const rawTo = searchParams.get("to");

  // Resolve effective date range (default: last 30 days)
  const effectiveTo = rawTo ?? toYMD(new Date());
  const effectiveFrom = rawFrom ?? toYMD(new Date(Date.now() - 30 * 86_400_000));

  const [data, setData] = useState<FinancialAnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ from: effectiveFrom, to: effectiveTo });
    fetch(`/api/${farmSlug}/financial-analytics?${params.toString()}`)
      .then((r) => r.json())
      .then((d: FinancialAnalyticsResult) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [farmSlug, effectiveFrom, effectiveTo]);

  const fmt = (n: number) =>
    `R ${Math.abs(Math.round(n)).toLocaleString("en-ZA")}`;

  return (
    <div
      className="mt-8 rounded-xl p-4 md:p-6"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
            Financial Analytics
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
            {effectiveFrom} → {effectiveTo}
          </p>
        </div>
        <DateRangePicker defaultDays={30} />
      </div>

      {loading && (
        <div
          className="h-32 flex items-center justify-center text-xs"
          style={{ color: "#9C8E7A" }}
        >
          Loading…
        </div>
      )}

      {!loading && data && (
        <>
          {/* 3 stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            {[
              {
                label: "Gross Margin",
                value: fmt(data.grossMargin),
                color: data.grossMargin >= 0 ? "#4A7C59" : "#C0574C",
              },
              {
                label: "Gross Margin / Head",
                value:
                  data.grossMarginPerHead !== null
                    ? fmt(data.grossMarginPerHead)
                    : "—",
                color:
                  data.grossMarginPerHead !== null && data.grossMarginPerHead >= 0
                    ? "#4A7C59"
                    : "#C0574C",
              },
              {
                label: "Cost of Gain",
                value:
                  data.costOfGain !== null
                    ? `R ${data.costOfGain.toFixed(2)}/kg`
                    : "—",
                color: "#8B6914",
              },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="rounded-lg p-4"
                style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}
              >
                <p className="text-xs mb-1.5" style={{ color: "#9C8E7A" }}>
                  {label}
                </p>
                <p className="text-xl font-bold font-mono" style={{ color }}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* Expense breakdown bar chart */}
          {data.expensesByCategory.length > 0 ? (
            <div>
              <p
                className="text-xs font-semibold mb-3 uppercase tracking-wide"
                style={{ color: "#9C8E7A" }}
              >
                Expenses by Category
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={data.expensesByCategory}
                  margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
                >
                  <XAxis
                    dataKey="category"
                    tick={{ fontSize: 11, fill: "#9C8E7A" }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#9C8E7A" }}
                    width={65}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `R${(v / 1000).toFixed(0)}k` : `R${v}`
                    }
                  />
                  <Tooltip
                    formatter={(v: number) => [
                      `R ${v.toLocaleString("en-ZA")}`,
                      "Amount",
                    ]}
                    contentStyle={{
                      background: "#1A1510",
                      border: "1px solid rgba(139,105,20,0.3)",
                      borderRadius: "8px",
                      color: "#F5EBD4",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="amount" fill="#8B6914" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs" style={{ color: "#9C8E7A" }}>
              No expense transactions in this period.
            </p>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd "farm-management" && pnpm build --webpack 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd "farm-management" && git add components/admin/FinancialAnalyticsPanel.tsx
git commit -m "feat: add FinancialAnalyticsPanel with date picker and recharts bar chart"
```

---

## Task 9: Wire FinancialAnalyticsPanel into Finansies page

**Files:**
- Modify: `app/[farmSlug]/admin/finansies/page.tsx`

Add `<Suspense>` + `<FinancialAnalyticsPanel>` below the `<FinansiesClient>` component.

- [ ] **Step 1: Edit finansies/page.tsx**

Add these imports at the top of the file:
```tsx
import { Suspense } from "react";
import FinancialAnalyticsPanel from "@/components/admin/FinancialAnalyticsPanel";
```

Replace the return statement's outermost `<div>` content — add the panel after `</FinansiesClient>` and before the closing `</div>`:

The return block should end like this:
```tsx
  return (
    <div className="min-w-0 p-4 md:p-8 space-y-2 bg-[#FAFAF8]">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-[#1C1815]">Finance</h1>
          <div className="flex items-center gap-2">
            <ExportButton farmSlug={farmSlug} exportType="transactions" label="Export" />
            <ClearSectionButton endpoint="/api/transactions/reset" label="Clear All Transactions" />
          </div>
        </div>
        <FinansiesClient
          farmSlug={farmSlug}
          initialTransactions={transactions.map((t) => ({
            ...t,
            amount: t.amount,
          }))}
          initialIncome={incomeCategories}
          initialExpense={expenseCategories}
        />
        <Suspense fallback={<div className="mt-8 h-48 rounded-xl animate-pulse" style={{ background: "#F5F2EE" }} />}>
          <FinancialAnalyticsPanel farmSlug={farmSlug} />
        </Suspense>
    </div>
  );
```

- [ ] **Step 2: Verify build**

```bash
cd "farm-management" && pnpm build --webpack 2>&1 | tail -20
```

Expected: Build succeeds. Navigate to `/{farmSlug}/admin/finansies` — analytics panel appears below the transaction ledger.

- [ ] **Step 3: Commit**

```bash
cd "farm-management" && git add "app/[farmSlug]/admin/finansies/page.tsx"
git commit -m "feat: add FinancialAnalyticsPanel to Finansies page"
```

---

## Task 10: Data health server function

**Files:**
- Create: `lib/server/data-health.ts`

- [ ] **Step 1: Create the file**

```ts
// lib/server/data-health.ts
import type { PrismaClient } from "@prisma/client";

export interface DataHealthScore {
  overall: number;
  grade: "A" | "B" | "C" | "D";
  breakdown: {
    animalsWeighedRecently: { score: number; pct: number; label: string };
    campsInspectedRecently: { score: number; pct: number; label: string };
    animalsWithCampAssigned: { score: number; pct: number; label: string };
    transactionsThisMonth: { score: number; present: boolean; label: string };
  };
}

export async function getDataHealthScore(prisma: PrismaClient): Promise<DataHealthScore> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const currentMonth = now.toISOString().slice(0, 7); // "YYYY-MM"

  const [
    activeCount,
    totalCamps,
    weighedGroups,
    inspectedGroups,
    assignedCount,
    txThisMonth,
  ] = await Promise.all([
    prisma.animal.count({ where: { status: "Active" } }),
    prisma.camp.count(),
    prisma.observation.groupBy({
      by: ["animalId"],
      where: {
        type: "weighing",
        observedAt: { gte: thirtyDaysAgo },
        animalId: { not: null },
      },
    }),
    prisma.observation.groupBy({
      by: ["campId"],
      where: {
        type: "camp_condition",
        observedAt: { gte: sevenDaysAgo },
      },
    }),
    prisma.animal.count({
      where: { status: "Active", currentCamp: { not: null } },
    }),
    prisma.transaction.count({
      where: { date: { startsWith: currentMonth } },
    }),
  ]);

  const weighedCount = weighedGroups.length;
  const inspectedCount = inspectedGroups.length;

  const weighedPct = activeCount > 0 ? Math.min(1, weighedCount / activeCount) : 0;
  const inspectedPct = totalCamps > 0 ? Math.min(1, inspectedCount / totalCamps) : 0;
  const assignedPct = activeCount > 0 ? assignedCount / activeCount : 0;
  const hasTxThisMonth = txThisMonth > 0;

  const weighedScore = Math.round(weighedPct * 40);
  const inspectedScore = Math.round(inspectedPct * 30);
  const assignedScore = Math.round(assignedPct * 20);
  const txScore = hasTxThisMonth ? 10 : 0;

  const overall = weighedScore + inspectedScore + assignedScore + txScore;
  const grade: "A" | "B" | "C" | "D" =
    overall >= 80 ? "A" : overall >= 60 ? "B" : overall >= 40 ? "C" : "D";

  return {
    overall,
    grade,
    breakdown: {
      animalsWeighedRecently: {
        score: weighedScore,
        pct: Math.round(weighedPct * 100),
        label: `${weighedCount} of ${activeCount} animals weighed in last 30 days`,
      },
      campsInspectedRecently: {
        score: inspectedScore,
        pct: Math.round(inspectedPct * 100),
        label: `${inspectedCount} of ${totalCamps} camps inspected in last 7 days`,
      },
      animalsWithCampAssigned: {
        score: assignedScore,
        pct: Math.round(assignedPct * 100),
        label: `${assignedCount} of ${activeCount} active animals have a camp`,
      },
      transactionsThisMonth: {
        score: txScore,
        present: hasTxThisMonth,
        label: hasTxThisMonth
          ? "Transactions recorded this month"
          : "No transactions recorded this month",
      },
    },
  };
}
```

- [ ] **Step 2: Verify build**

```bash
cd "farm-management" && pnpm build --webpack 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd "farm-management" && git add lib/server/data-health.ts
git commit -m "feat: add getDataHealthScore server function (4-dimension health scoring)"
```

---

## Task 11: DataHealthCard component

**Files:**
- Create: `components/admin/DataHealthCard.tsx`

Displays grade letter, overall progress bar, and 4 dimension rows.

- [ ] **Step 1: Create the file**

```tsx
// components/admin/DataHealthCard.tsx
import type { DataHealthScore } from "@/lib/server/data-health";

const GRADE_COLORS: Record<string, string> = {
  A: "#4A7C59",
  B: "#8B6914",
  C: "#A0522D",
  D: "#C0574C",
};

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div
      className="w-full rounded-full overflow-hidden"
      style={{ background: "#F0EBE3", height: "6px" }}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.min(100, pct)}%`, background: color }}
      />
    </div>
  );
}

export default function DataHealthCard({ score }: { score: DataHealthScore }) {
  const gradeColor = GRADE_COLORS[score.grade] ?? "#9C8E7A";

  const dimensions = [
    {
      key: "animalsWeighedRecently",
      label: "Animals Weighed",
      hint: "last 30 days",
      pct: score.breakdown.animalsWeighedRecently.pct,
      weight: "40%",
    },
    {
      key: "campsInspectedRecently",
      label: "Camps Inspected",
      hint: "last 7 days",
      pct: score.breakdown.campsInspectedRecently.pct,
      weight: "30%",
    },
    {
      key: "animalsWithCampAssigned",
      label: "Camp Assigned",
      hint: "active animals",
      pct: score.breakdown.animalsWithCampAssigned.pct,
      weight: "20%",
    },
    {
      key: "transactionsThisMonth",
      label: "Transactions",
      hint: "this month",
      pct: score.breakdown.transactionsThisMonth.present ? 100 : 0,
      weight: "10%",
    },
  ] as const;

  return (
    <div
      className="rounded-xl p-4 flex flex-col"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <h2
        className="text-xs font-semibold uppercase tracking-wide mb-3"
        style={{ color: "#9C8E7A" }}
      >
        Data Health
      </h2>

      {/* Grade + overall score */}
      <div className="flex items-center gap-4 mb-4">
        <span
          className="text-5xl font-black font-mono leading-none"
          style={{ color: gradeColor }}
        >
          {score.grade}
        </span>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs" style={{ color: "#9C8E7A" }}>Overall score</span>
            <span className="text-xs font-mono font-bold" style={{ color: "#1C1815" }}>
              {score.overall}/100
            </span>
          </div>
          <ProgressBar pct={score.overall} color={gradeColor} />
        </div>
      </div>

      {/* 4 dimension rows */}
      <div className="flex flex-col gap-3">
        {dimensions.map(({ key, label, hint, pct, weight }) => {
          const dimColor = pct >= 80 ? "#4A7C59" : pct >= 50 ? "#8B6914" : "#C0574C";
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium" style={{ color: "#1C1815" }}>
                    {label}
                  </span>
                  <span className="text-[10px]" style={{ color: "#9C8E7A" }}>
                    {hint}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px]" style={{ color: "#9C8E7A" }}>
                    {weight}
                  </span>
                  <span className="text-xs font-mono font-bold" style={{ color: dimColor }}>
                    {pct}%
                  </span>
                </div>
              </div>
              <ProgressBar pct={pct} color={dimColor} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd "farm-management" && pnpm build --webpack 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd "farm-management" && git add components/admin/DataHealthCard.tsx
git commit -m "feat: add DataHealthCard component with grade + dimension progress bars"
```

---

## Task 12: Add DataHealthCard to admin dashboard

**Files:**
- Modify: `app/[farmSlug]/admin/page.tsx`

The bottom grid is `grid-cols-1 xl:grid-cols-4` with 4 cards. Add DataHealthCard as the 5th card — it will wrap to a new row on smaller screens and sit alongside the others on XL. The cleanest approach: add it after the 4-card grid as a full-width card (the grid stays as-is).

- [ ] **Step 1: Add import to admin/page.tsx**

At the top of `app/[farmSlug]/admin/page.tsx`, add:
```tsx
import DataHealthCard from "@/components/admin/DataHealthCard";
import { getDataHealthScore } from "@/lib/server/data-health";
```

- [ ] **Step 2: Add `getDataHealthScore` to the Promise.all block**

In the existing `Promise.all([...])`, add `getDataHealthScore(prisma)` as the last item:
```tsx
  const [
    healthIssuesThisWeek,
    inspectedToday,
    recentHealth,
    liveConditions,
    lowGrazingCount,
    reproStats,
    deathsToday,
    birthsToday,
    withdrawalCount,
    mtdTransactions,
    dashboardAlerts,
    dataHealth,            // ← new
  ] = await Promise.all([
    countHealthIssuesSince(prisma, sevenDaysAgo),
    countInspectedToday(prisma),
    getRecentHealthObservations(prisma, 8),
    getLatestCampConditions(prisma),
    getLowGrazingCampCount(prisma),
    getReproStats(prisma),
    prisma.observation.count({ where: { type: "death",   observedAt: { gte: todayStart } } }),
    prisma.observation.count({ where: { type: "calving", observedAt: { gte: todayStart } } }),
    getWithdrawalCount(prisma),
    prisma.transaction.findMany({ where: { date: { startsWith: currentMonth } } }),
    getDashboardAlerts(prisma, farmSlug, {
      adgPoorDoerThreshold: settings.adgPoorDoerThreshold,
      calvingAlertDays: settings.calvingAlertDays,
      daysOpenLimit: settings.daysOpenLimit,
      campGrazingWarningDays: settings.campGrazingWarningDays,
      staleCampInspectionHours: settings.alertThresholdHours,
    }),
    getDataHealthScore(prisma),   // ← new
  ]);
```

- [ ] **Step 3: Add DataHealthCard to the bottom grid**

Find the bottom grid `<div className="grid grid-cols-1 xl:grid-cols-4 gap-4">` and add `<DataHealthCard score={dataHealth} />` as the 5th child after the Quick Actions card:

```tsx
      {/* Bottom grid — 4 cards + data health */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* ... existing 4 cards unchanged ... */}
        <DataHealthCard score={dataHealth} />
      </div>
```

The grid will show 4 across on XL, with the 5th card starting a new row. This is fine for the demo.

- [ ] **Step 4: Verify build**

```bash
cd "farm-management" && pnpm build --webpack 2>&1 | tail -20
```

Expected: Build succeeds. Navigate to `/{farmSlug}/admin` — Data Health card appears below the 4-card grid.

- [ ] **Step 5: Commit**

```bash
cd "farm-management" && git add "app/[farmSlug]/admin/page.tsx"
git commit -m "feat: add DataHealthCard to admin dashboard"
```

---

## Task 13 (bonus): Wire DateRangePicker into Grafieke page

**Files:**
- Modify: `app/[farmSlug]/admin/grafieke/page.tsx`

> **Note:** Before implementing this task, read `grafieke/page.tsx` and `lib/server/analytics.ts` to understand what functions it calls. The pattern is: add `searchParams` prop → derive `from`/`to` Date objects → pass to analytics functions that accept `lookbackDays` (you'll need to check if they also accept explicit dates or if you need to compute `lookbackDays` from the range). Wrap `<DateRangePicker>` in `<Suspense>` at the top of the page.

- [ ] **Step 1: Read grafieke/page.tsx to understand current structure**

```bash
cat "farm-management/app/[farmSlug]/admin/grafieke/page.tsx"
```

- [ ] **Step 2: Add `searchParams` to the page signature**

The pattern (identical to performance/page.tsx):
```tsx
export default async function GrafiekePage({
  params,
  searchParams,
}: {
  params: Promise<{ farmSlug: string }>;
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  const { farmSlug } = await params;
  const { from, to } = searchParams ? await searchParams : {};
  // Compute lookbackDays from range or default to 365
  const lookbackDays = from && to
    ? Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000))
    : 365;
  // ... existing code passing lookbackDays to analytics functions
```

- [ ] **Step 3: Add DateRangePicker to the page JSX**

Wherever the page renders its heading/controls area, add:
```tsx
import { Suspense } from "react";
import DateRangePicker from "@/components/admin/DateRangePicker";
// ...
<div className="mb-4">
  <Suspense fallback={<div className="h-9" />}>
    <DateRangePicker defaultDays={365} />
  </Suspense>
</div>
```

- [ ] **Step 4: Verify build**

```bash
cd "farm-management" && pnpm build --webpack 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
cd "farm-management" && git add "app/[farmSlug]/admin/grafieke/page.tsx"
git commit -m "feat: add DateRangePicker to Grafieke page"
```

---

## Task 14 (bonus): Wire DateRangePicker into Reproduction page

**Files:**
- Modify: `app/[farmSlug]/admin/reproduction/page.tsx`

> **Note:** Same pattern as Task 13. Read the page first, add `searchParams`, derive `lookbackDays`, add `<DateRangePicker>` in `<Suspense>`.

- [ ] **Step 1: Read reproduction/page.tsx**

```bash
cat "farm-management/app/[farmSlug]/admin/reproduction/page.tsx"
```

- [ ] **Step 2: Apply the same pattern as Task 13 — add searchParams + DateRangePicker**

- [ ] **Step 3: Verify build**

```bash
cd "farm-management" && pnpm build --webpack 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
cd "farm-management" && git add "app/[farmSlug]/admin/reproduction/page.tsx"
git commit -m "feat: add DateRangePicker to Reproduction page"
```

---

## Final verification

After all tasks are complete:

- [ ] **Full build**

```bash
cd "farm-management" && rm -rf .next/cache/tsbuildinfo .tsbuildinfo && pnpm build --webpack 2>&1 | tail -30
```

Expected: `✓ Compiled successfully`.

- [ ] **Manual smoke test checklist**

1. `/{farmSlug}/admin` — Data Health card visible below the 4-card grid. Grade shown. Progress bars render.
2. `/{farmSlug}/admin/performance` — DateRangePicker renders at top. Clicking "30d" reloads page with `?from=...&to=...` and filters data.
3. `/{farmSlug}/admin/league` — Table renders with all camps. Medal badges on top 3. Clicking column header re-sorts. "League" link visible in sidebar.
4. `/{farmSlug}/admin/finansies` — Financial Analytics Panel renders below ledger. DateRangePicker shows. Stat cards show Gross Margin, Gross Margin/Head, Cost of Gain. Bar chart renders if expense data exists.
5. (bonus) `/{farmSlug}/admin/grafieke` — DateRangePicker renders. Changing range reloads with filtered charts.
6. (bonus) `/{farmSlug}/admin/reproduction` — DateRangePicker renders.
