/* eslint-env serviceworker */
// Sahayak service worker. It caches NOTHING about patients: only an offline page is kept,
// shown when a page cannot be loaded because the phone or computer is offline.
const OFFLINE = '/offline.html';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open('sahayak-offline-v1').then((c) => c.add(OFFLINE)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
