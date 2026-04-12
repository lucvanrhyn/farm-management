import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

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
  if (farmRouteMatch) {
    const farmSlug = farmRouteMatch[1];
    const farms = token.farms as Array<{ slug: string; tier: string; subscriptionStatus: string }>;
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
      const response = NextResponse.next();
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

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!login|register|verify-email|subscribe|api/auth|api/observations|api/webhooks|offline|_next/static|_next/image|favicon\\.ico|manifest\\.json|brangus\\.jpg|sw\\.js|.*\\.png|.*\\.jpg|.*\\.ico).*)",
  ],
};
