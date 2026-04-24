import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";

// Keep in sync with `lib/server/farm-context.ts`. We intentionally re-implement
// the tiny HMAC helper here rather than importing, because proxy.ts runs on
// the Edge-compatible middleware runtime and must keep its module graph flat
// (no transitive Prisma / auth-options imports).
function signIdentity(userEmail: string, slug: string, secret: string): string {
  return createHmac("sha256", secret).update(`${userEmail}\n${slug}`).digest("hex");
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Farm select API must be accessible to authenticated users — checked inside the route handler itself
  if (pathname.startsWith("/api/farms/") && pathname.endsWith("/select")) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token || !Array.isArray(token.farms)) {
    return NextResponse.redirect(new URL("/login", req.url));
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
  if (!secret || !email || !farm) {
    return factory();
  }

  const headers = new Headers(req.headers);
  const sig = signIdentity(email, farm.slug, secret);
  headers.set("x-session-user", email);
  headers.set("x-farm-slug", farm.slug);
  headers.set("x-session-role", farm.role);
  headers.set("x-session-sig", sig);

  return factory({ request: { headers } });
}

export const config = {
  matcher: [
    "/((?!login|register|verify-email|subscribe|api/auth|api/einstein|api/inngest|api/observations|api/telemetry|api/webhooks|offline|_next/static|_next/image|favicon\\.ico|manifest\\.json|brangus\\.jpg|sw\\.js|.*\\.png|.*\\.jpg|.*\\.ico).*)",
  ],
};
