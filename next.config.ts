import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import bundleAnalyzer from "@next/bundle-analyzer";
import { buildSecurityHeaders } from "./lib/security/csp";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  globPublicPatterns: ["**/*.{js,css,html,ico,png,jpg,jpeg,svg,webp,woff2}"],
});

// Bundle analyzer runs only when ANALYZE=true is passed, so it never
// inflates regular `pnpm build` times. Outputs HTML reports to
// .next/analyze/{client,edge,nodejs}.html.
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  openAnalyzer: false,
});

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // P3 (2026-04-27): defense-in-depth response headers — HSTS,
  // X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
  // Permissions-Policy, and a Content-Security-Policy-Report-Only.
  //
  // The CSP ships in report-only mode for a 2-week soak. See TODO inside
  // `lib/security/csp.ts` for the 2026-05-11 enforcement-flip date.
  //
  // Applied to every path with `/:path*`. Route handlers can still set
  // their own response headers — `Headers.set` on a route response wins
  // over the static config. This is intended (e.g. an OAuth handler that
  // needs a custom `Cache-Control`).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders(),
      },
    ];
  },
};

export default withBundleAnalyzer(withSerwist(nextConfig));
