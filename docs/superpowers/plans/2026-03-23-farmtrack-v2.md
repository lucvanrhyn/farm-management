# FarmTrack v2 — Production Readiness & Admin Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix data-connectivity bugs, add Performance tab, upgrade logger birth form, redesign admin UI, and create the `farmday` simulation skill.

**Architecture:** Four independent phases executed sequentially. Phases 1–2 are surgical fixes (no new abstractions). Phase 3 (admin UI) is a full visual overhaul — keep existing data-fetching server components, replace only the render/presentation layer. Phase 4 creates a new Playwright-based skill file.

**Tech Stack:** Next.js 16 App Router, Prisma 5 + Turso, Tailwind, framer-motion, Playwright CLI, lucide-react

---

## Files Affected

| Phase | File | Action |
|-------|------|--------|
| 1 | `app/[farmSlug]/logger/[campId]/page.tsx` | Fix `deceasedAt` in death handler |
| 1 | `app/[farmSlug]/admin/page.tsx` | Make KPI cards clickable links |
| 1 | `components/admin/CampsTableClient.tsx` | Remove "Map →" button |
| 2 | `components/admin/AdminNav.tsx` | Add Performance nav item |
| 2 | `app/[farmSlug]/admin/performance/page.tsx` | New: all-camps KPI table |
| 2 | `components/admin/PerformanceTable.tsx` | New: client table with sorting |
| 2 | `app/api/[farmSlug]/performance/route.ts` | New: aggregate KPI API |
| 2 | `components/logger/CalvingForm.tsx` | Full form: add animalId, fatherId, DOB, breed, category, notes |
| 3 | `app/[farmSlug]/admin/page.tsx` | Full Overview redesign |
| 3 | `components/admin/AdminNav.tsx` | Sidebar visual upgrade |
| 3 | `app/[farmSlug]/admin/animals/page.tsx` | Animals page redesign |
| 3 | `app/[farmSlug]/admin/animals/[id]/page.tsx` | Animal detail redesign |
| 3 | `app/[farmSlug]/admin/observations/page.tsx` | Observations redesign |
| 3 | `app/[farmSlug]/admin/camps/page.tsx` | Camps page redesign |
| 3 | `app/[farmSlug]/admin/reproduction/page.tsx` | Reproduction redesign |
| 4 | `~/.claude/skills/farmday/SKILL.md` | New skill file |

---

## Phase 1 — Bug Fixes (no new files)

### Task 1.1: Fix `deceasedAt` not stored on logger death

**Files:** `app/[farmSlug]/logger/[campId]/page.tsx:207-212`

The PATCH currently sends only `{ status: "Deceased" }`. The PATCH API handler already accepts `deceasedAt` in its allowed list — we just need to send it.

- [ ] **Step 1:** In `handleDeathSubmit`, update the PATCH body:
```ts
body: JSON.stringify({ status: "Deceased", deceasedAt: new Date().toISOString() }),
```
- [ ] **Step 2:** Verify in production: log a death in logger → admin Animals → Deceased tab → DECEASED ON date should appear.
- [ ] **Step 3:** Commit `fix: set deceasedAt when death logged via logger`

---

### Task 1.2: Make Overview KPI cards clickable

**Files:** `app/[farmSlug]/admin/page.tsx:76-136`

The four KPI cards (Animals, Camps, Inspections, Health) are plain `<div>`s. Wrap each in a `<Link>` pointing to the correct admin sub-page.

Routing map:
- Total Animals → `/${farmSlug}/admin/animals`
- Total Camps → `/${farmSlug}/admin/camps`
- Inspections Today → `/${farmSlug}/admin/observations`
- Health Issues → `/${farmSlug}/admin/observations` (observations filtered by health — just link there for now)

- [ ] **Step 1:** Import `Link` from `next/link` (already imported or add it).
- [ ] **Step 2:** Replace the `.map()` render with:

```tsx
// Add href to each stat object:
{ ..., href: `/${farmSlug}/admin/animals` },
{ ..., href: `/${farmSlug}/admin/camps` },
{ ..., href: `/${farmSlug}/admin/observations` },
{ ..., href: `/${farmSlug}/admin/observations` },

// Wrap div with Link:
<Link key={label} href={href} className="block p-5 transition-colors hover:bg-[#F5F2EE]" style={{ borderRight: ... }}>
  ...existing content...
</Link>
```

