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
// Bumped to v2 deliberately: activate() deletes every cache that is not this
// one, which is the only way to clear an install that already cached an HTML
// error page under a hashed .js URL it treats as immutable. Bump this whenever
// a cached entry could be poisoned.
const CACHE = 'split-and-track-shell-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/apple-touch-icon.png'];

/**
 * The app bundle for this build, injected by scripts/pwa-inject.mjs.
 *
 * Precached during install so a new version is downloaded *before* it is
 * needed, while the previous service worker carries on serving the previous
 * bundle. Without it the first launch after a deploy had to fetch ~550KB over
 * whatever connection the phone happened to have, with a blank screen until
 * it finished.
 */
const ENTRY = '__ENTRY_BUNDLE__';

/** Shown only when there is no cached shell at all — a first visit offline. */
const OFFLINE_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Split &amp; Track</title>
<style>
  html,body{height:100%;margin:0;background:#F6F7F9;color:#0E0F12;
    font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  @media (prefers-color-scheme:dark){html,body{background:#0E0F12;color:#F6F7F9}}
  main{height:100%;display:flex;flex-direction:column;align-items:center;
    justify-content:center;text-align:center;padding:24px;box-sizing:border-box}
  h1{font-size:19px;margin:0 0 8px}p{margin:0;opacity:.7;font-size:15px}
  button{margin-top:24px;padding:12px 22px;border:0;border-radius:10px;
    background:#1CC29F;color:#fff;font-size:16px;font-weight:600}
</style></head>
<body><main>
  <h1>No connection</h1>
  <p>Split &amp; Track needs to load once before it can work offline.</p>
  <button onclick="location.reload()">Try again</button>
</main></body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // The shell and this build's bundle are what "installed" means; if
      // either cannot be fetched the install fails and the previous worker
      // keeps serving, which is the right outcome on a bad connection.
      const required = ENTRY.startsWith('/') ? ['/', ENTRY] : ['/'];
      await cache.addAll(required);
      // The rest is decoration — an icon that will not load must not keep the
      // whole update from going through.
      await Promise.allSettled(
        SHELL.filter((u) => u !== '/').map((u) => cache.add(u))
      );
      await self.skipWaiting();
    })()
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

/**
 * Expo's build output, e.g. /_expo/static/js/web/entry-<hash>.js.
 *
 * The filename carries a content hash, so a given URL's bytes never change —
 * a new build is a new name. That makes it safe to answer from the cache
 * without asking the network first.
 */
function isImmutableAsset(pathname) {
  return pathname.startsWith('/_expo/static/');
}

/**
 * Whether a response is safe to keep.
 *
 * Status alone is not enough. A server that answers a missing script with an
 * HTML page returns a perfectly good 200, and storing that under a hashed
 * script URL bricks the app for good — so the content type has to agree with
 * what was asked for.
 */
/**
 * Look only in this build's cache.
 *
 * `caches.match()` searches every cache in the origin, so an entry left in an
 * older one stays reachable even after the version bump that was supposed to
 * retire it — which would defeat the whole point of naming the cache after the
 * build. Scoping the lookup makes a bad entry survivable: the next build
 * cannot see it, and activate() deletes it.
 */
async function cached(request) {
  const c = await caches.open(CACHE);
  return c.match(request);
}

function isStorable(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return false;
  const path = new URL(request.url).pathname;
  const type = response.headers.get('Content-Type') ?? '';
  if (path.endsWith('.js') && !/javascript|ecmascript/i.test(type)) return false;
  if (path.endsWith('.css') && !/text\/css/i.test(type)) return false;
  return true;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return; // never serve stale data

  /**
   * Cache-first for the app bundle.
   *
   * It is a single ~2MB file (web.output is "single", so there is no code
   * splitting), and network-first made every launch wait on it — on a weak
   * connection that is a long blank screen before the cached copy is even
   * tried, and offline it meant waiting for the fetch to time out. Hashed
   * names mean there is no staleness to trade away for it.
   */
  if (isImmutableAsset(url.pathname)) {
    event.respondWith(
      (async () => {
        const hit = await cached(request);
        if (hit) return hit;

        try {
          const response = await fetch(request);
          // Only a real, correct answer is worth keeping. A hashed URL is
          // treated as immutable, so caching an error — or the HTML the SPA
          // fallback used to return for a deleted bundle — would make one bad
          // launch permanent.
          if (isStorable(request, response)) {
            const copy = response.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return response;
        } catch {
          // Never reject: a rejected respondWith surfaces as a failed script
          // load, which is a blank page rather than a message.
          return new Response('/* offline */', {
            status: 504,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      })()
    );
    return;
  }

  // Network-first for everything else, so a running server always wins and a
  // deploy is picked up on the next load — but racing against a timeout,
  // because on a weak connection (as opposed to no connection) the fetch
  // doesn't fail fast, it just hangs, and that hang was the white screen:
  // offline rejects the fetch immediately and falls back to cache, but
  // "barely online" sat there waiting on a response that might never come.
  // The network fetch keeps running after losing the race so the cache
  // still gets refreshed once it does resolve.
  event.respondWith(
    (async () => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (isStorable(request, response)) {
            const copy = response.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => undefined);

      const timeout = new Promise((resolve) => setTimeout(resolve, 2500));
      const fast = await Promise.race([networkFetch, timeout]);
      if (fast) return fast;

      const hit = await cached(request);
      if (hit) return hit;

      // No cached copy (e.g. first-ever visit) — the timeout lost, so wait
      // for the network as a last resort instead of failing outright.
      const late = await networkFetch;
      if (late) return late;

      // Client-side routes have no file of their own; fall back to the shell.
      // caches.match can resolve to undefined, and returning that from
      // respondWith is itself a blank page — so it needs a real answer.
      if (request.mode === 'navigate') {
        const shell = await cached('/');
        if (shell) return shell;
        return new Response(OFFLINE_PAGE, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return new Response('', { status: 504 });
    })()
  );
});
