/**
 * Compress the build's text assets once, at build time.
 *
 * serve-web.mjs can compress on the fly, but it has to do it cheaply — it runs
 * per request, so the brotli quality is capped low enough not to burn CPU on
 * every cache miss. Doing it here instead lifts that ceiling: the same bundle
 * goes from 487KB at the runtime quality to 430KB at maximum, and the server
 * stops re-compressing 2MB on each request.
 *
 * Nothing depends on the output. A missing .br or .gz just means serve-web.mjs
 * falls back to compressing that file itself, exactly as before.
 */
import { createReadStream, createWriteStream, existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createBrotliCompress, createGzip, constants } from 'node:zlib';

const ROOT = resolve(process.argv[2] ?? 'dist');
const EXTS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.map']);
// Below this the header outweighs the saving.
const MIN_BYTES = 1024;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let files = 0;
let before = 0;
let after = 0;

for (const file of walk(ROOT)) {
  if (!EXTS.has(extname(file))) continue;
  if (file.endsWith('.br') || file.endsWith('.gz')) continue;
  const size = statSync(file).size;
  if (size < MIN_BYTES) continue;

  await pipeline(
    createReadStream(file),
    createBrotliCompress({
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: size,
      },
    }),
    createWriteStream(`${file}.br`)
  );
  await pipeline(createReadStream(file), createGzip({ level: 9 }), createWriteStream(`${file}.gz`));

  files++;
  before += size;
  after += statSync(`${file}.br`).size;
}

const pct = before ? Math.round((1 - after / before) * 100) : 0;
console.log(
  `precompress: ${files} file(s), ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB brotli (${pct}% smaller)`
);
