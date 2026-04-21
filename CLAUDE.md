# FarmTrack — Agent Instructions

FarmTrack is a multi-tenant livestock farm management SaaS built on Next.js 16 App Router,
Prisma 5 + Turso (libSQL), next-auth v4, Tailwind, and Serwist PWA.

Local dev: `pnpm dev --port 3001`
Deployed: https://farm-management-lilac.vercel.app

---

## Critical Build Rules

- **Build command:** `pnpm build --webpack` — Turbopack breaks Serwist. Never use `turbo` flag for builds.
- **Schema changes:** Use `turso db shell delta-livestock "ALTER TABLE ..."` directly. Do NOT run `prisma db push` — it will break the Turso remote database.
- **tsc gotcha:** `tsconfig.json` has `incremental: true`. Always run `rm -rf .next/cache/tsbuildinfo .tsbuildinfo` before trusting a clean `tsc` result.
- **Next.js 16 params:** Must be awaited — `{ params }: { params: Promise<{ campId: string }> }`.

---

## Workflow: Verify Then Commit to Main

After implementing any fix, before committing:

1. **Verify root cause, not symptom.** Re-read the diff and ask: does this change address *why* the bug happened, or just mask what the user noticed? Symptom-patches go back in the queue.
2. **Prove it works.** Run the relevant layer — `npx tsc --noEmit` for type changes, `pnpm vitest run <path>` for logic changes, `pnpm lint` for style/compiler-rule changes. For UI changes start the dev server and click through the feature.
3. **Re-audit the diff.** Look for collateral damage, dead code left behind, TODO comments that should be resolved, and tests that should have been added.
4. **Only then commit** — and commit directly to `main` unless the session explicitly pins a different branch (e.g. a harness-provided feature branch). A single verified fix on `main` is better than a stack of unverified commits on a branch nobody reviews.

If verification fails, fix the underlying issue and re-verify. Don't commit a "good enough" fix and open a follow-up TODO unless the user explicitly accepts that trade-off.

---

## Data Principles (No Dummy Data)

**`dummy-data.ts` must never be imported anywhere in the app.** All camp and farm data
comes from the database via API routes or Prisma server queries.

### Camp data flow

- **Server components** (pages, layouts): query Prisma directly — `prisma.camp.findMany()`.
  Prisma returns camelCase (`campId`, `campName`, `sizeHectares`, `waterSource`).
  Map to snake_case before passing to client components as `Camp[]`.
- **Client components**: fetch from `/api/camps` (returns snake_case to match `Camp` type in `lib/types.ts`).
- **OfflineProvider / logger**: uses `useOffline().camps` backed by IndexedDB + `/api/camps` refresh.

### API routes (all require next-auth session)

| Route | Method | Description |
|-------|--------|-------------|
| `/api/camps` | GET | `prisma.camp.findMany()` + animal counts, snake_case response |
| `/api/camps` | POST | Create camp, blocks duplicate campId |
| `/api/camps/[campId]` | DELETE | Delete camp, blocks if has active animals |
| `/api/camps/reset` | DELETE | Delete all camps, blocks if any active animals exist |
| `/api/farm` | GET | `{ farmName, breed, animalCount, campCount }` from DB |

### `/api/camps` response shape (snake_case)

```ts
{ camp_id, camp_name, size_hectares, water_source, geojson, notes, animal_count }
```

---

## Key Component Contracts

### SchematicMap

```ts
props: {
  onCampClick: (campId: string) => void
  filterBy: FilterType
  selectedCampId: string | null
  liveConditions: Record<string, LiveCondition>
  camps: Camp[]
  campAnimalCounts: Record<string, number>
}
```

`getCampColors` is a **pure function**: `(filterBy, liveCondition, animalCount, sizeHectares) => colors`.
It has no imports from dummy-data and no side effects.

### DashboardClient

Receives `camps: Camp[]` and `liveConditions` as props from `app/dashboard/page.tsx`
(which fetches from Prisma). Computes `alertCount` and `inspectedToday` inline from `liveConditions` —
never calls `getAlertCount()` or `getInspectedToday()` from utils.

### OfflineProvider type cast

`useOffline().camps` is typed `Camp[]` but IndexedDB records at runtime can have condition fields
merged in (e.g. `grazing_quality`, `water_status`). Use `camp as (Camp & { grazing_quality?: string })`
to access merged fields.

---

## Prisma / Turso

- Prisma client targets Turso via `@prisma/adapter-libsql` + `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.
- Local: `.env.local` must contain Turso creds.
- Seed script: `scripts/seed-camps.ts` — run with `npx tsx scripts/seed-camps.ts`.
  Note: script uses `dotenv.config({ path: ".env" })` but Turso creds are in `.env.local`;
  pass creds as shell env vars or insert via `turso db shell` directly if dotenv interferes.

---

## Removed Utils (do not re-add)

These functions were deleted from `lib/utils.ts` because they depended on dummy-data:

`getLastInspection`, `getCampStats`, `getCampById`, `getStockingDensity`,
`daysSinceInspection`, `campHasAlert`, `getLast7DaysLogs`, `getAnimalsByCamp`,
`getInspectedToday`, `getAlertCount`

If similar functionality is needed, compute it from the live data passed as props or fetched from the API.

---

## Product Direction

FarmTrack is a **multi-tenant SaaS** for any livestock farm — not a Delta Livestock-specific app.
Keep all code generic: no hardcoded farm names, breed names, or farm-specific data in source code.
Farm identity (`farmName`, `breed`) lives in the `FarmSettings` DB table.
