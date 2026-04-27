/**
 * Security headers + Content-Security-Policy for FarmTrack.
 *
 * Why this file exists
 * ────────────────────
 * P3 from the 2026-04-27 stress-test of farm-management-lilac.vercel.app:
 * the deploy was missing the standard defense-in-depth response header set
 * (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
 * Permissions-Policy, CSP). None of these stop an active vuln on their own,
 * but together they shrink the blast radius of a future XSS / clickjacking /
 * mixed-content / referrer-leak bug.
 *
 * Both `buildCsp()` and `buildSecurityHeaders()` are pure (string in / array
 * out, no I/O) so they can be unit-tested without booting Next.
 *
 * CSP soak (TODO 2026-05-11)
 * ──────────────────────────
 * The CSP is shipped as `Content-Security-Policy-Report-Only` for the first
 * two weeks. After 2026-05-11 — once we've watched browser violation reports
 * and fixed any false positives — flip the header name to
 * `Content-Security-Policy` to enforce. Do NOT enforce sooner.
 */

/**
 * Source allowlists for the CSP. One spot to read when adding a new
 * third-party domain — the test in `__tests__/security/headers.test.ts`
 * locks the expected set so a sloppy "just add 'unsafe-inline'" change
 * shows up in review.
 *
 * Domain rationale
 * ────────────────
 *  • Mapbox  — `api.mapbox.com`, `events.mapbox.com`, `*.tiles.mapbox.com`
 *              browser-side tile + telemetry traffic from `mapbox-gl`.
 *  • Google Fonts — `fonts.googleapis.com` (CSS) + `fonts.gstatic.com`
 *              (woff2). Loaded by `next/font/google` in app/layout.tsx.
 *  • Vercel Blob — `*.public.blob.vercel-storage.com` for uploaded
 *              observation photos served back to <img>.
 *  • data: / blob: in img-src — local IndexedDB photo previews + canvas
 *              compression output rendered before upload.
 *
 * Server-only domains (OpenAI, Anthropic, Resend, Inngest, PayFast HTTP
 * API, Turso libSQL) intentionally do NOT appear here — they never run
 * fetch from the browser.
 */
export const CSP_SOURCES = {
  mapbox: [
    "https://api.mapbox.com",
    "https://events.mapbox.com",
    "https://*.tiles.mapbox.com",
  ],
  googleFonts: {
    style: ["https://fonts.googleapis.com"],
    font: ["https://fonts.gstatic.com"],
  },
  vercelBlob: ["https://*.public.blob.vercel-storage.com"],
} as const;

/**
 * Build the CSP directive string.
 *
 * Notes
 * ─────
 *  • script-src includes `'unsafe-inline'` and `'unsafe-eval'` because
 *    Next.js 16's webpack runtime emits a small inline bootstrap and the
 *    React DevTools / hydration shim use new Function(). A nonce-based
 *    approach is the long-term fix — captured in TODO below.
 *  • style-src includes `'unsafe-inline'` because Tailwind + next/font
 *    inject inline <style> tags and a CSS-in-JS swap is out of scope.
 *  • connect-src includes mapbox endpoints for tile + telemetry XHRs and
 *    `'self'` for our own /api/** routes. Vercel Blob is image-only — no
 *    fetch traffic — so it stays out of connect-src.
 *  • img-src adds `data:` and `blob:` for in-app photo previews
 *    (compression pipeline → canvas → blob URL → <img>).
 *  • frame-ancestors 'none' is the actual clickjacking control. The
 *    X-Frame-Options header is kept as a belt-and-braces fallback for
 *    pre-2018 IE / legacy crawlers that don't implement CSP3.
 *
 * TODO(2026-05-11): once the report-only soak is clean, switch the
 * caller in next.config.ts from 'Content-Security-Policy-Report-Only' to
 * 'Content-Security-Policy' (enforcement). Do NOT remove the unsafe-inline
 * tokens at the same time — that's a separate, larger refactor (move to
 * nonces / hashes, audit every Tailwind + next/font emission point).
 */
export function buildCsp(): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      // See note above — Next.js bootstrap + hydration require these
      // until we move to nonces.
      "'unsafe-inline'",
      "'unsafe-eval'",
    ],
    "style-src": [
      "'self'",
      "'unsafe-inline'",
      ...CSP_SOURCES.googleFonts.style,
    ],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      ...CSP_SOURCES.mapbox,
      ...CSP_SOURCES.vercelBlob,
    ],
    "font-src": ["'self'", "data:", ...CSP_SOURCES.googleFonts.font],
    "connect-src": ["'self'", ...CSP_SOURCES.mapbox],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "frame-ancestors": ["'none'"],
    "form-action": [
      "'self'",
      // PayFast checkout submit lands on payfast.co.za as a top-level
      // form POST. Without this, browsers will refuse the submit.
      "https://www.payfast.co.za",
      "https://sandbox.payfast.co.za",
    ],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "upgrade-insecure-requests": [],
  };

  return Object.entries(directives)
    .map(([key, values]) => (values.length ? `${key} ${values.join(" ")}` : key))
    .join("; ");
}

/**
 * Standard defense-in-depth headers applied to every response.
 * The CSP ships as Report-Only for the 2-week soak (see TODO above).
 */
export function buildSecurityHeaders(): Array<{ key: string; value: string }> {
  return [
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      // camera=self  → Vision Logger photo capture
      // geolocation=self → camp / map geo features
      // microphone=()  → unused, lock down
      value: "camera=(self), microphone=(), geolocation=(self)",
    },
    // TODO(2026-05-11): rename to 'Content-Security-Policy' to enforce
    // after a clean 2-week report-only soak. Owner: security review.
    { key: "Content-Security-Policy-Report-Only", value: buildCsp() },
  ];
}
