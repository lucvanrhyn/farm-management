/**
 * GET /api/_internal/synthetic-probe?farmSlug=<slug>
 *
 * PRD #128 gap #4 (issue #135) — the runtime counterpart of the
 * `count-reconciliation` integration test. The PRD #128 incident
 * (2026-05-06) had the home screen reporting `874 animals / 19 camps` while
 * the admin overview reported `0 / 0` for the same tenant in the same
 * session; nothing in CI or at runtime compared the two count sources.
 *
 * This probe is a READ-ONLY health check. It opens an arbitrary tenant's DB
 * via the *real* dashboard read path (`getCachedFarmSummary` for the
 * farm-level source-of-truth animal count + `getCachedCampList` for the
 * per-camp `animal_count` rows) and runs the SHARED divergence rule
 * (`reconcileFromArrays` from `lib/reconcile/counts.ts`). It does NOT
 * re-derive the arithmetic — the same module the unit test pins is the one
 * the probe calls, so the rule can never silently drift between the two.
 *
 * Auth — PLATFORM-ADMIN only
 * ──────────────────────────
 * NOT mere farm-admin. The endpoint reads across tenant boundaries by
 * `farmSlug` (a cross-tenant operation), so it gates on
 * `isPlatformAdmin(email)` and fails CLOSED: any error in the admin check
 * is treated as "not an admin" → 403, never as an open door.
 *
 * Status contract
 * ───────────────
 *   - no session                     → 401 { code: AUTH_REQUIRED, ... }
 *   - authenticated, not admin        → 403 { code: FORBIDDEN, ... }
 *   - missing farmSlug                → 400 { code: VALIDATION_FAILED, ... }
 *   - unknown tenant slug             → 404 { code: TENANT_NOT_FOUND, ... }
 *   - reconciled (incl. divergent!)   → 200 { status: "ok", reconciliation }
 *   - tenant DB unreachable / throw   → 500 { code: PROBE_FAILED, ... }
 *
 * Divergence (`reconciliation.ok === false`) is DATA, not an HTTP error:
 * the probe's job is to *report* drift, so a divergent tenant still returns
 * 200 with `ok:false` and a human-readable `divergenceDetail`. Only an
 * actual failure to read the tenant (DB down, token expired) is a 5xx.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { isPlatformAdmin, getFarmBySlug } from "@/lib/meta-db";
import { getCachedFarmSummary, getCachedCampList } from "@/lib/server/cached";
import { reconcileFromArrays } from "@/lib/reconcile/counts";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Mint the spec's failure envelope: `{ code, message, timestamp }`. */
function probeError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(
    { code, message, timestamp: new Date().toISOString() },
    { status },
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── 1. Auth: platform-admin only (fail-closed) ───────────────────────────
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return probeError("AUTH_REQUIRED", "Authentication required.", 401);
  }

  let admin = false;
  try {
    admin = await isPlatformAdmin(email);
  } catch (err) {
    // Fail closed: a meta-DB hiccup during the admin check must never be
    // read as "allowed". Treat it as a denied request, not a 500.
    logger.warn("[synthetic-probe] platform-admin check failed; denying", {
      error: err instanceof Error ? err.message : String(err),
    });
    admin = false;
  }
  if (!admin) {
    return probeError(
      "FORBIDDEN",
      "Platform-admin privileges are required for the synthetic probe.",
      403,
    );
  }

  // ── 2. Resolve tenant by slug ────────────────────────────────────────────
  const farmSlug = new URL(req.url).searchParams.get("farmSlug")?.trim();
  if (!farmSlug) {
    return probeError("VALIDATION_FAILED", "farmSlug query parameter is required.", 400);
  }

  const farm = await getFarmBySlug(farmSlug);
  if (!farm) {
    return probeError("TENANT_NOT_FOUND", `No tenant found for slug "${farmSlug}".`, 404);
  }

  // ── 3. Read the live tenant via the real dashboard read path + reconcile ──
  try {
    const [summary, camps] = await Promise.all([
      getCachedFarmSummary(farmSlug),
      getCachedCampList(farmSlug),
    ]);

    // `reconcileFromArrays` only reads `animals.length` for the farm-level
    // source-of-truth count, so synthesize a length-only array from the
    // dashboard's animal count (matching the count-reconciliation test's
    // own `new Array(n).fill(...)` shape). The per-camp `animal_count`
    // fields are read verbatim. We do NOT re-derive the divergence math.
    const animalsByLength: ReadonlyArray<null> = new Array(summary.animalCount).fill(null);
    const report = reconcileFromArrays(animalsByLength, camps);

    const reconciliation = {
      ...report,
      ...(report.divergence !== 0
        ? {
            divergenceDetail:
              `Count divergence of ${report.divergence} ` +
              `(farm source-of-truth = ${report.farmCount}, ` +
              `sum of per-camp animal_count = ${report.summedCount}) ` +
              `across ${report.campCount} camp(s).`,
          }
        : {}),
    };

    return NextResponse.json(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
        tenant: { farmSlug, farmName: summary.farmName },
        reconciliation,
      },
      { status: 200 },
    );
  } catch (err) {
    // A genuine read failure (tenant DB unreachable, token expired, etc.).
    // This is a real 5xx — distinct from a *reconciled-but-divergent* result.
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[synthetic-probe] tenant read failed", { farmSlug, error: message });
    return probeError("PROBE_FAILED", `Probe failed for tenant "${farmSlug}": ${message}`, 500);
  }
}
