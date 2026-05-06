import { describe, it, expect } from 'vitest';
import { runProdSmoke, formatSmokeReport } from '@/lib/ops/prod-smoke';

const COOKIE = 'next-auth.session-token=fake; csrf=fake';

function makeFetch(
  bodyByPath: Record<string, { status: number; body?: string }>,
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof URL ? input.toString() : String(input));
    const path = url.pathname;
    const entry = bodyByPath[path] ?? { status: 404, body: 'not found' };
    return new Response(entry.body ?? '', { status: entry.status });
  }) as unknown as typeof fetch;
}

describe('runProdSmoke', () => {
  it('returns ok=true when every route is 200 and clean', async () => {
    const fetchImpl = makeFetch({
      '/t/admin/animals': { status: 200, body: '<html>ok</html>' },
      '/t/admin/camps': { status: 200, body: '<html>ok</html>' },
    });
    const report = await runProdSmoke({
      baseUrl: 'http://localhost',
      cookie: COOKIE,
      fetchImpl,
      routes: [
        { url: '/t/admin/animals', label: 'Animals' },
        { url: '/t/admin/camps', label: 'Camps' },
      ],
    });
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.status === 200)).toBe(true);
  });

  it('detects the PRD #128 scenario: a 200 response that contains the error boundary marker', async () => {
    const fetchImpl = makeFetch({
      '/t/admin/animals': {
        status: 200,
        body: '<html><div data-error-boundary>Something went wrong</div></html>',
      },
    });
    const report = await runProdSmoke({
      baseUrl: 'http://localhost',
      cookie: COOKIE,
      fetchImpl,
      routes: [{ url: '/t/admin/animals', label: 'Animals' }],
    });
    expect(report.ok).toBe(false);
    expect(report.results[0].errorBoundaryDetected).toBe(true);
  });

  it('detects the React 19 generic crash UI', async () => {
    const fetchImpl = makeFetch({
      '/t/admin/camps': {
        status: 200,
        body: '<html>Application error: a server-side exception has occurred</html>',
      },
    });
    const report = await runProdSmoke({
      baseUrl: 'http://localhost',
      cookie: COOKIE,
      fetchImpl,
      routes: [{ url: '/t/admin/camps', label: 'Camps' }],
    });
    expect(report.ok).toBe(false);
    expect(report.results[0].reactErrorDetected).toBe(true);
  });

  it('records HTTP 500 as a failure', async () => {
    const fetchImpl = makeFetch({
      '/t/admin/tasks': { status: 500, body: '' },
    });
    const report = await runProdSmoke({
      baseUrl: 'http://localhost',
      cookie: COOKIE,
      fetchImpl,
      routes: [{ url: '/t/admin/tasks', label: 'Tasks' }],
    });
    expect(report.ok).toBe(false);
    expect(report.results[0].status).toBe(500);
  });

  it('captures fetch errors (network / timeout) without aborting the sweep', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/a')) throw new Error('network down');
      return new Response('<html>ok</html>', { status: 200 });
    }) as unknown as typeof fetch;
    const report = await runProdSmoke({
      baseUrl: 'http://localhost',
      cookie: COOKIE,
      fetchImpl,
      routes: [
        { url: '/a', label: 'A' },
        { url: '/b', label: 'B' },
      ],
    });
    expect(report.ok).toBe(false);
    expect(report.results[0].fetchError).toMatch(/network down/);
    expect(report.results[1].status).toBe(200);
  });

  it('formatSmokeReport produces a green header on a clean sweep', () => {
    const out = formatSmokeReport({
      baseUrl: 'http://x',
      ok: true,
      totalDurationMs: 100,
      results: [
        {
          url: '/a',
          label: 'A',
          status: 200,
          errorBoundaryDetected: false,
          reactErrorDetected: false,
          durationMs: 50,
        },
      ],
    });
    expect(out).toMatch(/✅ Prod smoke/);
  });

  it('formatSmokeReport produces a red header on any failure', () => {
    const out = formatSmokeReport({
      baseUrl: 'http://x',
      ok: false,
      totalDurationMs: 100,
      results: [
        {
          url: '/a',
          label: 'A',
          status: 200,
          errorBoundaryDetected: true,
          reactErrorDetected: false,
          durationMs: 50,
        },
      ],
    });
    expect(out).toMatch(/❌ Prod smoke/);
    expect(out).toMatch(/error boundary rendered/);
  });
});
