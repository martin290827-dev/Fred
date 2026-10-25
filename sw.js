// Minimal service worker: makes Fred installable and lets the app shell load offline.
// API calls are never cached here. Bump CACHE when you change app files.
const CACHE = 'fred-v235';
const SHELL = ['./', 'index.html', 'style.css?v=235', 'theme.js?v=235', 'app.js?v=235', 'weather.js?v=235', 'markets.js?v=235', 'gcal.js?v=235', 'sync.js?v=235', 'food.js?v=235', 'tips.js?v=235', 'archive.js?v=235', 'recovery.js?v=235', 'poker.js?v=235', 'weekly.js?v=235', 'heatmap.js?v=235', 'now.js?v=235', 'nsum.js?v=235', 'sheets.js?v=235', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png'];

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
