// Minimal service worker: makes Fred installable and lets the app shell load offline.
// API calls are never cached here. Bump CACHE when you change app files.
const CACHE = 'fred-v227';
const SHELL = ['./', 'index.html', 'style.css?v=227', 'theme.js?v=227', 'app.js?v=227', 'weather.js?v=227', 'markets.js?v=227', 'gcal.js?v=227', 'sync.js?v=227', 'food.js?v=227', 'tips.js?v=227', 'archive.js?v=227', 'recovery.js?v=227', 'poker.js?v=227', 'weekly.js?v=227', 'heatmap.js?v=227', 'now.js?v=227', 'nsum.js?v=227', 'sheets.js?v=227', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png'];

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
