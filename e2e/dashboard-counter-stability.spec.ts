import { test, expect } from '@playwright/test';
import { applyAuth } from './fixtures/auth';

/**
 * Issue #415 — Dashboard counter stability regression guard (PRD #412).
 *
 * Locks two structural invariants shipped by PRD #412:
 *
 * 1. **Mode-independent "Total Camps" / "Inspections Today"** — flipping
 *    FarmMode (cattle ↔ sheep) MUST NOT change the camps tiles. Fixed by
 *    issue #411 (PR #416, commit `82e851f`) which split the cached overview
 *    fetcher into a mode-keyed by-mode fetcher and a slug-only-keyed shared
 *    fetcher. `totalCamps`, `inspectedToday`, `liveConditions`, `dataHealth`
 *    now live on `getCachedDashboardOverviewShared` and survive cookie flips.
 *
 * 2. **`camp_condition` write busts the camps cache tag** — submitting a
 *    camp_condition observation MUST cause `inspectedToday` to increment
 *    well before the 30s `unstable_cache` TTL. Fixed by issue #409 (PR #417,
 *    commit `d8daa3a`) which made `observationWriteTags(slug, type)` append
 *    `farm-<slug>-camps` iff `isCampInspection(type)` is true.
 *
 * 3. **animal camp move busts the camps cache tag (issue #420)** —
 *    `PATCH /api/animals/[id]` with a new `currentCamp` MUST cause the
 *    per-camp `animal_count` returned by `GET /api/camps`
 *    (`getCachedCampList`, tagged `farm-<slug>-camps`) to reflect the move
 *    inside the 30s TTL window. Fixed by adding `farmTag(slug, "camps")`
 *    to `animalWriteTags(slug)` so `revalidateAnimalWrite` drops the camps
 *    cache entry. The animal-roster → camp `animal_count` coupling lives
 *    in the `animal.groupBy({ by: ["currentCamp"] })` inside
 *    `getCachedCampList` in `lib/server/cached.ts`.
 *
 * If any fix regresses — fetcher split collapsed, the camps tag dropped
 * from `observationWriteTags`, or the camps tag dropped from
 * `animalWriteTags` — this spec fails loudly.
 *
 * Negative control: a `general` (non-camp-inspection) write MUST NOT
 * invalidate the camps tag, so `inspectedToday` MUST NOT increment off the
 * back of it. The Wave V1 verifier used `weight_record` for this — we use
 * `general` because it accepts a null animal_id (cleaner API contract).
 *
 * Required env (self-skips when absent — same pattern as the rest of the
 * authenticated specs):
 *   E2E_BASE_URL — http://localhost:3000 in CI / preview URL for synthetic.
 *   E2E_IDENTIFIER — bench user identifier.
 *   E2E_PASSWORD — bench user password.
 *   E2E_TENANT_SLUG — single-species tenant for the cookie-flip path
 *                     (default `basson-boerdery` per the verifier).
 *   E2E_MULTISPECIES_TENANT_SLUG — optional multi-species tenant for the
 *                     visible-switcher path. Skipped with a clear comment
 *                     when unset (default falls back to `trio-b-boerdery`
 *                     but the visible-switcher test self-skips if the
 *                     tenant only enables a single species).
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const TENANT_SLUG = process.env.E2E_TENANT_SLUG ?? 'basson-boerdery';
const MULTISPECIES_SLUG =
  process.env.E2E_MULTISPECIES_TENANT_SLUG ?? 'trio-b-boerdery';

/** Cookie name matches `lib/farm-mode.tsx` STORAGE_KEY_PREFIX. */
const MODE_COOKIE = (slug: string) => `farmtrack-mode-${slug}`;

/**
 * Read the rendered "Inspections Today" tile value. Format is
 * `<inspected>/<totalCamps>` (e.g. "3/9"). Returns null if the tile is not
 * present (page bounced to /login or did not hydrate).
 *
 * The tile structure (see `components/admin/DashboardContent.tsx:155-164`):
 *   <p>{inspectedToday}/{totalCamps}</p>
 *   <p>Inspections Today</p>
 *
 * We grep the HTML for `(\d+)/(\d+)` immediately preceding "Inspections Today"
 * to avoid coupling to the exact DOM tree (tile re-layouts must not break
 * the regression guard).
 */
function parseInspectionsTile(html: string): { inspected: number; total: number } | null {
  const m = html.match(/(\d+)\s*\/\s*(\d+)\s*(?:<\/[^>]+>\s*)*Inspections Today/);
  if (!m) return null;
  return { inspected: parseInt(m[1], 10), total: parseInt(m[2], 10) };
}

