/**
 * Minimal static server for the exported web build.
 *
 * Needs an SPA fallback: expo-router does client-side routing, so a deep link
 * like /group/abc has no file on disk and must still return index.html.
 * Kept dependency-free so it can run behind Tailscale Funnel unattended.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { createGzip, createBrotliCompress, constants as zlibConstants } from 'node:zlib';

const ROOT = resolve(process.argv[2] ?? 'dist');
const PORT = Number(process.env.PORT ?? 3000);
// Bind loopback only: Funnel proxies to it, so it never needs to be exposed
// directly on the LAN or tailnet.
const HOST = process.env.HOST ?? '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // Chrome warns and some installers refuse when this is octet-stream.
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

// Fonts, images and .map files are already compressed (or rarely fetched);
// compressing them again just burns CPU for no size win.
const COMPRESSIBLE = new Set([
  TYPES['.html'],
  TYPES['.js'],
  TYPES['.css'],
  TYPES['.json'],
  TYPES['.webmanifest'],
  TYPES['.svg'],
]);

const API_TARGET = Number(process.env.API_PORT ?? 4000);

const server = createServer((req, res) => {
  const rawUrl = req.url ?? '/';

  // Forward /api to the API process. In production Tailscale Funnel does this,
  // but without it here the SPA fallback below would answer API calls with
  // index.html — which surfaces as a baffling "unexpected response" in the UI.
  if (rawUrl === '/api' || rawUrl.startsWith('/api/')) {
    const upstream = httpRequest(
      { host: '127.0.0.1', port: API_TARGET, path: rawUrl, method: req.method, headers: req.headers },
      (proxied) => {
        res.writeHead(proxied.statusCode ?? 502, proxied.headers);
        proxied.pipe(res);
      }
    );
    upstream.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'API server is not running' }));
    });
    req.pipe(upstream);
    return;
  }

  const url = decodeURIComponent(rawUrl.split('?')[0]);
  // normalize() collapses ".." so a crafted path cannot escape ROOT.
  const candidate = join(ROOT, normalize(url));
  const found =
    candidate.startsWith(ROOT) && existsSync(candidate) && statSync(candidate).isFile();

  /**
   * The SPA fallback is for *routes*, never for assets.
   *
   * expo-router does client-side routing, so /group/abc has no file and must
   * return index.html. But a path that names a file — anything with an
   * extension — is an asset request, and answering it with index.html is
   * actively harmful: a request for a bundle that no longer exists (every
   * deploy renames it) came back 200 with HTML, the browser tried to execute
   * that HTML as JavaScript, and the app died on a syntax error before it
   * could render. That is the white screen. Worse, the service worker then
   * cached the HTML under a hashed URL it treats as immutable, so the failure
   * survived every future launch.
   *
   * A missing asset has to 404 so callers can tell "gone" from "here it is".
   */
  if (!found && extname(candidate)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Not found');
    return;
  }

  const file = found ? candidate : join(ROOT, 'index.html');

  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    // Hashed asset filenames can cache hard; index.html must not.
    'Cache-Control': file.endsWith('index.html')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
    Vary: 'Accept-Encoding',
  };

  // The web build ships as a single ~2MB JS bundle (app.json: web.output
  // "single"), and everything else here is already-compressed binary. On a
  // weak connection an uncompressed 2MB transfer is far more likely to stall
  // or drop mid-download than a ~500KB compressed one — which surfaced as a
  // white screen on devices off the home network while the same build loaded
  // fine locally.
  const acceptEncoding = req.headers['accept-encoding'] ?? '';
  const encoding = COMPRESSIBLE.has(type)
    ? /\bbr\b/.test(acceptEncoding)
      ? 'br'
      : /\bgzip\b/.test(acceptEncoding)
        ? 'gzip'
        : null
    : null;

  if (encoding) {
    headers['Content-Encoding'] = encoding;
    res.writeHead(200, headers);
    const compressor =
      encoding === 'br'
        ? createBrotliCompress({
            params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
          })
        : createGzip();
    createReadStream(file).pipe(compressor).pipe(res);
  } else {
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  }
});

/**
 * Proxy WebSocket upgrades too.
 *
 * createServer's request handler never sees an Upgrade — Node emits it on the
 * 'upgrade' event — so without this the local dev URL silently hangs while the
 * public Funnel URL works, which is a miserable thing to debug.
 */
server.on('upgrade', (req, socket, head) => {
  const path = req.url ?? '/';
  if (!(path === '/api' || path.startsWith('/api/'))) return socket.destroy();

  const upstream = httpRequest({
    host: '127.0.0.1',
    port: API_TARGET,
    path,
    method: req.method,
    headers: req.headers,
  });

  upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
    const lines = Object.entries(upstreamRes.headers).map(([k, v]) => `${k}: ${v}`);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`);
    if (upstreamHead?.length) socket.unshift(upstreamHead);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
    upstreamSocket.on('error', () => socket.destroy());
    socket.on('error', () => upstreamSocket.destroy());
  });
  upstream.on('response', () => socket.destroy());
  upstream.on('error', () => socket.destroy());
  if (head?.length) upstream.write(head);
  upstream.end();
});

server.listen(PORT, HOST, () => {
  console.log(`serving ${ROOT} on http://${HOST}:${PORT}`);
});
