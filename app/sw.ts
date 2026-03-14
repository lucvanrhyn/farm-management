import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheFirst,
  CacheableResponsePlugin,
  NetworkOnly,
  StaleWhileRevalidate,
  Serwist,
  ExpirationPlugin,
} from "serwist";
import { defaultCache } from "@serwist/next/worker";

// Required: declare __SW_MANIFEST on the SW global scope.
// This token is replaced by @serwist/next at build time with the actual
// list of hashed Next.js chunk URLs to precache.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: WorkerGlobalScope & typeof globalThis;

const serwist = new Serwist({
  // Explicitly include /offline so the fallback is guaranteed to be available
  // offline, regardless of whether @serwist/next statically exports it.
  precacheEntries: [...(self.__SW_MANIFEST ?? []), { url: "/offline", revision: "1" }],
  skipWaiting: true,
  clientsClaim: true,
  // navigationPreload disabled for iOS Safari compatibility —
  // Safari has reliability issues with the Navigation Preload API.
  navigationPreload: false,
  // Serve /offline as fallback when a navigation request has no cached response
  // and the network is unavailable.
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
  runtimeCaching: [
    // Navigation requests (HTML pages) — cache after first online visit so
    // the app shell loads offline. Must be first so it matches before defaultCache.
    {
      matcher: ({ request }) => request.mode === "navigate",
      handler: new StaleWhileRevalidate({
        cacheName: "pages",
        plugins: [
          // Only cache 200 OK responses — prevents a 302 redirect to /login
          // (e.g. from an expired JWT) from being stored and served offline,
          // which would leave Dicky stuck on a non-functional login form.
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 }),
        ],
      }),
    },
    // Cache logger camp pages from background warm-up fetches.
    // When LoggerLayout mounts online it pre-fetches each /logger/[campId] via
    // fetch(), which has mode="same-origin" (not "navigate") and therefore
    // misses the navigate rule above. This rule catches those requests and
    // stores the responses in the same "pages" cache so that the navigate rule
    // can serve them offline on subsequent hard navigations.
    {
      matcher: ({ url, request }: { url: URL; request: Request }) =>
        url.pathname.startsWith("/logger/") && request.mode !== "navigate",
      handler: new StaleWhileRevalidate({
        cacheName: "pages",
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 }),
        ],
      }),
    },
    // Farm images — cache on first visit, serve from cache thereafter.
    // Covers brangus.jpg, farm-select.jpg, and any other images.
    {
      matcher: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
      handler: new CacheFirst({
        cacheName: "trio-b-images",
        plugins: [
          new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 }),
        ],
      }),
    },
    // GeoJSON camp boundary polygons — cache first, refresh weekly.
    {
      matcher: /\/geojson\//i,
      handler: new CacheFirst({
        cacheName: "trio-b-geojson",
        plugins: [
          new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 7 * 24 * 60 * 60 }),
        ],
      }),
    },
    // API routes — always network only.
    // The app-layer IndexedDB queue handles offline observation logging;
    // the SW must never try to cache or serve API responses.
    {
      matcher: /\/api\//i,
      handler: new NetworkOnly(),
    },
    // Serwist default strategies for all remaining Next.js static assets.
    ...defaultCache,
  ],
});

serwist.addEventListeners();
