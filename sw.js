// Minimal service worker: makes Fred installable and lets the app shell load offline.
// API calls are never cached here. Bump CACHE when you change app files.
const CACHE = 'fred-v226';
const SHELL = ['./', 'index.html', 'style.css?v=226', 'theme.js?v=226', 'app.js?v=226', 'weather.js?v=226', 'markets.js?v=226', 'gcal.js?v=226', 'sync.js?v=226', 'food.js?v=226', 'tips.js?v=226', 'archive.js?v=226', 'recovery.js?v=226', 'poker.js?v=226', 'weekly.js?v=226', 'heatmap.js?v=226', 'now.js?v=226', 'nsum.js?v=226', 'sheets.js?v=226', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png'];

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
