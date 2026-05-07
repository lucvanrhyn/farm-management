/**
 * Single source of truth for the routes the post-promote smoke + scheduled
 * synthetic monitor + authenticated CI journey must verify return 200.
 *
 * Established 2026-05-06 after the Phase A "8 admin routes crashed on prod"
 * incident (PRD #128) — every gate that exercises authenticated routes
 * imports from here so the route list cannot drift between CI and prod.
 *
 * Add a route here when:
 *  - it loads server data that depends on a recent migration, OR
 *  - it is part of the demo-critical happy path, OR
 *  - it has crashed in prod within the last 30 days.
 *
 * Remove a route here only when the route has been deleted from the app.
 */

export interface CriticalRoute {
  /** URL path relative to `/[farmSlug]`, including a leading slash. */
  path: string;
  /** Human-readable label for CI logs. */
  label: string;
  /** Optional `[campId]` style param to substitute. Smoke driver picks the first camp it finds. */
  needsCampId?: boolean;
  /** Whether the route is gated by the `admin` role (vs logger/viewer). */
  adminOnly: boolean;
}

/**
 * The authoritative list. Order is the click-through order used by the
 * authenticated journey spec — Home → Admin Overview → admin pages → tools
 * → dashboard. The first element is always `/` (Home) so a smoke run that
 * trips on auth alone fails on a route the user actually visits first.
 */
export const CRITICAL_ROUTES: readonly CriticalRoute[] = Object.freeze([
  { path: '/', label: 'Home', adminOnly: false },
  { path: '/admin', label: 'Admin Overview', adminOnly: true },
  { path: '/admin/animals', label: 'Animals list', adminOnly: true },
  { path: '/admin/mobs', label: 'Mobs list', adminOnly: true },
  { path: '/admin/camps', label: 'Camps list', adminOnly: true },
  { path: '/admin/camps/[campId]', label: 'Camp detail', adminOnly: true, needsCampId: true },
  { path: '/admin/tasks', label: 'Tasks', adminOnly: true },
  { path: '/admin/finansies', label: 'Finansies', adminOnly: true },
  { path: '/admin/observations', label: 'Observations', adminOnly: true },
  { path: '/tools/rotation-planner', label: 'Rotation planner', adminOnly: true },
  { path: '/dashboard', label: 'Dashboard / Map', adminOnly: false },
]);

export interface ResolveOpts {
  /** Tenant slug to substitute, e.g. `delta-livestock`. */
  farmSlug: string;
  /** First-camp campId to substitute for `[campId]` routes. Required when any route has `needsCampId`. */
  firstCampId?: string;
  /** Whether to include admin-only routes. Default `true`. */
  includeAdminOnly?: boolean;
}

export interface ResolvedRoute {
  url: string;
  label: string;
}

/**
 * Materialise the route list against a concrete tenant and (optionally) the
 * first camp's id. Throws if a `needsCampId` route is in scope but no campId
 * was supplied — better to fail the smoke loudly than to silently 404.
 */
export function resolveCriticalRoutes(opts: ResolveOpts): ResolvedRoute[] {
  const { farmSlug, firstCampId, includeAdminOnly = true } = opts;
  if (!farmSlug || /[^a-z0-9-]/i.test(farmSlug)) {
    throw new Error(`resolveCriticalRoutes: invalid farmSlug "${farmSlug}"`);
  }
  const out: ResolvedRoute[] = [];
  for (const route of CRITICAL_ROUTES) {
    if (route.adminOnly && !includeAdminOnly) continue;
    let path = route.path;
    if (route.needsCampId) {
      if (!firstCampId) {
        throw new Error(
          `resolveCriticalRoutes: route "${route.path}" needs a campId but none was provided`,
        );
      }
      path = path.replace('[campId]', encodeURIComponent(firstCampId));
    }
    out.push({ url: `/${farmSlug}${path}`, label: route.label });
  }
  return out;
}