- [ ] **Step 3:** Commit `feat: make overview KPI cards clickable links`

---

### Task 1.3: Remove "Map →" button from camps table

**Files:** `components/admin/CampsTableClient.tsx:152-158`

Delete the Map link block entirely — the dashboard map is irrelevant from the admin context.

- [ ] **Step 1:** Remove lines 152–158 (the `<Link href=...Map →...` block).
- [ ] **Step 2:** Commit `chore: remove Map link from admin camps table`

---

## Phase 2 — New Features

### Task 2.1: Performance tab — API route

**Files (create):** `app/api/[farmSlug]/performance/route.ts`

Returns all camps with their latest KPIs (stocking density, last inspection, grazing quality, cover category, days remaining).

```ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForFarm } from "@/lib/farm-prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ farmSlug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return NextResponse.json({ error: "Farm not found" }, { status: 404 });

  const camps = await prisma.camp.findMany({ orderBy: { campId: "asc" } });

  const rows = await Promise.all(camps.map(async (camp) => {
    const [animalCount, latestCondition, latestCover] = await Promise.all([
      prisma.animal.count({ where: { currentCamp: camp.campId, status: "Active" } }),
      prisma.observation.findFirst({
        where: { campId: camp.campId, type: "camp_condition" },
        orderBy: { observedAt: "desc" },
      }),
      prisma.campCoverReading.findFirst({
        where: { campId: camp.campId },
        orderBy: { recordedAt: "desc" },
      }),
    ]);
    const density = camp.sizeHectares && camp.sizeHectares > 0
      ? (animalCount / camp.sizeHectares).toFixed(1)
      : null;
    const details = latestCondition?.details as Record<string, string> | null;
    return {
      campId: camp.campId,
      campName: camp.campName,
      sizeHectares: camp.sizeHectares,
      animalCount,
      stockingDensity: density,
      grazingQuality: details?.grazing ?? null,
      fenceStatus: details?.fence ?? null,
      lastInspection: latestCondition?.observedAt?.split("T")[0] ?? null,
      coverCategory: latestCover?.coverCategory ?? null,
      coverReadingDate: latestCover?.recordedAt?.split("T")[0] ?? null,
    };
  }));

  return NextResponse.json(rows);
}
```

- [ ] **Step 1:** Create the file with the code above.
- [ ] **Step 2:** Test: `curl -b [session cookie] https://farm-management-lilac.vercel.app/api/delta-livestock/performance`
- [ ] **Step 3:** Commit `feat: add /api/[farmSlug]/performance route`

---

### Task 2.2: Performance table client component

**Files (create):** `components/admin/PerformanceTable.tsx`

Sortable table of all camps. Clicking a row navigates to `/admin/camps/[campId]` (the existing camp detail page with KPI cards).

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";

export interface PerfRow {
  campId: string; campName: string; animalCount: number;
  sizeHectares: number | null; stockingDensity: string | null;
  grazingQuality: string | null; fenceStatus: string | null;
  lastInspection: string | null; coverCategory: string | null;
}

type SortKey = keyof PerfRow;

function grazingColor(g: string | null) {
  if (g === "Good") return { color: "#4A7C59", bg: "rgba(74,124,89,0.15)" };
  if (g === "Poor") return { color: "#A0522D", bg: "rgba(160,82,45,0.15)" };
  return { color: "#8B6914", bg: "rgba(139,105,20,0.15)" };
}

