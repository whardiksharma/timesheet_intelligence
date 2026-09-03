/**
 * Service Worker for Timesheet PWA
 * Provides 100% Offline-First caching and background synchronization.
 */

const CACHE_NAME = 'timesheet-pwa-v1.0.2';
const PRECACHE_ASSETS = [
  '/timesheet',
  '/assets/timesheet_intelligence/css/timesheet-pwa.css',
  '/assets/timesheet_intelligence/js/timesheet-db.js',
  '/assets/timesheet_intelligence/js/timesheet-sync.js',
  '/assets/timesheet_intelligence/js/timesheet-voice.js',
  '/assets/timesheet_intelligence/js/timesheet-app.js',
  '/assets/timesheet_intelligence/manifest.json'
];

// 1. Install Event: Precache App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Precaching App Shell assets');
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Some precache items skipped during offline install:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate Event: Clean old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Event: Network-First for HTML, Cache-First for static assets, with offline fallback
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Ignore non-GET and API mutations
  if (request.method !== 'GET') {
    return;
  }

  // Navigation (HTML) request: Network-First with Cache Fallback
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match('/timesheet') || caches.match(request);
        })
    );
    return;
  }

  // Static Assets (CSS, JS, Fonts, Images): Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// 4. Background Sync Event (When reconnecting online)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-timesheet-queue') {
    console.log('[SW] Background sync triggered: sync-timesheet-queue');
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'TRIGGER_BACKGROUND_SYNC' });
        });
      })
    );
  }
});
