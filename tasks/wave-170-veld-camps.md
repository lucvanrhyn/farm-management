# Wave G6 — veld-assessments + camps/cover slug-aware migration (ADR-0001 7/8 part 6)

## Mission

Migrate 4 farm-condition routes to the slug-aware adapters
(`tenantReadSlug` / `tenantWriteSlug`):

- `/api/[farmSlug]/veld-assessments` (GET + POST; ADMIN-or-MANAGER write,
  NO fresh-admin gate)
- `/api/[farmSlug]/veld-assessments/[id]` (DELETE; admin-fresh)
- `/api/[farmSlug]/camps/[campId]/cover` (GET + POST + DELETE; admin-fresh
  on writes)
- `/api/[farmSlug]/camps/[campId]/cover/[readingId]/attachment` (PATCH;
  any authenticated farm member — NO admin gate)

All four are pure transport-layer migrations — **no domain extraction**:

- `lib/calculators/veld-score.ts` (`calcVeldScore`, `calcGrazingCapacity`)
  is already a pure module. Keep imports unchanged.
- Cover-readings math (`CATEGORY_KG_DM`, `DEFAULT_USE_FACTOR`,
  `DAILY_DMI_PER_HEAD`, `calcDaysRemaining`) is camp-cover-specific and
  stays inline in `cover/route.ts`.
- The attachment route is **JSON-only** (`{ attachmentUrl: string }`) —
  Blob upload happens client-side via Vercel Blob signed URLs elsewhere.
  No multipart/form-data handling required by the adapter.

This is Wave G6 of ADR-0001 ([docs/adr/0001-route-handler-architecture.md](../docs/adr/0001-route-handler-architecture.md)).
Pattern proven by Waves A–F (subdomain) and G1–G5 (slug).

## Branch

`wave/170-veld-camps-slug` (24 chars, under the 36-char Turso budget).

## Strict file allow-list — DO NOT touch anything outside this list

**Routes (migrate to slug adapters):**
- `app/api/[farmSlug]/veld-assessments/route.ts`
- `app/api/[farmSlug]/veld-assessments/[id]/route.ts`
- `app/api/[farmSlug]/camps/[campId]/cover/route.ts`
- `app/api/[farmSlug]/camps/[campId]/cover/[readingId]/attachment/route.ts`

**Coverage tests (remove exempts):**
- `__tests__/api/route-handler-coverage.test.ts` — remove the 4 exempts at
  lines 65, 66, 84, 85 (corresponding to the 4 routes above).

**Audit baselines (lockstep — only if a findMany site moves):**
- Inspect each route for inline `prisma.<model>.findMany()` calls. None of
  the four is expected to require domain extraction this wave (math stays
  inline; calc helpers already pure). If any baselines need remap, swap the
  path key in BOTH `.audit-findmany-baseline.json` AND
  `.audit-findmany-no-select-baseline.json` — never add new exempts.