export default function PerformanceTable({ rows, farmSlug }: { rows: PerfRow[]; farmSlug: string }) {
  const [sortKey, setSortKey] = useState<SortKey>("campName");
  const [asc, setAsc] = useState(true);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setAsc((v) => !v);
    else { setSortKey(key); setAsc(true); }
  }

  const sorted = [...rows].sort((a, b) => {
    const va = a[sortKey] ?? ""; const vb = b[sortKey] ?? "";
    return asc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });

  const H = ({ k, label }: { k: SortKey; label: string }) => (
    <th
      className="text-left px-4 py-3 font-semibold cursor-pointer select-none hover:text-[#8B6914] transition-colors"
      onClick={() => toggleSort(k)}
    >
      {label} {sortKey === k ? (asc ? "↑" : "↓") : ""}
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-2xl" style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide" style={{ borderBottom: "1px solid #E0D5C8", background: "#F5F2EE", color: "#9C8E7A" }}>
          <tr>
            <H k="campName" label="Camp" />
            <H k="animalCount" label="Animals" />
            <H k="stockingDensity" label="LSU/ha" />
            <H k="grazingQuality" label="Grazing" />
            <H k="fenceStatus" label="Fence" />
            <H k="coverCategory" label="Cover" />
            <H k="lastInspection" label="Last Inspection" />
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const gc = grazingColor(row.grazingQuality);
            return (
              <tr key={row.campId} className="admin-row" style={{ borderBottom: "1px solid #E0D5C8" }}>
                <td className="px-4 py-3 font-semibold" style={{ color: "#1C1815" }}>{row.campName}</td>
                <td className="px-4 py-3 font-mono text-right" style={{ color: "#6B5C4E" }}>{row.animalCount}</td>
                <td className="px-4 py-3 font-mono text-right" style={{ color: "#6B5C4E" }}>{row.stockingDensity ?? "—"}</td>
                <td className="px-4 py-3">
                  {row.grazingQuality ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: gc.bg, color: gc.color }}>{row.grazingQuality}</span>
                  ) : <span style={{ color: "#9C8E7A" }}>—</span>}
                </td>
                <td className="px-4 py-3">
                  {row.fenceStatus ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                      style={row.fenceStatus === "Intact"
                        ? { background: "rgba(74,124,89,0.18)", color: "#4A7C59" }
                        : { background: "rgba(192,87,76,0.12)", color: "#C0574C" }}>
                      {row.fenceStatus}
                    </span>
                  ) : <span style={{ color: "#9C8E7A" }}>—</span>}
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: "#6B5C4E" }}>{row.coverCategory ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-xs" style={{ color: "#9C8E7A" }}>{row.lastInspection ?? "Never"}</td>
                <td className="px-4 py-3">
                  <Link href={`/${farmSlug}/admin/camps/${row.campId}`} className="text-xs transition-opacity hover:opacity-70" style={{ color: "#8B6914" }}>
                    Details →
                  </Link>
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

- [ ] **Step 1:** Create the file.
- [ ] **Step 2:** Commit `feat: add PerformanceTable client component`

---

### Task 2.3: Performance admin page

**Files (create):** `app/[farmSlug]/admin/performance/page.tsx`

```tsx
import AdminNav from "@/components/admin/AdminNav";
import PerformanceTable from "@/components/admin/PerformanceTable";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PerformancePage({
  params,
}: { params: Promise<{ farmSlug: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return <p>Farm not found</p>;

  // Inline data fetch (same logic as API route but server-side for SSR)
  const camps = await prisma.camp.findMany({ orderBy: { campId: "asc" } });
  const rows = await Promise.all(camps.map(async (camp) => {
    const [animalCount, latestCondition, latestCover] = await Promise.all([
      prisma.animal.count({ where: { currentCamp: camp.campId, status: "Active" } }),
      prisma.observation.findFirst({ where: { campId: camp.campId, type: "camp_condition" }, orderBy: { observedAt: "desc" } }),
      prisma.campCoverReading.findFirst({ where: { campId: camp.campId }, orderBy: { recordedAt: "desc" } }),
    ]);
    const density = camp.sizeHectares && camp.sizeHectares > 0
      ? (animalCount / camp.sizeHectares).toFixed(1) : null;
    const details = latestCondition?.details as Record<string, string> | null;
    return {
      campId: camp.campId, campName: camp.campName, sizeHectares: camp.sizeHectares,
      animalCount, stockingDensity: density,
      grazingQuality: details?.grazing ?? null,
      fenceStatus: details?.fence ?? null,
      lastInspection: latestCondition?.observedAt?.split("T")[0] ?? null,
      coverCategory: latestCover?.coverCategory ?? null,
      coverReadingDate: latestCover?.recordedAt?.split("T")[0] ?? null,
    };
  }));

  return (
    <div className="flex min-h-screen bg-[#FAFAF8]">
      <AdminNav />
      <main className="flex-1 p-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-[#1C1815]">Performance</h1>
          <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
            {camps.length} camps · stocking density, grazing, pasture cover
          </p>
        </div>
        <PerformanceTable rows={rows} farmSlug={farmSlug} />
      </main>
    </div>
  );
}
```

- [ ] **Step 1:** Create the file.
- [ ] **Step 2:** Add Performance nav item to `AdminNav.tsx` — import `TrendingUp` from lucide-react and add:
  ```ts
  { path: "/admin/performance", label: "Performance", icon: TrendingUp, group: "Data" },
  ```
  (Place it after "Camps" in NAV_ITEMS.)
- [ ] **Step 3:** Verify: navigate to `/[farmSlug]/admin/performance` — table of 19 camps renders.
- [ ] **Step 4:** Commit `feat: add Performance admin tab with all-camps KPI table`

---

### Task 2.4: Logger birth (calving) — full form

**Files:** `components/logger/CalvingForm.tsx`

Current form collects: calf name, sex (Male/Female), alive/stillborn, ease of birth.
Missing from admin-equivalent: proper animal ID (ear tag), father picker, DOB, breed, category.

Read the existing `CalvingForm.tsx` first to understand the current props/submit shape, then extend it. Key additions:

1. **animalId** — text input, required (farmer enters ear tag). Replaces `KALF-${Date.now()}`.
2. **fatherId** — optional selector (list of bulls in the same camp, fetched from `getAnimalsByCampCached(campId)` filtered to category "Bull").
3. **dateOfBirth** — date input, defaults to today.
4. **breed** — text input, defaults to "Brangus" (farm default — make it configurable later).
5. **category** — select: Calf / Heifer / Bull Calf (defaults to "Calf").
6. **notes** — textarea, optional.

Update the submit payload in the page to include these new fields in the `calfPayload` sent to `POST /api/animals`.

- [ ] **Step 1:** Read `components/logger/CalvingForm.tsx` in full.
- [ ] **Step 2:** Add the 6 new fields to `CalvingForm`. Keep the mobile-friendly layout (large touch targets, dark theme).
- [ ] **Step 3:** In `app/[farmSlug]/logger/[campId]/page.tsx`, update `handleCalvingSubmit` — map new form fields into `calfPayload`:
  ```ts
  animalId: data.animalId,  // from form input (not KALF-timestamp)
  fatherId: data.fatherId || null,
  dateOfBirth: data.dateOfBirth,
  breed: data.breed || "Brangus",
  category: data.category || "Calf",
  notes: data.notes || null,
  ```
- [ ] **Step 4:** Test: open logger → select a cow → Calving → fill full form → submit → admin Animals shows new calf with correct ID, father, and DOB.
- [ ] **Step 5:** Commit `feat: logger calving form now collects full animal record (id, father, DOB, breed, category)`

---

## Phase 3 — Admin UI Redesign

> **Invoke Skill:** Before starting this phase, run `Skill("frontend-design-21")` to load the full design system and animation patterns.

**Design principles from user-provided Dribbble references:**
- KPI stat cards with large bold numbers, subtle badges, clear trend context
- Tables with hover states, status pills, clean typography hierarchy
- Sidebar: dark background (`#1A1510`), gold accent — already good, keep as-is
- Content area: warm off-white (`#FAFAF8`) — keep
- Add subtle hover effects, animated count-up on KPI cards
- Make the Overview feel like a command center, not a list of divs
- Observations: timeline-style log, not a flat table
- Animals: searchable table with filter pills, inline status badges

### Task 3.1: Overview page redesign

**Files:** `app/[farmSlug]/admin/page.tsx`

Key improvements:
- KPI cards: add `cursor-pointer`, subtle `hover:shadow-sm` transition, animated number
- Add a "Today at a glance" section with: inspections progress bar, deaths today, births today
- Camp status summary: convert from bar chart to visual dot-matrix (one dot per camp, coloured by grazing)
- Recent health incidents: timeline style (vertical line + dots)
- Move DangerZone to bottom, collapsed by default (already is)

- [ ] **Step 1:** Invoke `frontend-design-21` skill.
- [ ] **Step 2:** Redesign `app/[farmSlug]/admin/page.tsx` following the skill's patterns.
- [ ] **Step 3:** Verify in browser.
- [ ] **Step 4:** Commit `feat: admin overview redesign`

### Task 3.2: Animals page redesign

**Files:** `app/[farmSlug]/admin/animals/page.tsx`, `components/admin/AnimalsTable.tsx`

Key improvements:
- Add count badges to tab toggle (Active/Deceased)
- Search + filter bar more prominent
- Table rows: clicking opens animal detail (already links to `/animals/[id]`)
- Better visual hierarchy: ID in monospace, category pill, age in human-readable

- [ ] **Step 1:** Read current files.
- [ ] **Step 2:** Redesign.
- [ ] **Step 3:** Verify + commit `feat: animals admin page redesign`

### Task 3.3: Observations timeline redesign

**Files:** `components/admin/ObservationsLog.tsx`

Key improvements:
- Timeline layout: vertical left-border line with coloured dots per type
- Type colours: death=red, health=amber, calving=green, camp_condition=blue
- Cleaner card per observation (icon + type badge + details + date)

- [ ] **Step 1:** Read current file.
- [ ] **Step 2:** Redesign.
- [ ] **Step 3:** Verify + commit `feat: observations timeline redesign`

### Task 3.4: Camps table redesign

**Files:** `components/admin/CampsTableClient.tsx`

Key improvements (Map link already removed in Phase 1):
- Camp name links to Performance detail (replace plain text with link)
- Stocking density column (animals ÷ ha) - compute from existing data
- Visual grazing pills already good — keep
- Add row hover background

- [ ] **Step 1:** Redesign.
- [ ] **Step 2:** Verify + commit `feat: camps table redesign`

### Task 3.5: Reproduction page redesign

**Files:** `app/[farmSlug]/admin/reproduction/page.tsx`

Key improvements:
- KPI cards for: conception rate, calving rate, pregnancy rate — already have the data
- Timeline of recent repro events
- Clear empty state with call-to-action

- [ ] **Step 1:** Read current file.
- [ ] **Step 2:** Redesign.
- [ ] **Step 3:** Verify + commit `feat: reproduction page redesign`

---

## Phase 4 — farmday Skill

### Task 4.1: Create `farmday` skill file

**Files (create):** `~/.claude/skills/farmday/SKILL.md`

The skill describes a Playwright CLI automation that simulates a full farm day:
1. Login as `luc` (username/password from `.env.local`)
2. Visit every camp in the logger — log a camp condition observation (grazing, water, fence)
3. In one camp: flag a health issue on a random animal
4. In one camp: log a death (cause: Old age) on a random animal
5. In one camp: log a birth (calving) with a new calf ID
6. Navigate admin: check Overview, Animals, Observations — screenshot each
7. Report connectivity findings: does the death show up in Animals/Deceased? Does birth show in Animals/Active? Do observations appear?

Key details:
- Runs against production (`BASE_URL=https://farm-management-lilac.vercel.app`) unless `FARMDAY_URL` env var overrides
- Headless mode (no window shown)
- Output: console log + saves screenshots to `.tmp/farmday-YYYY-MM-DD/`
- After completion: prints a connectivity report (pass/fail per flow)
- NEVER reset or clean data — leave all simulation data for audit

- [ ] **Step 1:** Read `~/.claude/skills/playwright-cli/SKILL.md` for Playwright CLI invocation patterns.
- [ ] **Step 2:** Write `~/.claude/skills/farmday/SKILL.md` with full Playwright script.
- [ ] **Step 3:** Test: run the skill against production.
- [ ] **Step 4:** Commit skill file.

---

## Future Backlog (not in this plan)

- **Sale feature** — animals can be sold (`status: "Sold"`, `soldAt`, `salePrice`). Add to logger + admin. Currently no sale flow exists in the app.
- **Offline farmday** — Serwist PWA offline simulation (disconnect network mid-logger, verify queued observations sync on reconnect)

---

## Deploy Strategy

- Phase 1 → commit + `vercel --prod`
- Phase 2 → commit + `vercel --prod`
- Phase 3 → commit + `vercel --prod` (after all tasks)
- Phase 4 → skill file only, no deploy needed
