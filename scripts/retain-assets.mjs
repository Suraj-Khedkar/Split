/**
 * Carry the previous build's hashed assets into the new one.
 *
 * `expo export` empties the output directory, so the moment a deploy lands,
 * every bundle name from the previous build stops existing. Anyone holding a
 * cached index.html — a phone that was offline, a tab opened seconds before,
 * a service worker serving its shell — then asks for a file the server no
 * longer has, and the app cannot start.
 *
 * Hashed names never collide, so keeping the old ones costs a little disk and
 * removes the window entirely. Anything older than KEEP builds is pruned so
 * this does not grow without bound.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist');
const attic = resolve(process.argv[3] ?? '.web-build-attic');
const ASSET_DIR = join('_expo', 'static', 'js', 'web');
const KEEP = 3;

const mode = process.argv[4];
const live = join(dist, ASSET_DIR);
const kept = join(attic, ASSET_DIR);

if (mode === 'stash') {
  if (!existsSync(live)) process.exit(0);
  mkdirSync(kept, { recursive: true });
  for (const f of readdirSync(live)) cpSync(join(live, f), join(kept, f));
  console.log(`retain-assets: stashed ${readdirSync(live).length} bundle(s)`);
} else {
  if (!existsSync(kept)) process.exit(0);
  mkdirSync(live, { recursive: true });
  let restored = 0;
  for (const f of readdirSync(kept)) {
    const target = join(live, f);
    // Never overwrite what this build just produced.
    if (!existsSync(target)) {
      cpSync(join(kept, f), target);
      restored++;
    }
  }
  // Prune the attic to the most recent KEEP files by mtime.
  const byAge = readdirSync(kept)
    .map((f) => ({ f, t: statSync(join(kept, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of byAge.slice(KEEP)) rmSync(join(kept, f), { force: true });
  console.log(`retain-assets: carried over ${restored} previous bundle(s)`);
}
