// Minimal service worker: makes Fred installable and lets the app shell load offline.
// API calls are never cached here. Bump CACHE when you change app files.
const CACHE = 'fred-v232';
const SHELL = ['./', 'index.html', 'style.css?v=232', 'theme.js?v=232', 'app.js?v=232', 'weather.js?v=232', 'markets.js?v=232', 'gcal.js?v=232', 'sync.js?v=232', 'food.js?v=232', 'tips.js?v=232', 'archive.js?v=232', 'recovery.js?v=232', 'poker.js?v=232', 'weekly.js?v=232', 'heatmap.js?v=232', 'now.js?v=232', 'nsum.js?v=232', 'sheets.js?v=232', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png'];

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
