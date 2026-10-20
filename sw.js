// Minimal service worker: makes Fred installable and lets the app shell load offline.
// API calls are never cached here. Bump CACHE when you change app files.
const CACHE = 'fred-v229';
const SHELL = ['./', 'index.html', 'style.css?v=229', 'theme.js?v=229', 'app.js?v=229', 'weather.js?v=229', 'markets.js?v=229', 'gcal.js?v=229', 'sync.js?v=229', 'food.js?v=229', 'tips.js?v=229', 'archive.js?v=229', 'recovery.js?v=229', 'poker.js?v=229', 'weekly.js?v=229', 'heatmap.js?v=229', 'now.js?v=229', 'nsum.js?v=229', 'sheets.js?v=229', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png'];

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
