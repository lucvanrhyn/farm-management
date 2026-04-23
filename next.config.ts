import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import bundleAnalyzer from "@next/bundle-analyzer";

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
};

export default withBundleAnalyzer(withSerwist(nextConfig));
