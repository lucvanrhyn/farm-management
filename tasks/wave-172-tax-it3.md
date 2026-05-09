# Wave G8 (#172) — tax/it3 slug-adapter migration (FINAL feature wave, ADR-0001 7/8 part 8)

## Mission

Migrate the 5 SARS IT3 tax-export routes under `app/api/[farmSlug]/tax/it3/**` onto slug-aware adapters (`tenantReadSlug` / `tenantWriteSlug`) — the **final feature wave** before Wave H (publicHandler wrapping). Each prior wave (G1–G7) was rehearsal for this one: tier gates, fresh-admin checks, binary `Response` bodies, rate-limits, financial-year cutoff validation, and write-state machines (issue → void) are all in play here simultaneously.

**HIGH-risk vectors.** This wave touches financial-compliance surface — IT3 snapshots feed the South African SARS tax filing. Get any wire-shape change wrong and you break end-of-year tax exports for advanced-tier farms. **Every error wire-shape is preserved verbatim.** The only allowed semantic change is collapsing 401 paths into the canonical adapter `AUTH_REQUIRED` envelope (G3 precedent; client `it3.ts` already tolerates either shape because adapters always emit it now).

## Branch + worktree

- **Branch:** `wave/172-tax-it3-slug` (21 chars, well under 36-char Turso budget)
- **Worktree:** `.worktrees/wave/172-tax-it3-slug` (already created off `origin/main` at SHA `4533c7d8`)
- **Base PR target:** `main`

## File allow-list (STRICT — agent may not edit anything else)

You may edit ONLY these 6 files:

1. `app/api/[farmSlug]/tax/it3/route.ts` (GET + POST → tenantReadSlug + tenantWriteSlug)
2. `app/api/[farmSlug]/tax/it3/[id]/route.ts` (GET → tenantReadSlug)
3. `app/api/[farmSlug]/tax/it3/[id]/pdf/route.ts` (GET → tenantReadSlug, returns binary `application/pdf` body)
4. `app/api/[farmSlug]/tax/it3/[id]/void/route.ts` (POST → tenantWriteSlug)
5. `app/api/[farmSlug]/tax/it3/preview/route.ts` (GET → tenantReadSlug)
6. `__tests__/api/route-handler-coverage.test.ts` — DELETE EXACTLY lines 79–83 (the 5 `[farmSlug]/tax/it3/**` EXEMPT entries) and update the inline comment block above to add a `Wave G8 (#172) — tax/it3 slice (5 routes)` annotation. Do NOT touch any other EXEMPT entries.

If a bug surfaces outside this list, **stop and document it in the PR body** (defer to a separate security-hardening wave). Scope creep is the failure mode this allow-list prevents.

## Pre-flight reading (do this BEFORE writing any code)

Read these in order, top-to-bottom, before drafting the diff:

