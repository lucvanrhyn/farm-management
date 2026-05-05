import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";

// Keep in sync with `lib/server/farm-context.ts`. We intentionally re-implement
// the tiny HMAC helper here rather than importing, because proxy.ts runs on
// the Edge-compatible middleware runtime and must keep its module graph flat
// (no transitive Prisma / auth-options imports).
//
// Phase G (P6.5): the payload binds the JWT `sub` (the user id) so that
// `verifyFreshAdminRole(session.user.id, slug)` calls in migrated handlers
// receive the real user id instead of the empty string.
//
// Wave 1 W1b: the payload also binds `role` and a leading `v2` version byte.
// Role was previously stamped into a sibling header (`x-session-role`) and
// trusted verbatim by handlers — the primitive itself did not enforce role
// authenticity. The version byte forces v1 tokens to fail verification on
// deploy (NEXTAUTH_SECRET MUST be rotated alongside this change).
//
// IMPORTANT: bumping IDENTITY_HMAC_VERSION here requires the same bump in
// `lib/server/farm-context.ts`.
const IDENTITY_HMAC_VERSION = "v2";

function signIdentity(
  userEmail: string,
  slug: string,
  userId: string,
  role: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${IDENTITY_HMAC_VERSION}\n${userEmail}\n${slug}\n${userId}\n${role}`)
    .digest("hex");
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Farm select API must be accessible to authenticated users — checked inside the route handler itself
  if (pathname.startsWith("/api/farms/") && pathname.endsWith("/select")) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token || !Array.isArray(token.farms)) {
    // Phase C bug C2: previously every unauthenticated request was 307'd to
    // /login regardless of whether the path resolved to a real route. SEO
    // crawlers chasing dead external links landed on the login wall and risked
    // indexing it as the canonical destination for a broken URL; legitimate
    // typos got no signal.
    //
    // Now we only redirect for paths that are *actually* gated (farm hub,
    // tenant routes, authenticated APIs). Anything else falls through to the
    // Next runtime, which renders `app/not-found.tsx` for unmatched paths and
    // serves the matched route otherwise. Pages that need auth at render time
    // (e.g. server components calling `getSession`) still redirect on their
    // own, so this is safe by default.
    if (isProtectedPath(pathname)) {
      // Visual audit P1 (2026-05-04): preserve the requested path in
      // `?next=` so the login page can return the user to the deep
      // link they tried to open. The bare `/` is the universal entry
      // point — no `next=` needed (a loop-safety + UX choice; the
      // post-login destination for `/` is already the universal
      // /farms hub).
      const loginUrl = new URL("/login", req.url);
      if (pathname !== "/") {
        loginUrl.searchParams.set("next", pathname + req.nextUrl.search);
      }
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // Enforce tenant isolation: verify user has access to the farm in the URL
  const farmRouteMatch = pathname.match(/^\/([^/]+)\/(admin|dashboard|logger|home|tools|sheep|game)/);
  const farms = token.farms as Array<{ slug: string; tier: string; subscriptionStatus: string; role: string }>;

  if (farmRouteMatch) {
    const farmSlug = farmRouteMatch[1];
    const farm = farms.find((f) => f.slug === farmSlug);

    if (!farm) {
      return NextResponse.redirect(new URL("/farms", req.url));
    }

    // Gate Basic-tier farms that haven't completed payment.
    // Only active when PayFast is configured (prevents lockouts in dev/staging).
    if (
      process.env.PAYFAST_MERCHANT_ID &&
      farm.tier === "basic" &&
      farm.subscriptionStatus !== "active"
    ) {
      return NextResponse.redirect(
        new URL(`/subscribe?farm=${farmSlug}`, req.url),
      );
    }

    // Auto-set the active farm cookie so client-side API calls work even on direct
    // navigation (bookmark, refresh, typed URL). Only update when it differs.
    const currentCookie = req.cookies.get("active_farm_slug")?.value;
    if (currentCookie !== farmSlug) {
      const response = withSessionHeaders(req, token, farm, NextResponse.next);
      response.cookies.set("active_farm_slug", farmSlug, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 7, // 1 week
      });
      return response;
    }
  }

  // Authenticated users hitting / get sent to /farms (universal entry point)
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/farms", req.url));
  }

  return withSessionHeaders(req, token, resolveActiveFarm(req, farms), NextResponse.next);
}

/**
 * Phase C bug C2 — paths that MUST 307 to /login when the visitor is
 * unauthenticated. Anything not in this list (and not already excluded by the
 * matcher at the bottom of this file) falls through to Next, which either
 * renders the matched route or `app/not-found.tsx` for a true 404.
 *
 * Membership rules
 * ────────────────
 * - `/farms` and `/home` — universal authenticated entry points. Direct hits
 *   without a session must land on /login (preserves existing UX).
 * - `/[slug]/(admin|dashboard|logger|home|tools|sheep|game)/...` — every
 *   tenant-scoped surface that previously redirected. The regex below mirrors
 *   the `farmRouteMatch` regex used a few lines down — keeping them in sync
 *   means the protected-path check above and the tenant-isolation check below
 *   agree on what "a tenant page" means.
 * - `/api/...` — every authenticated API route. Specific public endpoints
 *   (`/api/auth/*`, `/api/health`, `/api/einstein/*`, `/api/inngest`,
 *   `/api/observations`, `/api/telemetry`, `/api/webhooks/*`) are already
 *   excluded by the matcher, so they never reach this function in the first
 *   place. Any other `/api/*` path that does reach the proxy IS protected.
 *
 * Exported (named export, not a config field) so the proxy-matcher unit test
 * can assert disposition without booting the Edge runtime.
 */
const TENANT_ROUTE_RE =
  /^\/([^/]+)\/(admin|dashboard|logger|home|tools|sheep|game)(\/|$)/;

export function isProtectedPath(pathname: string): boolean {
  // Root: previously redirected unauth users to /login. Preserve that
  // behaviour — `/` is a known route, not the unknown-route case bug C2 is
  // about. (`app/page.tsx` itself short-circuits to /home for authenticated
  // users; this branch handles the anonymous case.)
  if (pathname === "/") return true;

  // Exact authenticated entry points.
  if (pathname === "/farms" || pathname.startsWith("/farms/")) return true;
  if (pathname === "/home" || pathname.startsWith("/home/")) return true;

  // Authenticated APIs that survive the matcher (i.e. not in the
  // negative-lookahead exclusion list at the bottom of this file).
  if (pathname.startsWith("/api/")) return true;

  // Tenant-scoped pages.
  if (TENANT_ROUTE_RE.test(pathname)) return true;

  return false;
}

/**
 * Resolve the farm the current request acts against:
 *   1. `[farmSlug]/admin/...` URL segment (already matched above)
 *   2. `active_farm_slug` cookie
 * Returns `null` when neither source is present — the signed header is then
 * omitted and handlers fall back to the legacy `getServerSession` path.
 */
function resolveActiveFarm(
  req: NextRequest,
  farms: Array<{ slug: string; tier: string; subscriptionStatus: string; role: string }>,
): { slug: string; role: string } | null {
  const cookieSlug = req.cookies.get("active_farm_slug")?.value;
  if (cookieSlug) {
    const farm = farms.find((f) => f.slug === cookieSlug);
    if (farm) return { slug: farm.slug, role: farm.role };
  }
  return null;
}

/**
 * Build a `NextResponse.next()` that stamps the signed identity triplet
 * onto the downstream request headers. The headers are invisible to the
 * client — they only travel from middleware to the route handler runtime.
 *
 * If any precondition is missing (no email, no active farm, no secret) we
 * skip the stamp and the route falls back to the legacy path. Safe by
 * default.
 */
function withSessionHeaders(
  req: NextRequest,
  token: { email?: string | null; sub?: string },
  farm: { slug: string; role: string } | null,
  factory: (init?: { request?: { headers: Headers } }) => NextResponse,
): NextResponse {
  const secret = process.env.NEXTAUTH_SECRET;
  const email = token.email ?? "";
  const sub = token.sub ?? "";
  // Require `sub` — migrated admin-write handlers need `session.user.id` to
  // call `verifyFreshAdminRole(userId, slug)`. Without a sub, skip the
  // fast-path stamp and let the handler take the legacy getServerSession
  // path which does populate `session.user.id`.
  if (!secret || !email || !sub || !farm) {
    return factory();
  }

  // Stamp the signed identity tuple. Wave 1 W1b binds `role` into the HMAC
  // payload itself — `x-session-role` is still set (defense-in-depth: every
  // matched-path response overwrites the client-supplied header so a fetch
  // bypassing middleware to a non-matched path can't inject a forged role)
  // but is no longer the authoritative source. The verifier in
  // `lib/server/farm-context.ts` reads the role via the header AND requires
  // it to match the value bound in the HMAC. Drift between header and
  // signed value fails verification cleanly.
  const headers = new Headers(req.headers);
  const sig = signIdentity(email, farm.slug, sub, farm.role, secret);
  headers.set("x-session-user", email);
  headers.set("x-farm-slug", farm.slug);
  headers.set("x-session-role", farm.role);
  headers.set("x-session-sub", sub);
  headers.set("x-session-sig", sig);

  return factory({ request: { headers } });
}

// Phase C additions (`api/health`, `demo`):
//   • api/health — shallow uptime probe must answer 200/JSON to
//     unauthenticated monitors (bug C1). Excluded so middleware never
//     redirects to /login.
//   • demo — public marketing surface documented in
//     memory/farm-website-demo.md (bug C3). When a /demo page is
//     present it renders for anonymous visitors; when it is absent the
//     `app/not-found.tsx` fallthrough handles it (bug C2).
//   • api/csp-report — Wave 4 A8: browser-emitted CSP violation reports
//     are POSTed without cookies; gating would 307 every report to
//     /login and the soak telemetry would be empty. The route handler
//     itself does not authenticate.
// IMPORTANT: __tests__/api/proxy-matcher.test.ts greps the FIRST quoted
// string inside `matcher: [...]`. Keep comments above `matcher:` (not
// between `[` and the string) or the test parser falls over.
export const config = {
  matcher: [
    "/((?!login|register|verify-email|subscribe|demo|api/auth|api/csp-report|api/einstein|api/health|api/inngest|api/observations|api/telemetry|api/webhooks|offline|_next/static|_next/image|favicon\\.ico|manifest\\.json|brangus\\.jpg|sw\\.js|.*\\.png|.*\\.jpg|.*\\.ico).*)",
  ],
};
