# FarmTrack — Active To-Do List

Last updated: 2026-04-20

---

## Priority 1 — Audit fixes (2026-04-20)

Findings from the 2026-04-20 health audit. Work lives on `claude/sharp-bell-onlhV`.

### A. Proxy tenant-gate regex is incomplete

`proxy.ts:18` matches only `(admin|dashboard|logger|home|tools|sheep|game)` as the second
path segment. `/[farmSlug]/onboarding` and `/[farmSlug]/subscribe/*` bypass the
per-farm membership check, and `app/[farmSlug]/layout.tsx` happily reads
`farmSpeciesSettings` from whatever slug is in the URL.

**Fix:** Invert the rule — match every `/[farmSlug]/*` except a reserved first-segment
allowlist (`api`, `login`, `register`, `farms`, `offline`, `verify-email`, `subscribe`,
`_next`, static assets). Add a unit test asserting `/farmB/onboarding` redirects when
the session only has Farm A.

### B. `app/[farmSlug]/layout.tsx` has no session check

The layout fetches per-farm data with no `getServerSession` call. It relies entirely on
`proxy.ts` for tenant isolation, so any regex gap becomes a data leak. Add an explicit
membership check as defense-in-depth.

### C. `/api/photos/upload` always writes to `farms[0]`

`app/api/photos/upload/route.ts:39` scopes blob paths by `session.user.farms?.[0]?.slug`
instead of the `active_farm_slug` cookie. For multi-farm users (platform admins,
consultants) photos land in the wrong farm's namespace.

**Fix:** Use `getPrismaWithAuth(session)` to resolve + verify the active slug, then use
that slug in the blob path.

### D. `@types/geojson` not installed

Three files type-import `"geojson"` but the package is absent, causing `tsc` to fail.
Add `@types/geojson` as a dev dep and use `import type`.

### E. Inngest missing-key behaviour is silent

`lib/server/inngest/client.ts` logs `console.error` when `INNGEST_SIGNING_KEY` is
missing in production. That allows unsigned POSTs through `/api/inngest`. Throw in
production so a bad deploy fails loudly.

### F. ESLint — 49 errors

Four categories:
- React 19 compiler: `setState synchronously within an effect` in map layers and admin
  charts. Fix by moving the loading-state set into the fetch callback.
- `@ts-ignore` → `@ts-expect-error` (mechanical sweep in `lib/server/*-pdf.ts`,
  `lib/server/open-meteo.ts`, scripts).
- A minified bundle is being linted — exclude it in `eslint.config.mjs`.
- A handful of remaining `any`s in `app/api/[farmSlug]/export/route.ts` and peers.

---

## Priority 2 — Website v2 Fixes & Deploy

**Status:** Built and running on port 3002, not yet deployed (needs its own Vercel project).

**Known issues:**
- "Log in" CTA → should route to `/farms` (farm selector), not a login page.
- Full visual QA pass before deploy.
- Needs its own Vercel project (separate from farm-management).

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
| Multi-tenant rollout | — | Meta DB + per-farm Turso + `getPrismaWithAuth` / `getPrismaForSlugWithAuth` |
| Logger orphan-sweep (ex-P1 bug A) | — | `seedAnimals`/`seedCamps` in `lib/offline-store.ts` already delete server-orphaned rows and preserve local condition fields on refresh (ex-P1 bug B) |
| Phase H — hardening | `132d479` | logger + auth + nav + ops pre-launch sprint |
| Phase I — first-impression sprint | `7312071` | 8 Day-1 trust bugs |
| Phase J — notifications + repro KPI | `9788640` / `79f6dc7` | Notification Engine + Inngest fix |
| Phase K — tasks + geo-map | `9f1f370` | Recurrence engine + 8 SA moat layers |
