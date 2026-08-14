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
const CACHE = 'split-and-track-shell-v1';
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

/**
 * A new expense somewhere you are involved.
 *
 * The payload is already decrypted by the browser by the time it reaches here.
 * userVisibleOnly was a condition of the subscription, so every push must show
 * something — a push that resolves without calling showNotification counts
 * against the origin and eventually gets the permission revoked. Hence the
 * fallback text on a malformed body.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Fall through to the generic message rather than showing nothing.
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Split & Track', {
      body: data.body || 'Something changed in one of your groups.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Same tag replaces an earlier notification for the same expense instead
      // of stacking duplicates when several devices report it.
      tag: data.tag || 'split-and-track',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';

  // Focus a tab that is already open rather than opening a second copy of the
  // app; in a standalone PWA a second window is especially jarring.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
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
