// lib/server/app-url.ts
//
// Single source of truth for the public app base URL used in user-facing
// links minted on the server: transactional emails (verification, alert
// digest) and PayFast return / cancel / notify URLs on the subscribe pages.
//
// Issue #528 (code half of gate #118, PRD #521 Workstream H).
//
// Why this exists
// ───────────────
// Three call sites used to hardcode the DEAD preview host
// `https://farm-management-lilac.vercel.app` as their `NEXTAUTH_URL ?? …`
// fallback. The app cut over to `https://app.farmtrack.app` on 2026-05-30
// (NEXTAUTH_URL flipped in prod + DNS/auth live), so that literal is now the
// WRONG default — any email or PayFast URL that fell back to it would point a
// farmer at a dead host. Centralising the resolution here means there is one
// place to change the default and one literal for the CI grep-guard
// (scripts/audit-preview-hostname.ts) to protect.
//
// Env var choice: we deliberately read the EXISTING `NEXTAUTH_URL` rather than
// introducing a new `NEXT_PUBLIC_APP_URL`-style variable. NEXTAUTH_URL is
// already the canonical app-URL env var in this repo and is set to
// `https://app.farmtrack.app` in prod; a new var would require a Vercel infra
// change (out of scope for this code-only slice).

/**
 * The live production app host. This is the safe post-cutover default — used
 * when `NEXTAUTH_URL` is unset (e.g. a local script or a misconfigured
 * environment). It must NEVER be the dead lilac preview host.
 */
const DEFAULT_APP_BASE_URL = "https://app.farmtrack.app";

/**
 * Resolve the public base URL for server-minted user-facing links.
 *
 * Returns `NEXTAUTH_URL` verbatim when set, otherwise the live prod host.
 * The value is intentionally NOT normalised (no trailing-slash strip): each
 * call site applies whatever transform it needs (the subscribe pages strip a
 * trailing slash before concatenating PayFast paths; the email helper does
 * not). Keeping this reader unopinionated stops it from silently reshaping a
 * caller's configured URL.
 */
export function getAppBaseUrl(): string {
  return process.env.NEXTAUTH_URL ?? DEFAULT_APP_BASE_URL;
}