**MUST NOT TOUCH (outside the wave's scope):**
- `lib/calculators/veld-score.ts` — pure helper, many outside consumers.
- `lib/server/farm-context-slug.ts` and `lib/server/farm-context-errors.ts`
  — adapter-internal; touched by Wave G1.
- `lib/server/route/tenant-{read,write}-slug.ts` — adapter-internal.
- Any other `app/api/**` routes.

Anything else is out of scope. If you discover scope creep is needed,
STOP and report — do not silently expand.

## Risk profile — MEDIUM

Three risk vectors compared to G5 (LOW):

1. **Multi-segment dynamic params.** The attachment route has THREE params
   (`farmSlug`, `campId`, `readingId`). Adapter type-param wiring on
   `tenantReadSlug<{ farmSlug; campId; readingId }>` /
   `tenantWriteSlug<{ farmSlug; campId; readingId }>` is heavier than
   anything proven in Waves G1–G5. Verify the adapter accepts arbitrary
   extra string keys in `TParams` — read `lib/server/route/tenant-*-slug.ts`
   first to confirm the contract.
2. **Nested ownership chain.** Cover routes verify `campId` belongs to
   `ctx.farm.id`; the attachment route additionally verifies `readingId`
   belongs to `campId`. These are inline `prisma.<model>.findFirst()` calls
   inside the existing handlers. Keep them VERBATIM inside the adapter
   `handle` callback — the adapter only handles farm-scope, never
   sub-resource ownership. (Note: the existing attachment route does NOT
   verify camp-belongs-to-farm; that's a defence-in-depth gap, but adding
   the check is OUT OF SCOPE for this wave — preserve current behaviour.)
3. **Variant `verifyFreshAdminRole` signature.** All four routes call
   `verifyFreshAdminRole(ctx.session.user.id, ctx.slug)` — different from
   the G5 routes which used `(userEmail, farm.id)`. Keep verbatim. Read
   `lib/auth.ts` to confirm the function signature, but don't change which
   identifiers are passed.

## Routes table — wire-shape preservation contract

Following Option A (Wave G2/G4/G5 precedent): adapter emits typed
`{success: false, error: CODE, message}` for auth/scope; route-handler-emitted
errors keep existing wire-shape unchanged.

| Route | Method | Adapter | Failure paths | Wire shape (per failure) |
|---|---|---|---|---|
| `/api/[farmSlug]/veld-assessments` | GET | `tenantReadSlug` | 401 auth | adapter `AUTH_REQUIRED` |
| | POST | `tenantWriteSlug` | 401 auth | adapter `AUTH_REQUIRED` |
| | | | 403 not ADMIN/MANAGER (NO fresh check) | preserve current shape |
| | | | 400 validation (8 distinct branches) | preserve current shape |
| | | | 404 camp not found | preserve current shape |
| `/api/[farmSlug]/veld-assessments/[id]` | DELETE | `tenantWriteSlug` | 401 auth | adapter `AUTH_REQUIRED` |
| | | | 403 not ADMIN | preserve current shape |
| | | | 403 fresh-admin denied | preserve current shape |
| | | | 404 not found | preserve current shape |
| `/api/[farmSlug]/camps/[campId]/cover` | GET | `tenantReadSlug` | 401 auth | adapter `AUTH_REQUIRED` |
| | POST | `tenantWriteSlug` | 401, 403 (admin/fresh), 400, 404 | same hybrid |
| | DELETE | `tenantWriteSlug` | 401, 403 (admin/fresh), 400 | same hybrid |
| `/api/[farmSlug]/camps/[campId]/cover/[readingId]/attachment` | PATCH | `tenantWriteSlug` | 401 auth | adapter `AUTH_REQUIRED` |
| | | | 400 validation, 404 not found, 500 db | preserve current shape |

## Key inline patterns to preserve

### veld-assessments POST — DUAL-ROLE gate (NO fresh check)

```ts
export const POST = tenantWriteSlug<{ farmSlug: string }>({
  handle: async (ctx, req) => {
    if (ctx.role !== "ADMIN" && ctx.role !== "MANAGER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // …existing JSON parse + 8 validation branches verbatim…
    // …calcVeldScore/calcGrazingCapacity inline call verbatim…
    // …prisma.veldAssessment.create verbatim…
    revalidateObservationWrite(farmSlug);
    return NextResponse.json({ assessment: created }, { status: 201 });
  },
});
```

NB: this route does NOT call `verifyFreshAdminRole` because MANAGER is
allowed. Do not add a fresh-admin gate here — preserve behaviour.

### veld-assessments [id] DELETE — admin-fresh gate

```ts
export const DELETE = tenantWriteSlug<{ farmSlug: string; id: string }>({
  handle: async (ctx, req, { id }) => {
    if (ctx.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    if (!(await verifyFreshAdminRole(ctx.session.user.id, ctx.slug))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    try {
      await ctx.prisma.veldAssessment.delete({ where: { id } });
      revalidateObservationWrite(farmSlug);
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }
  },
});
```

### camps/cover POST/DELETE — admin-fresh gate, two-segment params

```ts
export const POST = tenantWriteSlug<{ farmSlug: string; campId: string }>({
  handle: async (ctx, req, { campId }) => {
    if (ctx.role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    if (!(await verifyFreshAdminRole(ctx.session.user.id, ctx.slug))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // …body parse + validation + dual prisma fetch + create verbatim…
  },
});
```

### attachment PATCH — three-segment params, NO admin gate

```ts
export const PATCH = tenantWriteSlug<{
  farmSlug: string;
  campId: string;
  readingId: string;
}>({
  handle: async (ctx, req, { campId, readingId }) => {
    // No role check — any authenticated farm member can attach.
    const body = await req.json();
    const { attachmentUrl } = body;
    if (typeof attachmentUrl !== "string" || !attachmentUrl) {
      return NextResponse.json(
        { error: "attachmentUrl must be a non-empty string" },
        { status: 400 },
      );
    }
    try {
      const existing = await ctx.prisma.campCoverReading.findFirst({
        where: { id: readingId, campId },
      });
      if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const updated = await ctx.prisma.campCoverReading.update({
        where: { id: readingId },
        data: { attachmentUrl },
      });
      return NextResponse.json({ success: true, attachmentUrl: updated.attachmentUrl });
    } catch (err) {
      logger.error("[cover/attachment PATCH] DB error", err);
      return NextResponse.json(
        { error: "Failed to update attachment" },
        { status: 500 },
      );
    }
  },
});
```

## ctx contract reminder

Confirm the exact ctx field names by reading
`lib/server/route/tenant-{read,write}-slug.ts`. The existing routes use:
- `ctx.prisma`
- `ctx.role` (`"ADMIN" | "MANAGER" | "VIEWER"` etc.)
- `ctx.session.user.id` (for `verifyFreshAdminRole`)
- `ctx.slug` (for `verifyFreshAdminRole`)
- `ctx.session.user.email` (for `recordedBy` in cover POST and `createdBy`
  in veld POST — both fall back to "Unknown" / null)
- `ctx.farm` (with `.id`, etc.)

Use whichever field names the adapter actually exposes. If the adapter
contract differs from the existing inline `getFarmContextForSlug` shape,
adapt the destructuring — never invent fields.

## TDD discipline

For each route migration:
1. Migrate route to slug adapter + `verifyFreshAdminRole`-inline (where
   applicable) + existing helper calls verbatim.
2. `npx tsc --noEmit` clean.
3. Run any route-specific test files (e.g.
   `pnpm vitest run __tests__/api/veld-assessments` if it exists) green.
4. Full suite `pnpm vitest run` — no regressions (2840 baseline post-Wave G5).

## 8-gate demo-ready checklist (before requesting PR review)

- [ ] `pnpm build --webpack` green from worktree root (NEVER use Turbopack).
- [ ] `npx tsc --noEmit` green (after `rm -rf .next/cache/tsbuildinfo .tsbuildinfo`).
- [ ] `pnpm vitest run` all 2840+ existing tests still pass (no new tests
      expected this wave; if you add any, must be green).
- [ ] `pnpm lint` clean.
- [ ] No edits outside the file allow-list (`git diff --name-only origin/main..HEAD` should match the list above — exactly 5 files).
- [ ] `__tests__/api/route-handler-coverage.test.ts` no longer exempts the 4 routes.
- [ ] Both audit scripts pass locally with 0 new offenders:
  ```
  pnpm tsx scripts/audit-findmany-no-take.ts
  pnpm tsx scripts/audit-findmany-no-select.ts
  ```
- [ ] All 4 routes use `tenantReadSlug` / `tenantWriteSlug`. No remaining
      `getFarmContextForSlug` calls in the migrated files.
- [ ] `verifyFreshAdminRole(ctx.session.user.id, ctx.slug)` defence-in-depth
      checks preserved verbatim where they exist (Phase H.2 pattern; bespoke
      logic remains in route handler; not pushed to adapter).
- [ ] veld-assessments POST keeps DUAL-ROLE (ADMIN-or-MANAGER) gate WITHOUT
      a fresh-admin check.
- [ ] attachment PATCH keeps NO admin gate (any authenticated farm member).

## Hand-off

When complete, push the branch and report:
- branch SHA
- commit count + +/-
- Vitest pass count
- The `git diff --name-only origin/main..HEAD` listing
- Confirmation that both audit scripts pass with 0 new offenders
- Any deviations from the spec, with justification

Open the PR with title:
`feat(veld-camps): migrate veld-assessments + camps/cover routes onto slug adapter (Wave G6, ADR-0001 7/8 part 6)`

Reference: PR #165 (Wave G1, NVD precedent), PR #166 (G2 rotation), PR #167
(G3 map), PR #168 (G4 analytics-read), PR #169 (G5 mixed-CRUD).
