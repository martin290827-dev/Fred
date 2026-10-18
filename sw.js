// Minimal service worker: makes Fred installable and lets the app shell load offline.
// API calls are never cached here. Bump CACHE when you change app files.
const CACHE = 'fred-v223';
const SHELL = ['./', 'index.html', 'style.css?v=223', 'theme.js?v=223', 'app.js?v=223', 'gcal.js?v=223', 'sync.js?v=223', 'food.js?v=223', 'tips.js?v=223', 'archive.js?v=223', 'recovery.js?v=223', 'poker.js?v=223', 'weekly.js?v=223', 'heatmap.js?v=223', 'now.js?v=223', 'nsum.js?v=223', 'sheets.js?v=223', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first, fall back to cache.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
