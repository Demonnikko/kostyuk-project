// Простой офлайн-кэш шелла
const CACHE_NAME = 'kostiuk-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  // критичные ассеты — добавьте по необходимости:
  '/images/portrait.jpg',
  '/images/portrait.webp'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k!==CACHE_NAME)&&caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first для API, Cache-first для статики
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API — всегда из сети
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    return; // пусть идёт по сети без перехвата
  }

  // статика — cache-first
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy)).catch(()=>{});
      return resp;
    }).catch(()=> res))
  );
});
