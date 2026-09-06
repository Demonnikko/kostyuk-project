// Service worker админки — установка PWA + автообновление.
// Версию бампаем при каждом значимом деплое, чтобы старый кэш чистился.
const VERSION = 'kp-admin-v24';
const SHELL = ['./manifest.json', './admin-icon-192.png', './admin-icon-512.png'];

self.addEventListener('install', (e) => {
  // Не ждём — новый SW сразу становится активным
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => k !== VERSION && caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Позволяем странице форсировать обновление SW
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API — всегда из сети, без кэша (свежие данные, рабочий сканер)
  if (url.pathname.startsWith('/api/')) return;

  // HTML-страницы (навигация) — сеть в приоритете, чтобы всегда свежий код.
  // Кэш только как оффлайн-фолбэк.
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          const copy = resp.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Остальная статика (иконки, шрифты) — сеть в приоритете, кэш как запас
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        if (resp && resp.status === 200 && e.request.method === 'GET') {
          const copy = resp.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
