import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

// Two-step pattern required by @serwist/next:
// 1. Call withSerwistInit(...) with SW config to get the wrapper function.
// 2. Call the wrapper with your Next.js config.
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // Disable SW in development to avoid stale cache interfering with HMR.
  // Test PWA by running: pnpm build && pnpm start
  disable: process.env.NODE_ENV === "development",
  // Explicitly include .jpg so farm background images are precached.
  // The default glob pattern omits .jpg which would leave brangus.jpg
  // and farm-select.jpg unavailable offline.
  globPublicPatterns: ["**/*.{js,css,html,ico,png,jpg,jpeg,svg,webp,woff2}"],
});

const nextConfig: NextConfig = {};

export default withSerwist(nextConfig);
