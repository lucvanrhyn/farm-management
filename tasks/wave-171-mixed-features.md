# Wave G7 — `[farmSlug]/**` slug-aware adapter rollout (mixed-features cluster)

**Branch:** `wave/171-mixed-features-slug`
**Worktree:** `.worktrees/wave/171-mixed-features-slug/`
**Base:** `origin/main` at `79b0adb` (post Wave G6 merge `79b0adbf6bf251d0b06279dd7f206a3ff4a5302d`)
**Risk:** **MEDIUM** — AI integration (OpenAI fetch + 12s timeout + AbortController), three different live tier-gate predicates, streaming binary response (CSV/PDF/Excel from export), classifyFarmContextFailure → adapter collapse (AUTH_REQUIRED canonicalisation).

This is **part 7 of ADR-0001 7/8** (`[farmSlug]/**` slug-adapter rollout). Same pattern as G1–G6.
Read the [wave-history-log.md G1–G6 block](../../../../.claude/projects/-Users-lucvanrhyn-Documents-Obsidian-Vault-MainHub-Farm-project/memory/wave-history-log.md) entries first to internalise the established conventions, especially:

- **G3 wire-shape correction:** the canonical adapter behaviour collapses no-session AND cross-tenant into a single 401 AUTH_REQUIRED. This is the documented correct behaviour — adopt it (mirrors G5 settings/alerts and the comment at `app/api/[farmSlug]/settings/alerts/route.ts:24`).
- **G5 hybrid wire-shape (Option A):** adapter emits typed `{success: false, error: CODE, message}` for auth/scope; route-handler emits whatever it currently emits for tier-gate / validation / business-rule errors. Don't change wire-shape unless the existing route is already typed (in which case keep it typed).
- **G6 `denyIfNotFreshAdmin(ctx)` helper pattern:** OK to introduce small file-local helpers if they DRY up repeated code blocks.

---

## Mission

Migrate **5 routes** off `getFarmContextForSlug` onto the slug-aware adapters (`tenantReadSlug` / `tenantWriteSlug`). **No domain extraction** — pure transport-layer migration. The five routes are a coherent "mixed features" cluster: AI, breeding, exports, paid-tier farm-settings, single-camp stats. None of them share a domain module to extract.

### File allow-list (exactly 6 files; nothing else)

| # | File | Verb(s) |
|---|---|---|
| 1 | `app/api/[farmSlug]/breeding/analyze/route.ts` | POST |
| 2 | `app/api/[farmSlug]/camps/[campId]/stats/route.ts` | GET |
| 3 | `app/api/[farmSlug]/export/route.ts` | GET |
| 4 | `app/api/[farmSlug]/farm-settings/ai/route.ts` | PUT |
| 5 | `app/api/[farmSlug]/farm-settings/methodology/route.ts` | PUT |
| 6 | `__tests__/api/route-handler-coverage.test.ts` | (remove 5 EXEMPT lines: 64, 65, 66, 67, 68) |

If you find yourself wanting to edit anything outside this list — STOP and re-read the spec. The Wave G6 dispatch was clean because the agent did exactly this.

---

## Per-route migration patterns (preserve verbatim)

### 1. `breeding/analyze/route.ts` (POST, MEDIUM-risk: OpenAI integration)

**Adapter shape:**
```ts
export const POST = tenantWriteSlug<unknown, { farmSlug: string }>({
  handle: async (ctx, req, params) => {
    const { farmSlug } = params;

    // Live tier check — JWT tier can be stale after subscription changes.
    const creds = await getFarmCreds(farmSlug);
    if (!creds || creds.tier === "basic") {
      return NextResponse.json(
        { error: "Breeding AI requires an Advanced plan" },
        { status: 403 },
      );
    }

    const { allowed, retryAfterMs } = checkRateLimit(`breeding:${farmSlug}`, 5, 60_000);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
      );
    }

    const prisma = ctx.prisma;
    const species = await getFarmMode(farmSlug);

    // ... rest of handler verbatim ...
  },
});
```

**MUST preserve verbatim** (do not refactor mid-migration):
- The 5-call `Promise.all` (`getBreedingSnapshot`, `suggestPairings`, `prisma.farmSettings.findFirst()`, two `prisma.observation.findMany` with `select:`)
- 12-second `OPENAI_TIMEOUT_MS` + `AbortController` + `setTimeout` + `clearTimeout(timer)` in `finally`
- Typed error envelope for `UPSTREAM_TIMEOUT` (504) and `UPSTREAM_ERROR` (502) with full `message` field — these are already on the silent-failure-cure pattern; keep them
- Bare-string error envelope for `"OpenAI request failed: ${status}"` (502), `"Failed to parse AI response"` (502), `"OpenAI API key not configured. Add it in Settings or set OPENAI_API_KEY."` (400) — keep them bare per the hybrid wire-shape (Option A)
- `parseDetails` inline helper, `scanResults` aggregation, `liveCalvings` filter, `herdData` object, `systemPrompt`, OpenAI fetch body, JSON parse path
- No admin-fresh-role gate (none currently)
- `force-dynamic`

