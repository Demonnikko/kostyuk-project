// Простой офлайн-кэш шелла
const CACHE_NAME = 'kostyuk-ecosystem-v51';
const ASSETS = [
  '/',
  '/index.html',
  '/ecosystem.css',
  '/manifest.json',
  '/images/портрет.jpg',
  '/images/brand/kostyuk-project-monogram-square-v1.png',
  '/images/brand/kostyuk-author-shows-logo-v1.png',
  '/vendor/fonts/fonts.css',
  '/vendor/swiper/swiper-bundle.min.css',
  '/vendor/swiper/swiper-bundle.min.js',
  '/events/',
  '/events/events.css',
  '/events/events.js',
  '/school/',
  '/school/school.css',
  '/school/school.js',
  '/concerts/'
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
      if (resp && resp.status === 200) {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy)).catch(()=>{});
      }
      return resp;
    }).catch(()=> res))
  );
});
