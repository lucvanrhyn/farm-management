# FarmTrack — Active To-Do List

Last updated: 2026-04-21

---

## Priority 1 — Code Quality & Correctness (Health-Audit 2026-04-21)

### Audit sweep 2026-04-21 — results

| Workstream | Status | Notes |
|---|---|---|
| A. React compiler violations — mechanical | ✅ Done | 28 errors fixed: `@ts-ignore` → `@ts-expect-error` retired, static-components hoisted (`PerformanceTable`, `MoveModePanel`), impure wall-clock calls cordoned with justified disables, reassign-after-render refactored to `reduce` (`FinansieleTab`), AdminNav `useCallback` dropped. Unused `@ts-expect-error` directives were removed once the upstream types worked. |
| B. Prisma integrity — additive indexes | ✅ Done | FK indexes added to `prisma/schema.prisma` + hand-written idempotent SQL in `scripts/migrations/2026-04-21-add-fk-indexes.sql`. Migration README documents the policy. |
| C. DTO convention | ✅ Scaffold | `lib/api/dto.ts` provides `toCampDTO`, `toPrismaAnimalDTO`, `toAnimalSummaryDTO`, `toPrismaObservationDTO`. Non-breaking — existing hand-mapped routes untouched. Migrate route-by-route opportunistically. |
| D. Multi-farm photo upload | ✅ Fixed | `app/api/photos/upload/route.ts` now reads `active_farm_slug` cookie and fails closed if the cookie slug isn't in the user's session farms. |
| E. Auth hardening | ✅ Done | `/api/onboarding/template` gated behind `getServerSession`. `/api/auth/resend-verification` already had stacked per-IP + per-email rate limits with timing-constant anti-enumeration (verified, no change needed). |
| E2. `/api/auth/forgot-password` | ⏳ Pending | No reset flow — account lockout still requires admin intervention. Separate workstream. |

### A-cont. React compiler `react-hooks/set-state-in-effect` (21 errors)

All remaining `pnpm lint` errors are `react-hooks/set-state-in-effect`: effects that fetch data
and call `setState`. This is the canonical "fetch in useEffect" pattern, and the compiler
flags it because it can trigger cascading renders.

**Files:** `verify-email/page.tsx`, `AdminNav.tsx`, `AnimatedNumber.tsx`,
`FinancialAnalyticsPanel.tsx`, `NotificationBell.tsx`, `MapSettingsClient.tsx`,
`NextToGrazeQueue.tsx`, `AnimalProfile.tsx` (×2), `WeatherWidget.tsx`, `LayerToggle.tsx`,
`MoveModePanel.tsx`, all `components/map/layers/*` (7 files), `lib/farm-mode.tsx` (×2).

**Fix strategy (architectural, ~2–3 day workstream):**

1. **Data fetches** (most of them): adopt SWR or React Query. One hook per resource, swap
   `useState + useEffect(fetch)` → `useSWR("/api/foo", fetcher)`. Strongly-typed response
   DTOs come from `lib/api/dto.ts` (just shipped). Gains: dedup, revalidation, optimistic
   updates, correct Suspense boundaries.
2. **Animation** (`AnimatedNumber.tsx`): this is a legitimate animation frame loop. Either
   migrate to `framer-motion`'s `useMotionValue` (which the project already depends on), or
   add a documented `eslint-disable-next-line` with a link back to this TODO.
3. **Persistent UI state** (`AdminNav` expanded-groups, `LayerToggle`, `MoveModePanel`
   source-select): these are effects that restore state from `localStorage` on mount. The
   correct primitive is a custom `useLocalStorage` hook that returns synchronous initial
   state (no effect needed).
4. **Scheduled re-fetch** (`NotificationBell` interval): SWR's `refreshInterval` replaces
   the manual `setInterval` loop entirely.

Until that workstream lands these are the only errors `pnpm lint` emits — the repo's
quality baseline is otherwise clean.

### F. xlsx CVE (deferred workstream)

`xlsx@0.18.5` has an unpatched prototype-pollution CVE (GHSA-4r6h-8v6p-xvw6). Used in
`app/api/animals/import/route.ts`, `app/api/onboarding/commit-import/route.ts`, and three
scripts. Replacement candidates: `@e965/xlsx` fork, `exceljs`. Deferred to its own
regression-tested workstream — deliberately noted in `package.json`.

---

## Priority 2 — Multi-Tenant Architecture (in progress)

**Decision log:**
- Each farm = fully isolated, separate Turso database
- No self-serve signup — Luc manually provisions each new client
- Login flow: farmtrack website → "Log in" → `/farms` farm selector page → click farm → individual farm login
- PWA: each client adds their farm's URL to their home screen

**Do NOT use Supabase.** We are on Turso + Prisma + next-auth. Supabase is a full
platform replacement — adding it means rewriting the entire data layer.

**Architecture to implement:**
1. **Meta DB** — `lib/meta-db.ts` exists. Maps `farmSlug → { turso_url, turso_auth_token, display_name, logo_url }`.
2. **Middleware** — `proxy.ts` + `lib/farm-prisma.ts` scope Prisma clients per tenant.
3. **Routing** — `/[farmSlug]/(logger|dashboard|admin)` path-based isolation.
4. **Farm selector page `/farms`** — exists at `app/farms/page.tsx`.
5. **Data isolation** — database-level, no `farmId` columns.

**Remaining work:**
- Password-reset flow (see Priority 1.E)
- Upstash Redis-backed rate limiter (current one resets on cold start)
- Cross-tenant blob-storage audit (photos path)

---

## Priority 3 — Website v2 Fixes & Deploy

**Status:** Built and running on port 3002, not yet deployed.

**Known issues:**
- "Log in" CTA → should route to `/farms`, not a per-farm login page
- Full visual QA pass before deploy
- Needs its own Vercel project (separate from farm-management)

---

## Backlog (Defined, Not Scheduled)

- **AI grazing rotation advisor** — camp rotation recommendations based on current conditions
- **Daily summary report** — automated daily email/WhatsApp to management
- **Animal health history** — searchable per-animal log
- **Treatment withdrawal tracking** — flag animals in withdrawal on the dashboard
- **Rainfall tracking** — manual entry or weather API
- **Offline sync conflict resolution** — better UX for Dicky when sync fails
- **xlsx replacement** — see Priority 1.F
- **Accessibility pass** — icon-only buttons need aria-labels, color-only status needs text

---

## Completed (Reference)

| Phase | Commit | Summary |
|-------|--------|---------|
| Data refactor phases 1–4 | `4e10d17` | Camp model, API routes, dummy-data removal |
| Phase 5 — Camp CRUD UI | `1eb8e3d` | AddCampForm, CampsTableClient, SchematicMap/DashboardClient fixes |
| Phase 6 — CLAUDE.md | `cde9e54` | Rewrote with FarmTrack-specific principles |
| Phase H — Hardening | `132d479` | Logger + auth + nav + ops pre-launch sprint |
| Phase I — First-Impression | `7312071` | 8 Day-1 trust bugs |
| Phase J — Notifications | `9788640` | Notification Engine + Repro KPI Pack |
| Phase K — Tasks + Geo-Map | `9f1f370` | Recurrence engine + 8 SA moat layers |
| P1 Logger Bug A (stale animals) | — | `seedAnimals()` / `seedCamps()` now do orphan sweep in IndexedDB |
| P1 Logger Bug B (condition reset) | — | `seedCamps()` merges existing condition fields; sync pulls `/api/camps/status` |
