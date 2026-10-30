// Minimal service worker: makes Fred installable and lets the app shell load offline.
// API calls are never cached here. Bump CACHE when you change app files.
const CACHE = 'fred-v239';
const SHELL = ['./', 'index.html', 'style.css?v=239', 'm3.css?v=239', 'theme.js?v=239', 'app.js?v=239', 'weather.js?v=239', 'markets.js?v=239', 'gcal.js?v=239', 'sync.js?v=239', 'food.js?v=239', 'tips.js?v=239', 'archive.js?v=239', 'recovery.js?v=239', 'poker.js?v=239', 'weekly.js?v=239', 'heatmap.js?v=239', 'now.js?v=239', 'nsum.js?v=239', 'cockpit.js?v=239', 'sheets.js?v=239', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png'];

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