**Wire-shape changes:** none beyond auth (the no-session/cross-tenant fall through to adapter's 401 AUTH_REQUIRED, replacing the current bare-string `"Unauthorized"`).

### 2. `camps/[campId]/stats/route.ts` (GET, simple)

**Adapter shape:**
```ts
export const GET = tenantReadSlug<{ farmSlug: string; campId: string }>({
  handle: async (ctx, req, params) => {
    const { campId } = params;
    const { prisma } = ctx;

    // Phase A of #28: campId is no longer globally unique — findFirst single-species-safe.
    const camp = await prisma.camp.findFirst({ where: { campId } });
    if (!camp) {
      return NextResponse.json({ error: "Camp not found" }, { status: 404 });
    }

    // ... rest verbatim: thirtyDaysAgo, thisMonthStart, 6-call Promise.all,
    // byCategory aggregation, conditionDetails JSON parse, daysSinceInspection,
    // healthRate calc, NextResponse.json(...) full response shape ...
  },
});
```

**MUST preserve verbatim:**
- 6-call `Promise.all` (1 animal.findMany + 3 observation.count + 2 observation.findFirst, all with `select:` already in place)
- The 404 bare-string `"Camp not found"` (preserves existing wire-shape)
- The cross-species note in the `currentCamp: campId, status: "Active"` query — DO NOT add species filter
- `byCategory` Partial<Record> aggregation, `conditionDetails` JSON parse with empty-on-error fallback, `daysSinceInspection` Math.floor formula, `healthRate` toFixed(2) formatting
- Full response envelope shape (camp / animals / health / calvings / visits / inspection / condition)

**Out-of-scope gap:** the existing route lacks a `camp.farmId` belongs-to-farm check (same gap flagged in G6 attachment). Leave it. Out-of-scope for this wave.

### 3. `export/route.ts` (GET, MEDIUM-risk: streaming binary response)

**Adapter shape:**
```ts
export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx, req, params) => {
    const { farmSlug } = params;
    const prisma = ctx.prisma;

    // Rate limit: 20 exports per 10 minutes per farm.
    const rl = checkRateLimit(`export:${farmSlug}`, 20, 10 * 60 * 1000);
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: "Too many export requests. Please wait." }), { status: 429 });
    }

    const url = new URL(req.url);
    const typeParam = url.searchParams.get("type") ?? "animals";
    if (!isExportType(typeParam)) {
      return new Response(JSON.stringify({ error: "Invalid export type" }), { status: 400 });
    }
    const type: ExportType = typeParam;

    if (ADVANCED_ONLY_EXPORTS.has(type)) {
      const creds = await getFarmCreds(farmSlug);
      if (!creds || !isPaidTier(creds.tier)) {
        return new Response(JSON.stringify({ error: "This export requires an Advanced subscription." }), { status: 403 });
      }
    }

    // ... format/from/to query parsing, dispatchExport, content-disposition header, 5xx fallback verbatim ...
  },
});
```

**Critical correctness:** the adapter **does support handler returning a raw `Response`** with binary body — see `lib/server/route/tenant-read-slug.ts:18-22` (PDF route note). Do NOT switch the handler's success response to `NextResponse.json`. The Content-Type / Content-Disposition headers and the binary body must reach the client unchanged.

**MUST preserve verbatim:**
- `Response` (not `NextResponse.json`) for all branches (so the binary body and headers pass through cleanly)
- Bare-string error envelope for tier-gate, rate-limit, invalid-type, ExportRequestError, generic 500 (legacy wire-shape)
- The `try { ... } catch (err) { if (err instanceof ExportRequestError) ... }` shape with `logger.error('[export] Error generating export', err)` for the catch-all branch
- `force-dynamic`

### 4. `farm-settings/ai/route.ts` (PUT, typed envelope already)

**Adapter shape:**
```ts
export const PUT = tenantWriteSlug<unknown, { farmSlug: string }>({
  handle: async (ctx, req, params) => {
    const { farmSlug } = params;

    // Tier gate — Basic must not write.
    const creds = await getFarmCreds(farmSlug);
    const tier: FarmTier = (creds?.tier as FarmTier) ?? "basic";
    if (!isPaidTier(tier)) {
      return asErr(
        "EINSTEIN_TIER_LOCKED",
        "Einstein AI settings are available on Advanced and Consulting plans",
        403,
      );
    }
    const budgetExempt = isBudgetExempt(tier);

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return asErr("INVALID_BODY", "Body must be valid JSON", 400);
    }

    // ... validateBody, parseAiSettings, mergeAiSettings, findFirst → updateMany OR upsert,
    // revalidateSettingsWrite(farmSlug), success response with merged settings,
    // catch → AI_SETTINGS_SAVE_FAILED 500 verbatim ...
  },
  revalidate: () => {}, // existing route calls revalidateSettingsWrite inside handler — leave as-is OR move to adapter option (your call; pick whichever keeps the diff smallest). G5 precedent moved it to adapter `revalidate`; G6 followed.
});
```

**Wire-shape changes:**
- Drop `classifyFarmContextFailure` + `mapped = code === "CROSS_TENANT_FORBIDDEN" ? "FARM_ACCESS_DENIED" : code` mapping — the adapter handles both cases as 401 AUTH_REQUIRED. Confirmed safe by grep: no test, no client, and no other route reads `FARM_ACCESS_DENIED` (only references are the doc-comment line in this file and methodology, plus the comment in `settings/alerts/route.ts:24` that already documents the G5 collapse). The doc-comment `FARM_ACCESS_DENIED` line in this file should be removed too (it'll be obsolete).
- `FARM_NOT_FOUND` doc-comment line is also stale — never actually emitted. Remove.

**MUST preserve verbatim:**
- `validateBody(raw, budgetExempt)` function: AI_INVALID_NAME, AI_INVALID_LANGUAGE, AI_INVALID_BUDGET, AI_BUDGET_NOT_ALLOWED branches. Including the regex test, the empty-string reset semantics, the budget-exempt branch.
- `parseAiSettings`, `mergeAiSettings` calls
- The `findFirst({select: aiSettings})` → `updateMany({data})` OR `upsert({where: id="singleton"})` shape. Keep the `eslint-disable @typescript-eslint/no-explicit-any` on the `prisma: any` cast (legacy).
- `asErr` helper (the `{success:false, error, message}` envelope) — keep it; this is already canonical typed wire-shape.
- `revalidateSettingsWrite(farmSlug)` call.
- `force-dynamic`.

### 5. `farm-settings/methodology/route.ts` (PUT, typed envelope already)

Same shape as ai/route.ts. Apply the same wire-shape simplification (drop `classifyFarmContextFailure` + `FARM_ACCESS_DENIED` mapping; remove stale doc-comment lines for FARM_ACCESS_DENIED + FARM_NOT_FOUND).

**MUST preserve verbatim:**
- `validateMethodology(raw)`: METHODOLOGY_FIELDS allow-list, MAX_FIELD_LEN cap, METHODOLOGY_INVALID_SHAPE / METHODOLOGY_INVALID_FIELD branches, empty-string-skip semantics
- The `findFirst → updateMany → upsert(singleton)` write path
- `asErr` typed envelope helper
- `revalidateSettingsWrite(farmSlug)`
- `force-dynamic`

---

## Wire-shape contract (post-migration)

| Path | Verb | Failure | Status | Wire-shape source | Body |
|---|---|---|---|---|---|
| breeding/analyze | POST | no session OR cross-tenant | 401 | adapter | `{success:false, error:"AUTH_REQUIRED", message:"Unauthorized"}` |
| breeding/analyze | POST | basic tier | 403 | handler bare | `{error:"Breeding AI requires an Advanced plan"}` |
| breeding/analyze | POST | rate limited | 429 | handler bare + `Retry-After` | `{error:"Too many requests. Please wait before trying again."}` |
| breeding/analyze | POST | no OpenAI key | 400 | handler bare | `{error:"OpenAI API key not configured. Add it in Settings or set OPENAI_API_KEY."}` |
| breeding/analyze | POST | OpenAI timeout | 504 | handler typed | `{error:"UPSTREAM_TIMEOUT", message:"OpenAI did not respond within 12000ms. Try again shortly."}` |
| breeding/analyze | POST | OpenAI fetch err | 502 | handler typed | `{error:"UPSTREAM_ERROR", message: <e.message>}` |
| breeding/analyze | POST | OpenAI 4xx/5xx | 502 | handler bare | `{error:"OpenAI request failed: <status>"}` |
| breeding/analyze | POST | OpenAI parse fail | 502 | handler bare | `{error:"Failed to parse AI response"}` |
| camps/[campId]/stats | GET | no session OR cross-tenant | 401 | adapter | `{success:false, error:"AUTH_REQUIRED", message:"Unauthorized"}` |
| camps/[campId]/stats | GET | camp not found | 404 | handler bare | `{error:"Camp not found"}` |
| export | GET | no session OR cross-tenant | 401 | adapter | `{success:false, error:"AUTH_REQUIRED", message:"Unauthorized"}` |
| export | GET | rate limited | 429 | handler bare | `{error:"Too many export requests. Please wait."}` |
| export | GET | invalid type | 400 | handler bare | `{error:"Invalid export type"}` |
| export | GET | basic tier on advanced-only | 403 | handler bare | `{error:"This export requires an Advanced subscription."}` |
| export | GET | ExportRequestError | varies | handler bare | `{error:<err.message>}` |
| export | GET | catch-all 500 | 500 | handler bare | `{error:"Export failed"}` |
| farm-settings/ai | PUT | no session OR cross-tenant | 401 | adapter | `{success:false, error:"AUTH_REQUIRED", message:"Unauthorized"}` |
| farm-settings/ai | PUT | basic tier | 403 | handler typed | `{success:false, error:"EINSTEIN_TIER_LOCKED", message:"Einstein AI settings are available on Advanced and Consulting plans"}` |
| farm-settings/ai | PUT | invalid JSON | 400 | handler typed | `{success:false, error:"INVALID_BODY", message:"Body must be valid JSON"}` |
| farm-settings/ai | PUT | validation | 400 | handler typed | `{success:false, error:"AI_INVALID_NAME"|...|"AI_BUDGET_NOT_ALLOWED", message}` |
| farm-settings/ai | PUT | DB write failed | 500 | handler typed | `{success:false, error:"AI_SETTINGS_SAVE_FAILED", message:"Could not save settings — please try again"}` |
| farm-settings/ai | PUT | success | 200 | handler | `{success:true, settings:{assistantName, responseLanguage, budgetCapZarPerMonth}}` |
| farm-settings/methodology | PUT | no session OR cross-tenant | 401 | adapter | `{success:false, error:"AUTH_REQUIRED", message:"Unauthorized"}` |
| farm-settings/methodology | PUT | basic tier | 403 | handler typed | `{success:false, error:"EINSTEIN_TIER_LOCKED", message:"Farm Methodology editing is available on Advanced and Consulting plans"}` |
| farm-settings/methodology | PUT | invalid JSON | 400 | handler typed | `{success:false, error:"INVALID_BODY", message:"Body must be valid JSON"}` |
| farm-settings/methodology | PUT | validation | 400 | handler typed | `{success:false, error:"METHODOLOGY_INVALID_SHAPE"|"METHODOLOGY_INVALID_FIELD", message}` |
| farm-settings/methodology | PUT | DB write failed | 500 | handler typed | `{success:false, error:"METHODOLOGY_SAVE_FAILED", message:"Could not save methodology — please try again"}` |
| farm-settings/methodology | PUT | success | 200 | handler | `{success:true, methodology}` |

---

## Pre-flight reading order

Read in this exact order before writing any code:

1. **Adapter sources** — confirm semantics:
   - `lib/server/route/tenant-read-slug.ts`
   - `lib/server/route/tenant-write-slug.ts`
   - `lib/server/route/_resolve-slug.ts`
   - `lib/server/route/types.ts`
   - `lib/server/route/envelope.ts`

2. **Wave G6 reference (most recent slug-adapter migration with helper-DRY pattern):**
   - `app/api/[farmSlug]/camps/[campId]/cover/route.ts` (helper `denyIfNotFreshAdmin`, multi-key params, write side)
   - `app/api/[farmSlug]/veld-assessments/route.ts` (dual-role gate)

3. **Wave G5 reference (typed-envelope precedent for farm-settings):**
   - `app/api/[farmSlug]/settings/alerts/route.ts` (split-gate, typed envelope, comment about FARM_ACCESS_DENIED collapse)

4. **All 5 routes-to-migrate** (read fully before editing):
   - `app/api/[farmSlug]/breeding/analyze/route.ts` (202 lines)
   - `app/api/[farmSlug]/camps/[campId]/stats/route.ts` (146 lines)
   - `app/api/[farmSlug]/export/route.ts` (78 lines)
   - `app/api/[farmSlug]/farm-settings/ai/route.ts` (268 lines)
   - `app/api/[farmSlug]/farm-settings/methodology/route.ts` (194 lines)

5. **Test invariant:**
   - `__tests__/api/route-handler-coverage.test.ts` (delete lines 64-68 from EXEMPT — verify the regex still finds your migrated routes)

---

## 8-gate demo-ready checklist (per CLAUDE.md)

Run all of these in the worktree root from a clean state. Refresh `prisma generate` before tsc:

```sh
pnpm install
pnpm prisma generate
rm -rf .next/cache/tsbuildinfo .tsbuildinfo
pnpm build --webpack          # 1. build green (Turbopack breaks Serwist — never use)
npx tsc --noEmit              # 2. tsc green (after prisma generate + tsbuildinfo wipe)
pnpm vitest run               # 3. vitest green (~2840 passing matches G4/G5/G6 baseline)
pnpm lint                     # 4. lint green (138 pre-existing warnings; 0 errors)
node scripts/audit-findmany-no-take.mjs    # 5. 0 new offenders (179 grandfathered)
node scripts/audit-findmany-no-select.mjs  # 6. 0 new offenders (91 grandfathered)
git status -sb                # 7. exactly 6 files staged (5 routes + 1 test)
# 8. route-handler-coverage test invariant passes (verified by step 3)
```

If any of these is RED — STOP. Diagnose root cause. Don't paper over.

`prisma generate` is critical because tsbuildinfo can cache stale Prisma model accessors → false-positive "Property 'campCoverReading' does not exist" errors (G6 hit this). Always regen before trusting tsc.

---

## Hand-off

When all 8 gates are green:

1. `git add` the 6 files explicitly. Do NOT `git add -A` (CLAUDE.md rule + safety against `public/sw.js` etc.).
2. `git status -sb` and verify exactly 6 files staged. If `public/sw.js` or `public/templates/farmtrack-import-template.xlsx` show up dirty, leave them dirty (they regen on every build).
3. Commit with this exact title:
   ```
   feat(mixed-features): migrate 5 routes onto slug adapter (Wave G7, ADR-0001 7/8 part 7)
   ```
   Body should mirror Wave G6's commit body shape: brief mission paragraph + per-route bullets + risk-vector summary + gates-green confirmation.
4. `git push -u origin wave/171-mixed-features-slug`.
5. `gh pr create` with title `feat(mixed-features): migrate 5 routes onto slug adapter (Wave G7, ADR-0001 7/8 part 7)` and a brief description matching the commit body.
6. Report back: PR URL, branch SHA, diff stats (files changed / +N/-M / vitest count), and the per-gate results table.

The dispatching agent (parent) will then handle: 4-gate poll → soak (audit completedAt + 1h) → 6-criteria check → promote label → require=SUCCESS → squash-merge → cleanup → post-merge-promote verify → wave-history-log.md update → Wave G8 dispatch.

---

## Anti-patterns to avoid (Wave G6 lessons)

- ❌ **Do not** flip wire-shape codes that don't need flipping. The hybrid (Option A) is intentional. Migrate auth/scope to the adapter; keep everything else as-is.
- ❌ **Do not** add new admin-fresh-role gates. None of these 5 routes have one currently.
- ❌ **Do not** add `camp-belongs-to-farm` checks to camps/[campId]/stats. Pre-existing gap, out-of-scope.
- ❌ **Do not** extract domain modules. All 5 routes already delegate computation to `lib/server/*` modules; the route is pure transport.
- ❌ **Do not** rename `aiSettings` blob keys, `validateBody`, `validateMethodology`, `parseAiSettings`, `mergeAiSettings`. Keep them.
- ❌ **Do not** consolidate `EINSTEIN_TIER_LOCKED` / `"This export requires..."` into one tier-gate helper across routes. Each route's tier-gate has subtle differences (basic-vs-paid, advanced-only export types) — keep them inline.
- ❌ **Do not** edit `lib/server/farm-context-slug.ts`, `lib/server/farm-context-errors.ts`, `lib/server/breeding-analytics.ts`, `lib/einstein/settings-schema.ts`, `lib/server/export/**`, `lib/server/revalidate.ts`. Out-of-scope.
- ❌ **Do not** `git commit --amend` if a hook fails — diagnose, fix, NEW commit (CLAUDE.md rule).
- ❌ **Do not** skip `prisma generate` before tsc. (G6 hit a stale-baseline tsc red-herring.)

Reference: Wave G6 PR #170 ([commit `79b0adb`](https://github.com/lucvanrhyn/farm-management/commit/79b0adb)).