1. `lib/server/route/tenant-read-slug.ts` (full file, ~80 lines) — **especially** the PDF-route note at lines 18-22: "the handle may return any Response (including a binary application/pdf body). The adapter never wraps the success response — only error paths mint JSON envelopes." This is the contract the `pdf` route relies on.
2. `lib/server/route/tenant-write-slug.ts` (full file, ~150 lines) — auth/body-parse/error-mapping/revalidate flow.
3. `lib/server/route/index.ts` — verify the public exports.
4. `lib/server/route/types.ts` — `RouteContext`, `RouteParams`, `TenantWriteOpts`, `RouteValidationError`.
5. `lib/server/api-errors.ts` — `mapApiDomainError`. Throws from domain helpers (`issueIt3Snapshot`, `voidIt3Snapshot`, `getIt3Payload`) flow through this; verify no IT3-specific error class is missing.
6. `lib/server/sars-it3.ts` — confirm `issueIt3Snapshot`, `voidIt3Snapshot`, `getIt3Payload` signatures and what they throw on failure (especially the financial-year cutoff and "tax year already issued" branches).
7. `lib/server/sars-it3-pdf.ts` — `buildIt3Pdf` returns a `Buffer | Uint8Array`. Don't change its call site.
8. **Wave G6 (PR #170)** and **Wave G7 (PR #171)** as reference implementations — same pattern. Skim `app/api/[farmSlug]/farm-settings/ai/route.ts` (G7 hybrid wire-shape) and `app/api/[farmSlug]/veld-assessments/route.ts` (G6 dual-role gate) for the exact migration shape you'll mirror.
9. `tasks/wave-171-mixed-features.md` (the G7 dispatch spec) — same template; this spec mirrors its structure.

## Migration patterns (per-route)

### Route 1 — `tax/it3/route.ts`

**Two handlers in one file.** Use both `tenantReadSlug` and `tenantWriteSlug` from `lib/server/route`.

```ts
// GET — list issued snapshots (paginated)
export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (req, { ctx }) => {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = 20;
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      ctx.prisma.it3Snapshot.findMany({
        orderBy: { issuedAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          taxYear: true,
          issuedAt: true,
          periodStart: true,
          periodEnd: true,
          generatedBy: true,
          voidedAt: true,
          voidReason: true,
        },
      }),
      ctx.prisma.it3Snapshot.count(),
    ]);

    return NextResponse.json({ records, total, page, limit });
  },
});

// POST — issue a new snapshot (ADMIN, paid-tier, rate-limited)
export const POST = tenantWriteSlug<unknown, { farmSlug: string }>({
  revalidate: ({ params }) => revalidateObservationWrite(params.farmSlug),
  handle: async (req, { ctx, params }) => {
    if (ctx.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!(await verifyFreshAdminRole(ctx.session.user.id, ctx.slug))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const creds = await getFarmCreds(params.farmSlug);
    if (!creds || !isPaidTier(creds.tier)) {
      return NextResponse.json(
        { error: "SARS IT3 Tax Export requires an Advanced subscription." },
        { status: 403 },
      );
    }

    const rl = checkRateLimit(`it3-issue:${params.farmSlug}`, 5, 10 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many IT3 export requests. Please wait." },
        { status: 429 },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const taxYearRaw = body.taxYear;
    const taxYear = typeof taxYearRaw === "number"
      ? taxYearRaw
      : typeof taxYearRaw === "string"
        ? parseInt(taxYearRaw, 10)
        : NaN;
    if (!Number.isFinite(taxYear) || taxYear < 2000 || taxYear > 2100) {
      return NextResponse.json(
        { error: "taxYear must be a number between 2000 and 2100" },
        { status: 400 },
      );
    }

    try {
      const record = await issueIt3Snapshot(ctx.prisma, {
        taxYear,
        generatedBy: ctx.session.user?.email ?? null,
      });
      return NextResponse.json(record, { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to issue IT3 snapshot";
      return NextResponse.json({ error: message }, { status: 422 });
    }
  },
});
```

**Notes:**
- POST uses `tenantWriteSlug<unknown, {...}>` because there's no Zod schema (loose `Record<string, unknown>` body). The first type param `TBody = unknown` matches.
- `revalidate` hook moved to adapter option (G5/G6/G7 convention) — call it inline-after-write removed.
- `verifyFreshAdminRole(ctx.session.user.id, ctx.slug)` — variant signature (G6 precedent), not `(userEmail, farmId)`.
- 422 on `issueIt3Snapshot` failure preserved verbatim (it can throw "tax year already issued" / financial-year cutoff errors — those messages need to flow through unchanged for the UI's error toast).

### Route 2 — `tax/it3/[id]/route.ts`

```ts
export const GET = tenantReadSlug<{ farmSlug: string; id: string }>({
  handle: async (_req, { ctx, params }) => {
    const record = await ctx.prisma.it3Snapshot.findUnique({ where: { id: params.id } });
    if (!record) {
      return NextResponse.json({ error: "IT3 snapshot not found" }, { status: 404 });
    }
    return NextResponse.json(record);
  },
});
```

Trivial. No tier-gate (any authenticated farm member can read a snapshot). 404 bare-string preserved.

### Route 3 — `tax/it3/[id]/pdf/route.ts` — BINARY RESPONSE

**Critical:** this route returns a binary `application/pdf` body. The adapter (`tenant-read-slug.ts:18-22`) explicitly supports raw `Response` returns from `handle` — adapter only mints JSON envelopes on the error path.

```ts
export const GET = tenantReadSlug<{ farmSlug: string; id: string }>({
  handle: async (_req, { ctx, params }) => {
    const record = await ctx.prisma.it3Snapshot.findUnique({ where: { id: params.id } });
    if (!record) {
      return NextResponse.json({ error: "IT3 snapshot not found" }, { status: 404 });
    }

    const pdf = buildIt3Pdf({
      taxYear: record.taxYear,
      issuedAt: record.issuedAt,
      payload: record.payload,
      generatedBy: record.generatedBy,
      pdfHash: record.pdfHash,
      voidedAt: record.voidedAt,
      voidReason: record.voidReason,
    });

    const filename = `sars-it3-${record.taxYear}.pdf`;
    return new Response(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  },
});
```

**Notes:**
- Old route returned `new Response(JSON.stringify({error: "Unauthorized"}), {status: 401})` for the no-ctx branch (line 16-18). The adapter now handles 401 with the canonical typed envelope — that branch goes away.
- 404 path uses `NextResponse.json` (not `new Response(JSON.stringify(...))`) for consistency with G7 export route. **Behaviour identical** — both produce `{error: "..."}` JSON with `Content-Type: application/json`.
- `Content-Disposition: attachment` header preserved verbatim — this is what triggers the file-save dialog in the UI.

### Route 4 — `tax/it3/[id]/void/route.ts`

```ts
export const POST = tenantWriteSlug<unknown, { farmSlug: string; id: string }>({
  revalidate: ({ params }) => revalidateObservationWrite(params.farmSlug),
  handle: async (req, { ctx, params }) => {
    if (ctx.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!(await verifyFreshAdminRole(ctx.session.user.id, ctx.slug))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const record = await ctx.prisma.it3Snapshot.findUnique({
      where: { id: params.id },
      select: { id: true, voidedAt: true },
    });
    if (!record) {
      return NextResponse.json({ error: "IT3 snapshot not found" }, { status: 404 });
    }
    if (record.voidedAt) {
      return NextResponse.json({ error: "Snapshot is already voided" }, { status: 409 });
    }

    let body: { reason?: string } = {};
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > 0) {
      try {
        body = (await req.json()) as { reason?: string };
      } catch (err) {
        logger.error('[it3 void] malformed request body', err);
        return NextResponse.json(
          { error: "Request body must be valid JSON" },
          { status: 400 },
        );
      }
    }

    const reason = typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : "Voided by admin";

    await voidIt3Snapshot(ctx.prisma, params.id, reason);

    return NextResponse.json({ ok: true });
  },
});
```

**Notes:**
- Conditional body parsing (only if `content-length > 0`) preserved verbatim — the void endpoint accepts an empty body as "voided without stated reason."
- Default reason `"Voided by admin"` preserved verbatim (audit-trail string).
- 409 conflict for already-voided preserved verbatim.

### Route 5 — `tax/it3/preview/route.ts`

```ts
export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (req, { ctx, params }) => {
    const creds = await getFarmCreds(params.farmSlug);
    if (!creds || creds.tier !== "advanced") {
      return NextResponse.json(
        { error: "SARS IT3 Tax Export requires an Advanced subscription." },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(req.url);
    const taxYearRaw = searchParams.get("taxYear");
    const taxYear = taxYearRaw ? parseInt(taxYearRaw, 10) : NaN;
    if (!Number.isFinite(taxYear) || taxYear < 2000 || taxYear > 2100) {
      return NextResponse.json(
        { error: "taxYear query parameter must be a number between 2000 and 2100" },
        { status: 400 },
      );
    }

    const payload = await getIt3Payload(ctx.prisma, taxYear, ctx.session.user?.email ?? null);
    return NextResponse.json(payload);
  },
});
```

**Notes — DELIBERATE TIER-GATE INCONSISTENCY (preserve verbatim, do NOT "fix"):**
- POST in route 1 uses `isPaidTier(creds.tier)` (allows `"advanced"` and `"consulting"`).
- preview uses strict `creds.tier !== "advanced"` (rejects `"consulting"`).
- This is a pre-existing discrepancy — preview blocks consulting-tier farmers from preview-rendering even though they can issue snapshots via POST. **Do NOT fix it in this wave.** Out of scope. Document in the PR body so a future security-hardening wave can decide whether this is intentional or a bug.
- Tier-gate string `"SARS IT3 Tax Export requires an Advanced subscription."` is identical between POST and preview — preserve byte-for-byte.

### Route 6 — `__tests__/api/route-handler-coverage.test.ts`

Delete exactly lines 79–83 (the 5 `[farmSlug]/tax/it3/**` entries). Update the inline comment block at line 76-78 to:

```
  // Wave G7 (#171) — mixed-features slice (5 routes) migrated onto slug-aware adapters:
  //   breeding/analyze, camps/[campId]/stats, export,
  //   farm-settings/ai, farm-settings/methodology.
  // Wave G8 (#172) — tax/it3 slice (5 routes — FINAL feature wave) migrated onto slug-aware adapters:
  //   tax/it3 (GET/POST), tax/it3/[id] (GET), tax/it3/[id]/pdf (GET, binary application/pdf body),
  //   tax/it3/[id]/void (POST, write state machine), tax/it3/preview (GET).
```

## Wire-shape contract — all 5 routes

| Status | Source | Shape | Verbatim string |
|---|---|---|---|
| 401 | adapter (no ctx) | typed `{success: false, error: "AUTH_REQUIRED"}` | (set by adapter) |
| 403 | route handler (role !== ADMIN) | bare `{error: "Forbidden"}` | "Forbidden" |
| 403 | route handler (verifyFreshAdminRole false) | bare `{error: "Forbidden"}` | "Forbidden" |
| 403 | route handler (tier-gate POST) | bare | "SARS IT3 Tax Export requires an Advanced subscription." |
| 403 | route handler (tier-gate preview) | bare | "SARS IT3 Tax Export requires an Advanced subscription." |
| 429 | route handler (rate-limit POST) | bare | "Too many IT3 export requests. Please wait." |
| 400 | route handler (bad JSON, POST) | bare | "Invalid JSON body" |
| 400 | route handler (taxYear OOR, POST) | bare | "taxYear must be a number between 2000 and 2100" |
| 400 | route handler (taxYear OOR, preview) | bare | "taxYear query parameter must be a number between 2000 and 2100" |
| 400 | route handler (bad JSON, void) | bare | "Request body must be valid JSON" |
| 404 | route handler (snapshot missing) | bare | "IT3 snapshot not found" |
| 409 | route handler (already voided) | bare | "Snapshot is already voided" |
| 422 | route handler (issueIt3Snapshot throw) | bare, message from caught Error | preserve `err.message` flow |
| 200 | route handler (GET, list/single/preview/void) | `NextResponse.json(...)` | as-is |
| 200 | route handler (GET pdf) | raw `Response(pdf, {Content-Type: application/pdf})` | binary, NOT JSON |
| 201 | route handler (POST issue) | `NextResponse.json(record, {status: 201})` | as-is |

**Hybrid wire-shape (Option A) — all 5 routes:** typed adapter envelope only for auth (401). Every route-handler-emitted error keeps the legacy `{error: "<sentence>"}` bare-string for backward-compat with the IT3 UI form's error toast (`components/tax/IT3IssueForm.tsx` reads `body.error` directly). Don't introduce typed codes here.

## Imports

Each route should import from these (as needed):
- `import { NextResponse } from "next/server";` — keep for handler-emitted JSON
- `import { tenantReadSlug, tenantWriteSlug } from "@/lib/server/route";`
- `import { verifyFreshAdminRole } from "@/lib/auth";` (POST + void)
- `import { getFarmCreds } from "@/lib/meta-db";` (POST + preview)
- `import { isPaidTier } from "@/lib/tier";` (POST only)
- `import { checkRateLimit } from "@/lib/rate-limit";` (POST only)
- `import { issueIt3Snapshot, voidIt3Snapshot, getIt3Payload } from "@/lib/server/sars-it3";` (per-route)
- `import { buildIt3Pdf } from "@/lib/server/sars-it3-pdf";` (pdf only)
- `import { revalidateObservationWrite } from "@/lib/server/revalidate";` (POST + void)
- `import { logger } from "@/lib/logger";` (void only)

Drop `getFarmContextForSlug` import from all 5 routes — no longer needed (adapter resolves ctx).

## 8-gate demo-ready checklist (run before opening PR)

1. **build:** `pnpm build --webpack` — must complete cleanly. NEVER use turbo flag.
2. **tsc:** `rm -rf .next/cache/tsbuildinfo .tsbuildinfo && pnpm prisma generate && npx tsc --noEmit` — zero errors.
3. **vitest:** `pnpm vitest run` — must show **2840 passed / 19 skipped** (matches G4–G7 baseline). If count differs, investigate before opening PR.
4. **lint:** `pnpm lint` — 138 warnings allowed (existing baseline), 0 errors.
5. **audit-findmany-no-take:** `pnpm tsx scripts/audit-findmany-no-take.ts` — 179 grandfathered (no change; the GET in route 1 already has `take: limit`).
6. **audit-findmany-no-select:** `pnpm tsx scripts/audit-findmany-no-select.ts` — 91 grandfathered (no change).
7. **git status:** must show **exactly 6 files modified** (the 5 route files + the test file). Nothing else. Use `git status -sb` and verify.
8. **route-handler-coverage invariant:** `pnpm vitest run __tests__/api/route-handler-coverage.test.ts` — must pass. Confirms the 5 routes now export from one of the 4 adapters and are no longer in EXEMPT.

## Anti-patterns (do not do)

1. **Do NOT** add typed error codes to existing bare-string handler errors. Wire-shape is preserved verbatim. Adapter-emitted 401 is the only typed envelope.
2. **Do NOT** "fix" the preview tier-gate inconsistency (`creds.tier !== "advanced"` vs `isPaidTier`). Out of scope.
3. **Do NOT** add `camp-belongs-to-farm` ownership checks anywhere — IT3 routes don't reference camps directly. (G6's deferred attachment-PATCH check is unrelated.)
4. **Do NOT** extract a `lib/domain/tax-it3/` module. Pure transport-layer migration. The `lib/server/sars-it3.ts` helpers stay as-is — they're the domain layer already.
5. **Do NOT** change `buildIt3Pdf` call args. Preserve `taxYear/issuedAt/payload/generatedBy/pdfHash/voidedAt/voidReason` 7-field destructure verbatim.
6. **Do NOT** add Zod schema validation. Bodies stay loosely typed (`Record<string, unknown>` for POST, `{reason?: string}` for void). The original 2000–2100 range check is the validation; preserve the exact error string.
7. **Do NOT** edit any file outside the 6-file allow-list. If you spot a bug elsewhere, document it in the PR body and stop.
8. **Do NOT** stage `public/sw.js` or `public/templates/farmtrack-import-template.xlsx` even if they show dirty (Serwist + ExcelJS rebuild artefacts; established pattern).
9. **Do NOT** skip the 8-gate checklist. Each gate caught a class of bug in prior waves; G8 is the final feature wave and the most expensive to debug post-merge.

## Hand-off

After all 8 gates pass cleanly:

1. `git add -p` (or `git add` the 6 files explicitly — never `git add -A`).
2. Commit message: `feat(tax-it3): migrate 5 routes onto slug adapter (Wave G8, ADR-0001 7/8 part 8 — final feature wave) (#172)`
3. Push: `git push -u origin wave/172-tax-it3-slug`
4. Open PR via `gh pr create --base main --title "<commit message>" --body-file -` with body covering:
   - 5 routes migrated (list each verbatim)
   - +/-line counts
   - vitest pass count
   - "HIGH-risk vectors all preserved verbatim:" — list (binary PDF body, paid-tier gate, void state machine, financial-year cutoff messages, rate-limit, conditional body parse on void)
   - Pre-existing tier-gate inconsistency note (preview vs POST) — flag for security-hardening wave
   - Closes Wave G8 / ADR-0001 7/8 part 8 / final feature wave before Wave H

5. Report PR URL + SHA back to the orchestrator. **Do not apply the promote label** — that's the orchestrator's call after the 6-criteria check + soak.

## Out of scope (deferred)

- **Tier-gate preview vs POST inconsistency** — flag in PR body, defer to security-hardening wave.
- **Wave H** — `publicHandler` wrapping for proxy-matcher exclusions. Closes ADR-0001 7/8 entirely. Separate wave.
- **G6 deferred** — `camp-belongs-to-farm` ownership check on cover/[readingId]/attachment PATCH. Unrelated to tax-it3.
