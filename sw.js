// Minimal service worker: makes Fred installable and lets the app shell load offline.
// API calls are never cached here. Bump CACHE when you change app files.
const CACHE = 'fred-v236';
const SHELL = ['./', 'index.html', 'style.css?v=236', 'theme.js?v=236', 'app.js?v=236', 'weather.js?v=236', 'markets.js?v=236', 'gcal.js?v=236', 'sync.js?v=236', 'food.js?v=236', 'tips.js?v=236', 'archive.js?v=236', 'recovery.js?v=236', 'poker.js?v=236', 'weekly.js?v=236', 'heatmap.js?v=236', 'now.js?v=236', 'nsum.js?v=236', 'cockpit.js?v=236', 'sheets.js?v=236', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png'];

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
