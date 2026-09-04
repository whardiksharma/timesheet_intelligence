/**
 * Service Worker for Timesheet PWA
 * Provides 100% Offline-First capability with Network-First strategy for JS/CSS assets
 * to prevent stale cached scripts from ever blocking UI updates.
 */

const CACHE_NAME = 'timesheet-pwa-v2.0.0';
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
        console.warn('[SW] Precache items skipped during offline install:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate Event: Purge ALL old cache versions immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Purging old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Event: Network-First for HTML, JS, CSS; Cache fallback when offline
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Ignore non-GET and API mutations
  if (request.method !== 'GET') {
    return;
  }

  // Network-First with Cache Fallback for documents and scripts
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (request.mode === 'navigate' || request.destination === 'document') {
            return caches.match('/timesheet');
          }
          return cachedResponse;
        });
      })
  );
});

// 4. Background Sync Event (When reconnecting online)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-timesheet-queue') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'TRIGGER_BACKGROUND_SYNC' });
        });
      })
    );
  }
});
