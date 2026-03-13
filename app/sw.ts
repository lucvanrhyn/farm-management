import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheFirst,
  NetworkOnly,
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
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  // navigationPreload disabled for iOS Safari compatibility —
  // Safari has reliability issues with the Navigation Preload API.
  navigationPreload: false,
  runtimeCaching: [
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
