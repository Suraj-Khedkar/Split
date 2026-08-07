/**
 * Service worker: app shell cache.
 *
 * Network-first for navigation so a running server always wins, with the
 * cached shell as fallback. Without this, opening the home-screen icon while
 * pinaka is asleep gives a blank white screen, which feels far worse in a
 * standalone app than a failed page load in a browser tab.
 *
 * API calls are never cached — stale balances would be worse than an error.
 */
const CACHE = 'splitwise-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return; // never serve stale data

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        // Client-side routes have no file of their own; fall back to the shell.
        if (request.mode === 'navigate') return caches.match('/');
        return new Response('', { status: 504 });
      })
  );
});
