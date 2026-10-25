// Minimal service worker: makes Fred installable and lets the app shell load offline.
// API calls are never cached here. Bump CACHE when you change app files.
const CACHE = 'fred-v234';
const SHELL = ['./', 'index.html', 'style.css?v=234', 'theme.js?v=234', 'app.js?v=234', 'weather.js?v=234', 'markets.js?v=234', 'gcal.js?v=234', 'sync.js?v=234', 'food.js?v=234', 'tips.js?v=234', 'archive.js?v=234', 'recovery.js?v=234', 'poker.js?v=234', 'weekly.js?v=234', 'heatmap.js?v=234', 'now.js?v=234', 'nsum.js?v=234', 'sheets.js?v=234', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png'];

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
