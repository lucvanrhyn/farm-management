const CACHE = 'trio-b-logger-v2';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/logger']).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  // API calls pass through — handled at the app layer via IndexedDB queue
  if (url.pathname.startsWith('/api/')) return;
  // Next.js static assets: use network-first so dev-mode chunks (webpack.js,
  // main-app.js, etc.) are never served stale from cache. Content-addressed
  // files in production will still be cached after the first fetch.
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(networkFirstWithCache(e.request));
    return;
  }
  // Logger pages and root: network-first, fallback to cache
  if (url.pathname.startsWith('/logger') || url.pathname === '/') {
    e.respondWith(networkFirstWithCache(e.request));
  }
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

async function networkFirstWithCache(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const fallback = await cache.match('/logger');
      if (fallback) return fallback;
    }
    return Response.error();
  }
}
