/**
 * Lighthouse CI config for the cold-perf observability gate.
 *
 * Runs against a production `next start` server on port 3001. Five URLs
 * cover the critical first-visit surface:
 *   - /login                                  (public)
 *   - /delta-livestock/home                   (first authed screen)
 *   - /delta-livestock/dashboard              (heavy SSR)
 *   - /delta-livestock/logger                 (logger fan-out)
 *   - /delta-livestock/admin/animals          (SSR collection page)
 *
 * Authentication: set `LHCI_EXTRA_HEADERS` to a JSON object containing
 * a `Cookie` header produced by `next-auth`'s `next-auth.session-token`
 * flow for the bench user (`e2e-bench@farmtrack.app`, password in the
 * `BENCH_PASSWORD` GitHub secret). The wrapper workflow generates the
 * cookie at run time from the bench credentials so no long-lived token
 * lives in config. See `.github/workflows/lhci.yml`.
 *
 * Budgets enforce the cold-perf floor. Anything worse fails the PR
 * — that contract is what stops the "slow again in 2 weeks" regression
 * loop flagged in tasks/perf-root-cause-2026-04-23.md.
 *
 * `.js` (not `.json`) so we can compose the URL list + headers from env.
 */

/** @type {import('@lhci/cli').Config} */
module.exports = {
  ci: {
    collect: {
      url: [
        "http://localhost:3001/login",
        "http://localhost:3001/delta-livestock/home",
        "http://localhost:3001/delta-livestock/dashboard",
        "http://localhost:3001/delta-livestock/logger",
        "http://localhost:3001/delta-livestock/admin/animals",
      ],
      numberOfRuns: 3,
      startServerCommand: "pnpm start -p 3001",
      startServerReadyPattern: "Ready",
      startServerReadyTimeout: 120_000,
      settings: {
        preset: "desktop",
        onlyCategories: ["performance"],
        skipAudits: ["uses-http2"],
        // Clear Serwist + HTTP cache between runs so we always measure a
        // cold experience. The "warm" path was what masked the
        // regression last time. Root cause #8 in tasks/perf-root-cause.
        disableStorageReset: false,
        extraHeaders: process.env.LHCI_EXTRA_HEADERS
          ? JSON.parse(process.env.LHCI_EXTRA_HEADERS)
          : undefined,
      },
    },
    assert: {
      preset: "lighthouse:no-pwa",
      assertions: {
        // Core web vitals budgets, cold. "error" means this fails the PR;
        // we can soften to "warn" per metric if the baseline run shows a
        // particular URL genuinely can't meet the goal yet.
        "first-contentful-paint": ["error", { maxNumericValue: 2000 }],
        "largest-contentful-paint": ["error", { maxNumericValue: 3000 }],
        interactive: ["error", { maxNumericValue: 4000 }],
        "cumulative-layout-shift": ["warn", { maxNumericValue: 0.1 }],
        "total-blocking-time": ["warn", { maxNumericValue: 300 }],
        "server-response-time": ["warn", { maxNumericValue: 800 }],

        // JS-transfer budget. 307_200 bytes ≈ 300 KB brotli — the plan
        // target for /login. Applies globally here; the /login total is
        // enforced more strictly by scripts/audit-bundle.ts in P5.
        "resource-summary:script:size": ["warn", { maxNumericValue: 307_200 }],

        // Quality signals — downgrade to warn so they surface in the
        // run report without blocking the PR. Flipping these to "error"
        // is a later-phase tightening exercise.
        "unused-javascript": ["warn", { maxNumericValue: 81_920 }],
        "uses-text-compression": "warn",
        "modern-image-formats": "warn",
        "render-blocking-resources": "warn",
      },
    },
    upload: {
      target: "temporary-public-storage",
    },
  },
};
