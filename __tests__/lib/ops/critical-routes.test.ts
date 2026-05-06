import { describe, it, expect } from 'vitest';
import {
  CRITICAL_ROUTES,
  resolveCriticalRoutes,
} from '@/lib/ops/critical-routes';

describe('CRITICAL_ROUTES', () => {
  it('starts with Home and ends with Dashboard so the click-through order matches a real user', () => {
    expect(CRITICAL_ROUTES[0].path).toBe('/');
    expect(CRITICAL_ROUTES[CRITICAL_ROUTES.length - 1].path).toBe('/dashboard');
  });

  it('contains every route that crashed on prod after Phase A (PRD #128)', () => {
    const paths = CRITICAL_ROUTES.map((r) => r.path);
    for (const required of [
      '/admin/animals',
      '/admin/mobs',
      '/admin/camps',
      '/admin/camps/[campId]',
      '/admin/tasks',
      '/admin/finansies',
      '/tools/rotation-planner',
      '/dashboard',
    ]) {
      expect(paths).toContain(required);
    }
  });

  it('is frozen so a later module cannot mutate the source of truth', () => {
    expect(Object.isFrozen(CRITICAL_ROUTES)).toBe(true);
  });
});

describe('resolveCriticalRoutes', () => {
  it('substitutes the farm slug into every route', () => {
    const resolved = resolveCriticalRoutes({
      farmSlug: 'trio-b-boerdery',
      firstCampId: 'A',
    });
    for (const r of resolved) expect(r.url).toMatch(/^\/trio-b-boerdery/);
  });

  it('substitutes [campId] when provided', () => {
    const resolved = resolveCriticalRoutes({
      farmSlug: 'trio-b-boerdery',
      firstCampId: 'A',
    });
    expect(resolved.some((r) => r.url === '/trio-b-boerdery/admin/camps/A')).toBe(true);
  });

  it('throws when [campId] route is in scope but no campId was provided', () => {
    expect(() => resolveCriticalRoutes({ farmSlug: 'trio-b-boerdery' })).toThrow(
      /needs a campId/,
    );
  });

  it('rejects an invalid farmSlug to prevent path-injection', () => {
    expect(() =>
      resolveCriticalRoutes({ farmSlug: '../etc/passwd', firstCampId: 'A' }),
    ).toThrow(/invalid farmSlug/);
  });

  it('drops admin-only routes when includeAdminOnly is false', () => {
    const resolved = resolveCriticalRoutes({
      farmSlug: 't',
      firstCampId: 'A',
      includeAdminOnly: false,
    });
    for (const r of resolved) {
      expect(r.url).not.toContain('/admin/');
    }
  });

  it('URL-encodes the campId so a slash in the id never escapes the route', () => {
    const resolved = resolveCriticalRoutes({
      farmSlug: 't',
      firstCampId: 'A/../escape',
    });
    const detail = resolved.find((r) => r.url.includes('/camps/'));
    expect(detail?.url).toMatch(/A%2F\.\.%2Fescape/);
  });
});
