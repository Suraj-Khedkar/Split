/**
 * Collision-resistant enough for a local, single-device ledger.
 * Avoids a uuid dependency (and its RN crypto polyfill) for something that
 * only needs to be unique within one phone's storage.
 */
let counter = 0;

export function newId(prefix = 'id'): string {
  counter += 1;
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${counter.toString(36)}${rand}`;
}
