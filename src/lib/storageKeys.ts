/**
 * Key naming and the one-time move off the old prefix.
 *
 * Deliberately free of any React Native import so it can be exercised in a
 * plain Node test — `storage.ts` is the thin layer that binds these to
 * AsyncStorage. The migration is the part worth testing: getting it wrong
 * signs out every existing user and silently drops their theme and learned
 * categories, and that failure is invisible until somebody complains.
 */
export const PREFIX = 'splitandtrack/';
export const LEGACY_PREFIX = 'splitwise-clone/';

/** The minimum of AsyncStorage this module needs. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function storageKey(name: string): string {
  return PREFIX + name;
}

/**
 * Read, carrying the value across from the old prefix the first time it is
 * found there. Costs one extra miss per key on a fresh install.
 */
export async function readFrom(store: KeyValueStore, name: string): Promise<string | null> {
  const current = await store.getItem(PREFIX + name);
  if (current !== null) return current;

  const legacy = await store.getItem(LEGACY_PREFIX + name);
  if (legacy === null) return null;

  try {
    await store.setItem(PREFIX + name, legacy);
    await store.removeItem(LEGACY_PREFIX + name);
  } catch {
    // Returning the value matters more than tidying up; the next read retries.
  }
  return legacy;
}

export async function writeTo(store: KeyValueStore, name: string, value: string): Promise<void> {
  await store.setItem(PREFIX + name, value);
}

/** Clears both names, so a sign-out cannot leave a stale legacy copy behind. */
export async function removeFrom(store: KeyValueStore, name: string): Promise<void> {
  await store.removeItem(PREFIX + name);
  await store.removeItem(LEGACY_PREFIX + name);
}
