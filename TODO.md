# FarmTrack — Active To-Do List

Last updated: 2026-03-20

---

## Priority 1 — Production Blockers (fix before any client goes live)

### A. Logger Bug: Stale Animals Persist After Deletion

**Root cause (confirmed):**
`seedAnimals()` in `lib/offline-store.ts` uses `db.put()` — which upserts but never deletes.
When animals are removed in Admin → DB → `/api/animals` returns the updated list — but
`refreshCachedData()` in `lib/sync-manager.ts` calls `seedAnimals(freshList)` which only
adds/updates records. Animals deleted from the DB remain in IndexedDB forever.

**Fix required (one place):**
In `lib/sync-manager.ts` → `refreshCachedData()`, after fetching `/api/animals`, clear the
entire `animals` IndexedDB store before reseeding. Or diff the incoming list and delete orphans.
`seedCamps()` has the same problem — camps deleted from DB persist in IndexedDB.

**File:** `lib/offline-store.ts` → `seedAnimals()` and `seedCamps()` (both need orphan cleanup)

---

### B. Logger Bug: Camp Conditions Reset After Upload/Sync

**Root cause (confirmed):**
`updateCampCondition()` in `offline-store.ts` merges condition fields (grazing_quality,
water_status, fence_status, last_inspected_at) directly into the camp record in IndexedDB
using `{ ...camp, ...condition }`. This is local state only.

When the upload button is pressed → `syncAndRefresh()` → `refreshCachedData()` → fetches
camps from `/api/camps` (which returns bare camp metadata, no condition fields) → `seedCamps()`
calls `put()` for each camp → overwrites the entire record including the merged condition fields.

Result: conditions revert to undefined/default after every sync.

**Fix required:**
Option A (minimal): In `seedCamps()`, for each incoming camp from the API, read the
existing IndexedDB record and re-merge any condition fields before `put()`. Condition fields
survive the sync; new camp metadata is still applied.
Option B (clean): Move condition state to a separate `camp_conditions` IndexedDB store.
`updateCampCondition()` writes there. `seedCamps()` never touches it. Logger reads both.

Recommend Option A for speed. Option B is architecturally cleaner if we have time.

**Files:** `lib/offline-store.ts` → `seedCamps()` | `lib/sync-manager.ts` → `refreshCachedData()`

---

## Priority 2 — Multi-Tenant Architecture

**Decision log:**
- Each farm = fully isolated, separate Turso database
- No self-serve signup — Luc manually provisions each new client
- Login flow: farmtrack website → "Log in" → `/farms` farm selector page → click farm → individual farm login
- PWA: each client adds their farm's URL to their home screen

**Do NOT use Supabase.** We are already on Turso + Prisma + next-auth. Supabase is a full
platform replacement (Postgres + Auth + Storage + Realtime) — adding it now means rewriting
the entire data layer. It's not compatible with the current stack without a major refactor.

**Architecture to implement:**
1. **Meta DB** — a lightweight store (can be a dedicated Turso DB or small Postgres) mapping:
   `farmSlug → { turso_url, turso_auth_token, display_name, logo_url }`
   This is what Luc manages when onboarding a new client.

2. **Middleware** (proxy.ts / route handler) — reads `farmSlug` from URL path or session,
   looks up the farm's Turso credentials from the meta DB, creates a scoped Prisma client
   per request. All queries are automatically isolated to that farm's database.

3. **Routing pattern** — path-based (simplest to start):
   `farmtrack.app/farms` → farm selector (lists all active farms)
   `farmtrack.app/[farmSlug]/login` → farm-specific login
   `farmtrack.app/[farmSlug]/logger` → Dicky's logger
   `farmtrack.app/[farmSlug]/dashboard` → management dashboard
   `farmtrack.app/[farmSlug]/admin` → admin panel

4. **Farm selector page** — does NOT exist yet. Needs to be built at `/farms/page.tsx`.
   Lists all farms from the meta DB. Click a farm card → `/[farmSlug]/login`.

5. **Data isolation** — each farm's Prisma client points at their own Turso DB.
   No `farmId` column needed — isolation is at the database level.

**Onboarding a new client (Luc's workflow):**
1. Create a new Turso DB for them: `turso db create [farm-slug]`
2. Run schema migrations on their DB
3. Add their entry to the meta DB
4. Import their animal/camp data via admin import
5. Create their user account (next-auth)
6. Hand over their URL: `farmtrack.app/[farm-slug]`

---

## Priority 3 — Website v2 Fixes & Deploy

**Status:** Built and running on port 3002, not yet deployed (needs its own Vercel project).

**Known issues:**
- "Log in" CTA → should route to `/farms` (farm selector), not a login page
  Because a visitor to the marketing site is not necessarily a Trio B client.
- `/farms` page doesn't exist yet (built as part of Priority 2)
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

---

## Completed (Reference)

| Phase | Commit | Summary |
|-------|--------|---------|
| Data refactor phases 1–4 | `4e10d17` | Camp model, API routes, dummy-data removal |
| Phase 5 — Camp CRUD UI | `1eb8e3d` | AddCampForm, CampsTableClient, SchematicMap/DashboardClient fixes |
| Phase 6 — CLAUDE.md | `cde9e54` | Rewrote with FarmTrack-specific principles |
