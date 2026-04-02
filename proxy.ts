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
  const farmRouteMatch = pathname.match(/^\/([^/]+)\/(admin|dashboard|logger)/);
  if (farmRouteMatch) {
    const farmSlug = farmRouteMatch[1];
    const farms = token.farms as Array<{ slug: string }>;
    if (!farms.some((f) => f.slug === farmSlug)) {
      return NextResponse.redirect(new URL("/farms", req.url));
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
    "/((?!login|offline|api/auth|api/observations|_next/static|_next/image|favicon\\.ico|manifest\\.json|brangus\\.jpg|sw\\.js|.*\\.png|.*\\.jpg|.*\\.ico).*)",
  ],
};
