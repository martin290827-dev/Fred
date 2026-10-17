// Minimal service worker: makes Fred installable and lets the app shell load offline.
// API calls are never cached here. Bump CACHE when you change app files.
const CACHE = 'fred-v207';
const SHELL = ['./', 'index.html', 'style.css?v=207', 'theme.js?v=207', 'app.js?v=207', 'gcal.js?v=207', 'sync.js?v=207', 'food.js?v=207', 'tips.js?v=207', 'archive.js?v=207', 'recovery.js?v=207', 'poker.js?v=207', 'weekly.js?v=207', 'heatmap.js?v=207', 'now.js?v=207', 'sheets.js?v=207', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png'];

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
