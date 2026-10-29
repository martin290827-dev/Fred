// Minimal service worker: makes Fred installable and lets the app shell load offline.
// API calls are never cached here. Bump CACHE when you change app files.
const CACHE = 'fred-v237';
const SHELL = ['./', 'index.html', 'style.css?v=237', 'theme.js?v=237', 'app.js?v=237', 'weather.js?v=237', 'markets.js?v=237', 'gcal.js?v=237', 'sync.js?v=237', 'food.js?v=237', 'tips.js?v=237', 'archive.js?v=237', 'recovery.js?v=237', 'poker.js?v=237', 'weekly.js?v=237', 'heatmap.js?v=237', 'now.js?v=237', 'nsum.js?v=237', 'cockpit.js?v=237', 'sheets.js?v=237', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png'];

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
