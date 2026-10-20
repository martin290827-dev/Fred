// Minimal service worker: makes Fred installable and lets the app shell load offline.
// API calls are never cached here. Bump CACHE when you change app files.
const CACHE = 'fred-v228';
const SHELL = ['./', 'index.html', 'style.css?v=228', 'theme.js?v=228', 'app.js?v=228', 'weather.js?v=228', 'markets.js?v=228', 'gcal.js?v=228', 'sync.js?v=228', 'food.js?v=228', 'tips.js?v=228', 'archive.js?v=228', 'recovery.js?v=228', 'poker.js?v=228', 'weekly.js?v=228', 'heatmap.js?v=228', 'now.js?v=228', 'nsum.js?v=228', 'sheets.js?v=228', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png'];

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
