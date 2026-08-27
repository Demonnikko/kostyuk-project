// Service worker админки — только для установки PWA.
// API и данные НИКОГДА не кэшируем (админу нужны свежие данные и рабочий сканер).
const CACHE = 'kp-admin-v1';
const SHELL = ['./index.html', './manifest.json', './admin-icon-192.png', './admin-icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE && caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API — всегда из сети, без кэша
  if (url.pathname.startsWith('/api/')) return;
  // всё остальное — network-first, кэш как оффлайн-фолбэк для оболочки
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        if (resp && resp.status === 200 && e.request.method === 'GET') {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
