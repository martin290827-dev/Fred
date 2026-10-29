// Minimal service worker: makes Fred installable and lets the app shell load offline.
// API calls are never cached here. Bump CACHE when you change app files.
const CACHE = 'fred-v238';
const SHELL = ['./', 'index.html', 'style.css?v=238', 'm3.css?v=238', 'theme.js?v=238', 'app.js?v=238', 'weather.js?v=238', 'markets.js?v=238', 'gcal.js?v=238', 'sync.js?v=238', 'food.js?v=238', 'tips.js?v=238', 'archive.js?v=238', 'recovery.js?v=238', 'poker.js?v=238', 'weekly.js?v=238', 'heatmap.js?v=238', 'now.js?v=238', 'nsum.js?v=238', 'cockpit.js?v=238', 'sheets.js?v=238', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png'];

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
