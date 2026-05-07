import type { ResolvedRoute } from './critical-routes';

/**
 * Authenticated GET-only smoke driver for the post-promote step + scheduled
 * synthetic monitor.
 *
 * Established 2026-05-06 after the Phase A "8 admin routes crashed on prod"
 * incident (PRD #128). The previous Playwright "smoke" only hit `/login` and
 * `/` unauthenticated, so it could never observe an admin page returning 500.
 *
 * Pure HTTP — no Playwright dependency in this module. Playwright lives only
 * in the e2e spec that invokes `runProdSmoke` after authenticating in a
 * browser context. The post-promote CLI invokes it directly via `fetch`
 * after a programmatic credentials sign-in. Two callers, one source of truth.
 */

export interface RouteResult {
  url: string;
  label: string;
  status: number;
  /** `true` iff the response body contains the global error-boundary marker. */
  errorBoundaryDetected: boolean;
  /** `true` iff the response body contains the React 19 "Application error" generic crash text. */
  reactErrorDetected: boolean;
  /** Network/timeout/HTTP-level error message if the request itself failed. */
  fetchError?: string;
  /** Wall-clock duration of this request in ms. */
  durationMs: number;
}

export interface SmokeReport {
  baseUrl: string;
  results: RouteResult[];
  /** True iff every route returned 2xx/3xx and no error-boundary or React-error markers. */
  ok: boolean;
  /** Total wall-clock for the whole sweep. */
  totalDurationMs: number;
}

export interface RunProdSmokeOpts {
  baseUrl: string;
  routes: readonly ResolvedRoute[];
  /**
   * Pre-authenticated cookie header — typically captured from a programmatic
   * `next-auth` credentials sign-in. The smoke driver does NOT log in; that
   * is the caller's responsibility.
   */
  cookie: string;
  /** Per-request timeout in ms. Defaults to 15_000 — generous for cold starts. */
  timeoutMs?: number;
  /**
   * Optional fetch implementation injected for tests. Defaults to global
   * `fetch`. Must match the standard `fetch` signature.
   */
  fetchImpl?: typeof fetch;
  /** Optional clock injected for tests; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Substring markers that, if found in the response body, mean the route
 * rendered the global error boundary instead of its real content.
 *
 * "Something went wrong" — the visible copy in `app/error.tsx`.
 * "data-error-boundary" — the data-attribute we added in PRD #128 so the
 *   marker survives whitespace minification + content changes.
 */
const ERROR_BOUNDARY_MARKERS = [
  'Something went wrong',
  'data-error-boundary',
  'data-testid="error-boundary"',
];

/**
 * Markers for React 19's generic crash UI shown when a render throws and no
 * error boundary catches it (e.g. a server component throws before the
 * boundary mounts).
 */
const REACT_ERROR_MARKERS = ['Application error', 'a server-side exception has occurred'];

function detectMarkers(body: string, markers: readonly string[]): boolean {
  for (const m of markers) if (body.includes(m)) return true;
  return false;
}

async function smokeOne(
  baseUrl: string,
  route: ResolvedRoute,
  cookie: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  now: () => number,
): Promise<RouteResult> {
  const start = now();
  const url = new URL(route.url, baseUrl).toString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        cookie,
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'farmtrack-prod-smoke/1.0 (+PRD-128)',
      },
      redirect: 'manual',
      signal: ctrl.signal,
    });
    const body = res.status >= 200 && res.status < 400 ? await res.text() : '';
    return {
      url: route.url,
      label: route.label,
      status: res.status,
      errorBoundaryDetected: detectMarkers(body, ERROR_BOUNDARY_MARKERS),
      reactErrorDetected: detectMarkers(body, REACT_ERROR_MARKERS),
      durationMs: now() - start,
    };
  } catch (err) {
    return {
      url: route.url,
      label: route.label,
      status: 0,
      errorBoundaryDetected: false,
      reactErrorDetected: false,
      fetchError: err instanceof Error ? err.message : String(err),
      durationMs: now() - start,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the smoke sweep. Executes routes sequentially — concurrency would
 * make ordering noisy in CI logs and the total budget (~12 routes × 1s) is
 * already small.
 */
export async function runProdSmoke(opts: RunProdSmokeOpts): Promise<SmokeReport> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Date.now());
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const sweepStart = now();
  const results: RouteResult[] = [];
  for (const route of opts.routes) {
    results.push(await smokeOne(opts.baseUrl, route, opts.cookie, timeoutMs, fetchImpl, now));
  }
  const ok = results.every(
    (r) =>
      !r.fetchError &&
      r.status >= 200 &&
      r.status < 400 &&
      !r.errorBoundaryDetected &&
      !r.reactErrorDetected,
  );
  return { baseUrl: opts.baseUrl, results, ok, totalDurationMs: now() - sweepStart };
}

/**
 * Format a smoke report for a PR comment / GH summary / Slack post. One
 * line per route plus a header summary.
 */
export function formatSmokeReport(report: SmokeReport): string {
  const lines: string[] = [];
  lines.push(report.ok ? `## ✅ Prod smoke: ${report.baseUrl}` : `## ❌ Prod smoke: ${report.baseUrl}`);
  lines.push('');
  for (const r of report.results) {
    const icon =
      r.fetchError || r.errorBoundaryDetected || r.reactErrorDetected || r.status >= 400
        ? '❌'
        : '✅';
    const detail = r.fetchError
      ? `network error: ${r.fetchError}`
      : r.errorBoundaryDetected
        ? 'error boundary rendered'
        : r.reactErrorDetected
          ? 'React generic crash UI rendered'
          : `HTTP ${r.status}`;
    lines.push(`- ${icon} \`${r.url}\` — ${r.label} — ${detail} (${r.durationMs}ms)`);
  }
  lines.push('');
  lines.push(`Total: ${report.totalDurationMs}ms across ${report.results.length} routes.`);
  return lines.join('\n');
}
