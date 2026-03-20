# FarmTrack — Agent Instructions

FarmTrack is a multi-tenant livestock farm management SaaS built on Next.js 16 App Router,
Prisma 5 + Turso (libSQL), next-auth v4, Tailwind, and Serwist PWA.

Local dev: `pnpm dev --port 3001`
Deployed: https://farm-management-lilac.vercel.app

---

## Critical Build Rules

- **Build command:** `pnpm build --webpack` — Turbopack breaks Serwist. Never use `turbo` flag for builds.
- **Schema changes:** Use `turso db shell trio-b-boerdery "ALTER TABLE ..."` directly. Do NOT run `prisma db push` — it will break the Turso remote database.
- **tsc gotcha:** `tsconfig.json` has `incremental: true`. Always run `rm -rf .next/cache/tsbuildinfo .tsbuildinfo` before trusting a clean `tsc` result.
- **Next.js 16 params:** Must be awaited — `{ params }: { params: Promise<{ campId: string }> }`.

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

FarmTrack is a **multi-tenant SaaS** for any livestock farm — not a Trio B Boerdery-specific app.
Keep all code generic: no hardcoded farm names, breed names, or farm-specific data in source code.
Farm identity (`farmName`, `breed`) lives in the `FarmSettings` DB table.