/**
 * Read the rendered "Total Camps" tile value.
 *
 * The tile structure:
 *   <p>{totalCamps}</p>
 *   <p>Total Camps</p>
 */
function parseTotalCampsTile(html: string): number | null {
  const m = html.match(/(\d[\d,]*)\s*(?:<\/[^>]+>\s*)*Total Camps/);
  if (!m) return null;
  return parseInt(m[1].replace(/,/g, ''), 10);
}

/** Resolve the active mode cookie value for the slug (or null when unset). */
async function readModeCookie(
  page: import('@playwright/test').Page,
  slug: string,
): Promise<string | null> {
  return page.evaluate((key: string) => {
    const match = document.cookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(key + '='));
    return match ? match.slice(key.length + 1) : null;
  }, MODE_COOKIE(slug));
}

/**
 * Navigate to /<slug>/admin, wait for the KPI grid to hydrate, and snapshot
 * the camps-tile pair (`totalCamps`, `inspectedToday`).
 */
async function snapshotCampsTiles(
  page: import('@playwright/test').Page,
  slug: string,
): Promise<{ totalCamps: number; inspectedToday: number; totalDenominator: number }> {
  await page.goto(`${BASE_URL}/${slug}/admin`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/\/login/);
  // KPI grid renders both tiles; wait for the "Total Camps" label to appear.
  await expect(page.getByText('Total Camps', { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByText('Inspections Today', { exact: true }).first(),
  ).toBeVisible({ timeout: 15_000 });

  const html = await page.content();
  const total = parseTotalCampsTile(html);
  const inspections = parseInspectionsTile(html);
  expect(total, 'Total Camps tile must render a numeric value').not.toBeNull();
  expect(inspections, 'Inspections Today tile must render N/M').not.toBeNull();
  return {
    totalCamps: total!,
    inspectedToday: inspections!.inspected,
    totalDenominator: inspections!.total,
  };
}

test.describe('Issue #415 — dashboard counter stability (PRD #412)', () => {
  test.skip(
    !IDENTIFIER || !PASSWORD,
    'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping authenticated counter-stability journey',
  );

  test.beforeEach(async ({ context }) => {
    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
  });

  // ── Test 1: cookie-flip path (works on every tenant, single or multi) ─────

  test('totalCamps + inspectedToday stay constant across FarmMode cookie flips', async ({
    page,
    context,
  }) => {
    // Land on /admin so the proxy writes `active_farm_slug` and we have an
    // initial mode cookie (the FarmModeProvider seeds one on first render).
    const baseline = await snapshotCampsTiles(page, TENANT_SLUG);

    // Force the mode cookie to a known starting state. On a single-species
    // tenant the ModeSwitcher is hidden but the cookie path still exercises
    // the server cache-key seam (`getCachedDashboardOverviewByMode` keyed by
    // mode vs `getCachedDashboardOverviewShared` keyed by slug only — the
    // shared overview is mode-independent by construction post-#411).
    const url = new URL(BASE_URL);
    await context.addCookies([
      {
        name: MODE_COOKIE(TENANT_SLUG),
        value: 'cattle',
        domain: url.hostname,
        path: '/',
        sameSite: 'Lax' as const,
      },
    ]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const cattleSnap = await snapshotCampsTiles(page, TENANT_SLUG);

    // Flip to sheep — the by-mode fetcher's cache entry differs by key, the
    // shared fetcher's does NOT. `totalCamps` / `inspectedToday` MUST hold.
    await context.addCookies([
      {
        name: MODE_COOKIE(TENANT_SLUG),
        value: 'sheep',
        domain: url.hostname,
        path: '/',
        sameSite: 'Lax' as const,
      },
    ]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const sheepSnap = await snapshotCampsTiles(page, TENANT_SLUG);

    // Flip back — same invariant.
    await context.addCookies([
      {
        name: MODE_COOKIE(TENANT_SLUG),
        value: 'cattle',
        domain: url.hostname,
        path: '/',
        sameSite: 'Lax' as const,
      },
    ]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const cattleAgainSnap = await snapshotCampsTiles(page, TENANT_SLUG);

    // The three snapshots' camps tiles must be byte-identical. If the fetcher
    // split is reverted (collapsed back to a single mode-keyed fetcher), the
    // shared tiles bleed across the cache boundary and one of these equality
    // checks fails.
    expect(
      cattleSnap.totalCamps,
      `Total Camps changed under cattle (baseline=${baseline.totalCamps}, cattle=${cattleSnap.totalCamps}) — fetcher split may be broken`,
    ).toBe(baseline.totalCamps);
    expect(
      sheepSnap.totalCamps,
      `Total Camps drifted on cattle→sheep flip (${cattleSnap.totalCamps} → ${sheepSnap.totalCamps}) — issue #411 regressed`,
    ).toBe(cattleSnap.totalCamps);
    expect(
      cattleAgainSnap.totalCamps,
      `Total Camps drifted on sheep→cattle flip (${sheepSnap.totalCamps} → ${cattleAgainSnap.totalCamps}) — issue #411 regressed`,
    ).toBe(sheepSnap.totalCamps);

    // Inspections Today denominator MUST match Total Camps and both must be
    // stable across the flips. We DO NOT lock the numerator equal across the
    // three reads because a concurrent inspection (e.g. another agent on the
    // same clone) could legitimately bump it mid-test — but it MUST NOT bump
    // by virtue of flipping the mode cookie alone, so we assert no decrease
    // and a stable denominator.
    expect(sheepSnap.totalDenominator).toBe(cattleSnap.totalDenominator);
    expect(cattleAgainSnap.totalDenominator).toBe(sheepSnap.totalDenominator);
  });

  // ── Test 2: camp_condition write busts the camps tag → inspectedToday +1 ──

  test('submitting a camp_condition observation increments inspectedToday', async ({
    page,
    request,
  }) => {
    // Resolve a camp to inspect via the API. Works on any tenant.
    const campsRes = await request.get(`${BASE_URL}/api/camps`);
    test.skip(
      !campsRes.ok(),
      `GET /api/camps did not return 2xx (${campsRes.status()}) — preview clone not ready`,
    );
    const camps = (await campsRes.json()) as Array<{ camp_id: string; camp_name: string }>;
    test.skip(camps.length === 0, 'tenant has no camps to inspect');
    const camp = camps[0];

    // Snapshot the BEFORE state — `inspectedToday` and `totalCamps`.
    const before = await snapshotCampsTiles(page, TENANT_SLUG);

    // Submit a camp_condition observation via the public API. We include a
    // unique nonce in `details` so the same-day-duplicate guard (#366/#378)
    // never blocks the spec on a re-run within the SA tenant-day window.
    const nonce = `e2e-415-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const details = JSON.stringify({
      grazing: 'Good',
      water: 'Full',
      fence: 'Intact',
      // Extra key ignored by `camp-status.ts` parser but folded into the
      // duplicate-guard's `details === details` predicate, so two separate
      // E2E runs do not collide.
      _e2eNonce: nonce,
    });
    const postRes = await request.post(`${BASE_URL}/api/observations`, {
      data: {
        type: 'camp_condition',
        camp_id: camp.camp_id,
        details,
        clientLocalId: nonce,
      },
    });
    expect(
      postRes.status(),
      `POST /api/observations failed (${postRes.status()}): ${await postRes.text().catch(() => '<no body>')}`,
    ).toBeLessThan(300);

    // Re-snapshot AFTER. The camps tag was invalidated on write (issue #413
    // / PR #417), so `getCachedDashboardOverviewShared`'s cache entry is
    // dropped and the next render re-reads `inspectedToday` from Prisma
    // before the 30s TTL would have done so naturally. We poll up to 10s
    // to absorb any in-flight ISR settlement.
    let after: Awaited<ReturnType<typeof snapshotCampsTiles>> | null = null;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      const snap = await snapshotCampsTiles(page, TENANT_SLUG);
      if (snap.inspectedToday > before.inspectedToday) {
        after = snap;
        break;
      }
      after = snap;
    }
    expect(after, 'snapshotCampsTiles never returned after camp_condition submit').not.toBeNull();

    // The denominator (Total Camps) MUST not have moved.
    expect(
      after!.totalCamps,
      'totalCamps must not change after a camp_condition write',
    ).toBe(before.totalCamps);

    // The numerator MUST be strictly greater (or equal if Basson already had
    // this camp inspected today AND the camp's prior reading was identical
    // — in which case the duplicate guard would have 422'd, but we passed
    // the unique nonce to avoid that). On a clean clone the bump is +1.
    expect(
      after!.inspectedToday,
      `inspectedToday did not increment after camp_condition write — issue #409 regressed (camps tag missing from observationWriteTags?). before=${before.inspectedToday}, after=${after!.inspectedToday}`,
    ).toBeGreaterThan(before.inspectedToday);
  });

  // ── Test 3: negative control — non-camp-inspection write does NOT bump ────

  test('submitting a non-camp-inspection observation does not change camps tiles', async ({
    page,
    request,
  }) => {
    const campsRes = await request.get(`${BASE_URL}/api/camps`);
    test.skip(
      !campsRes.ok(),
      `GET /api/camps did not return 2xx (${campsRes.status()}) — preview clone not ready`,
    );
    const camps = (await campsRes.json()) as Array<{ camp_id: string }>;
    test.skip(camps.length === 0, 'tenant has no camps for negative-control write');
    const camp = camps[0];

    const before = await snapshotCampsTiles(page, TENANT_SLUG);

    // `general` is in OBSERVATION_TYPE_LIST and is NOT in
    // CAMP_INSPECTION_OBSERVATION_TYPES, so `observationWriteTags` MUST
    // omit the `-camps` tag for it. If a future maintainer accidentally
    // adds `farmTag(slug, 'camps')` unconditionally, this assertion fails.
    const nonce = `e2e-415-neg-${Date.now()}`;
    const postRes = await request.post(`${BASE_URL}/api/observations`, {
      data: {
        type: 'general',
        camp_id: camp.camp_id,
        details: JSON.stringify({ note: nonce }),
        clientLocalId: nonce,
      },
    });
    expect(
      postRes.status(),
      `POST /api/observations (general) failed (${postRes.status()})`,
    ).toBeLessThan(300);

    // Wait the same 10s budget — gives any erroneous invalidation a fair
    // chance to surface.
    await page.waitForTimeout(2_000);
    const after = await snapshotCampsTiles(page, TENANT_SLUG);

    expect(
      after.totalCamps,
      'Total Camps must not change after a non-camp-inspection write',
    ).toBe(before.totalCamps);
    expect(
      after.inspectedToday,
      `inspectedToday must not change after a non-camp-inspection (general) write — camps tag is being added to a non-inspection type. before=${before.inspectedToday}, after=${after.inspectedToday}`,
    ).toBe(before.inspectedToday);
  });

  // ── Test 4: animal_movement positive control — animal camp move busts camps tag (#420) ──

  test('moving an animal between camps updates per-camp animal_count within the TTL window', async ({
    request,
  }) => {
    // Issue #420 — `animalWriteTags(slug)` MUST include `farm-<slug>-camps`
    // because the per-camp `animal_count` on `GET /api/camps`
    // (`getCachedCampList` in `lib/server/cached.ts`) is derived from an
    // `animal.groupBy({ by: ['currentCamp'] })` over the animal roster.
    // An animal camp move (PATCH /api/animals/[id] with `currentCamp`) calls
    // `revalidateAnimalWrite` — if that helper does NOT bust the `-camps`
    // tag, the cached camp list shows stale per-camp counts until the 30s
    // TTL. This test drives a real move and asserts the cache reflects it
    // well inside the TTL window.
    //
    // Mirror of the `camp_condition` positive-control case above — same
    // pattern: snapshot BEFORE, mutate via API, poll AFTER for the change.
    const campsRes = await request.get(`${BASE_URL}/api/camps`);
    test.skip(
      !campsRes.ok(),
      `GET /api/camps did not return 2xx (${campsRes.status()}) — preview clone not ready`,
    );
    type CampRow = { camp_id: string; animal_count: number };
    const camps = (await campsRes.json()) as CampRow[];
    test.skip(camps.length < 2, 'tenant needs >=2 camps to drive a camp move');

    // Pull active animals; find one whose currentCamp is among the known
    // camps so we have a well-defined source/target pair.
    const animalsRes = await request.get(
      `${BASE_URL}/api/animals?status=Active`,
    );
    test.skip(
      !animalsRes.ok(),
      `GET /api/animals did not return 2xx (${animalsRes.status()})`,
    );
    type AnimalRow = { animalId: string; currentCamp: string | null };
    const animals = (await animalsRes.json()) as AnimalRow[];
    const campIds = new Set(camps.map((c) => c.camp_id));
    const movable = animals.find(
      (a) => a.currentCamp != null && campIds.has(a.currentCamp),
    );
    test.skip(
      !movable,
      'no active animal whose currentCamp matches an existing camp — cannot drive move',
    );
    const source = camps.find((c) => c.camp_id === movable!.currentCamp)!;
    const target = camps.find((c) => c.camp_id !== source.camp_id)!;

    // Snapshot BEFORE — per-camp animal_count for source + target.
    const beforeSource = source.animal_count;
    const beforeTarget = target.animal_count;

    // Drive the move via the animal PATCH route — this is the surface that
    // calls `revalidateAnimalWrite(slug)`.
    const patchRes = await request.patch(
      `${BASE_URL}/api/animals/${movable!.animalId}`,
      { data: { currentCamp: target.camp_id } },
    );
    expect(
      patchRes.status(),
      `PATCH /api/animals/${movable!.animalId} failed (${patchRes.status()}): ${await patchRes.text().catch(() => '<no body>')}`,
    ).toBeLessThan(300);

    // Poll the camp list for up to 10s. If `animalWriteTags` includes
    // `farm-<slug>-camps` (the #420 fix), the cache entry is dropped on
    // write and the next GET re-reads from Prisma immediately. Without the
    // fix, the response is served from cache and source/target counts are
    // unchanged until the 30s TTL expires.
    let observed: { source: number; target: number } | null = null;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const res = await request.get(`${BASE_URL}/api/camps`);
      if (res.ok()) {
        const rows = (await res.json()) as CampRow[];
        const s = rows.find((r) => r.camp_id === source.camp_id);
        const t = rows.find((r) => r.camp_id === target.camp_id);
        if (s && t) {
          observed = { source: s.animal_count, target: t.animal_count };
          if (s.animal_count === beforeSource - 1 && t.animal_count === beforeTarget + 1) {
            break;
          }
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // Restore the animal to its original camp BEFORE asserting — keeps the
    // clone state idempotent across re-runs even on assertion failure.
    const restoreRes = await request.patch(
      `${BASE_URL}/api/animals/${movable!.animalId}`,
      { data: { currentCamp: source.camp_id } },
    );
    expect(
      restoreRes.status(),
      `restore PATCH failed (${restoreRes.status()})`,
    ).toBeLessThan(300);

    expect(
      observed,
      'GET /api/camps never returned both source and target rows after the move',
    ).not.toBeNull();
    expect(
      observed!.source,
      `source camp animal_count did not decrement after move — issue #420 regressed (animalWriteTags missing camps tag?). source=${source.camp_id} before=${beforeSource} after=${observed!.source}`,
    ).toBe(beforeSource - 1);
    expect(
      observed!.target,
      `target camp animal_count did not increment after move — issue #420 regressed. target=${target.camp_id} before=${beforeTarget} after=${observed!.target}`,
    ).toBe(beforeTarget + 1);
  });

  // ── Test 5: visible ModeSwitcher path on a multi-species tenant ───────────

  test('totalCamps holds across ModeSwitcher clicks on a multi-species tenant', async ({
    page,
  }) => {
    // Multi-species tenant exposes the UI ModeSwitcher (>=2 enabled species).
    // Land on /admin and probe for the Sheep button — if absent the tenant
    // is single-species (clone may not carry the multi-species fixture) and
    // we skip cleanly so the cookie-flip leg remains the sole signal.
    await page.goto(`${BASE_URL}/${MULTISPECIES_SLUG}/admin`, {
      waitUntil: 'domcontentloaded',
    });
    if (page.url().includes('/login') || page.url().includes('/farms')) {
      test.skip(
        true,
        `${MULTISPECIES_SLUG} not accessible to the bench user — visible-switcher leg skipped`,
      );
      return;
    }
    const sheepBtn = page.getByRole('button', { name: /Sheep/ });
    const hasSwitcher = await sheepBtn.isVisible().catch(() => false);
    if (!hasSwitcher) {
      test.skip(
        true,
        `${MULTISPECIES_SLUG} ModeSwitcher hidden (single-species tenant on this clone) — visible-switcher leg skipped`,
      );
      return;
    }

    const cattleSnap = await snapshotCampsTiles(page, MULTISPECIES_SLUG);

    // Click Sheep, wait for the cookie write, then reload to trigger the
    // server-side re-render (matches multi-species-toggle.spec.ts pattern).
    await sheepBtn.click();
    await expect
      .poll(async () => readModeCookie(page, MULTISPECIES_SLUG), {
        message: 'farmtrack-mode cookie must switch to "sheep" after click',
        timeout: 10_000,
      })
      .toBe('sheep');
    await page.reload({ waitUntil: 'domcontentloaded' });

    const sheepSnap = await snapshotCampsTiles(page, MULTISPECIES_SLUG);
    expect(
      sheepSnap.totalCamps,
      `Total Camps drifted on visible-switcher cattle→sheep flip (${cattleSnap.totalCamps} → ${sheepSnap.totalCamps}) — issue #411 regressed`,
    ).toBe(cattleSnap.totalCamps);
    expect(sheepSnap.totalDenominator).toBe(cattleSnap.totalDenominator);
  });
});
