import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  readFrom,
  removeFrom,
  storageKey,
  writeTo,
  type KeyValueStore,
} from '../storageKeys';

/** An in-memory stand-in for AsyncStorage. */
const backing = new Map<string, string>();
const store: KeyValueStore = {
  getItem: async (k) => (backing.has(k) ? backing.get(k)! : null),
  setItem: async (k, v) => void backing.set(k, v),
  removeItem: async (k) => void backing.delete(k),
};

beforeEach(() => backing.clear());

test('a value written under the old prefix is still found', async () => {
  backing.set('splitwise-clone/token', 'session-abc');
  assert.equal(await readFrom(store, 'token'), 'session-abc');
});

test('finding it moves it across, so the fallback runs only once', async () => {
  backing.set('splitwise-clone/settings', '{"themeMode":"light"}');
  await readFrom(store, 'settings');
  assert.equal(backing.get('splitandtrack/settings'), '{"themeMode":"light"}');
  assert.equal(backing.has('splitwise-clone/settings'), false, 'old key cleaned up');
});

test('the new key wins when both somehow exist', async () => {
  backing.set('splitwise-clone/token', 'stale');
  backing.set('splitandtrack/token', 'current');
  assert.equal(await readFrom(store, 'token'), 'current');
});

test('a fresh install just reads nothing', async () => {
  assert.equal(await readFrom(store, 'token'), null);
});

test('removing clears both names, so sign-out leaves no stale copy', async () => {
  backing.set('splitwise-clone/token', 'old');
  backing.set('splitandtrack/token', 'new');
  await removeFrom(store, 'token');
  assert.equal(backing.size, 0);
});

test('writes go to the new prefix only', async () => {
  await writeTo(store, 'device', 'dev-1');
  assert.equal(backing.get('splitandtrack/device'), 'dev-1');
  assert.equal(storageKey('device'), 'splitandtrack/device');
});

test('every key the app uses survives the rename', async () => {
  // The real list, so a key added later without a migration path shows up here.
  const keys = ['token', 'device', 'v1', 'settings', 'pending-invite', 'push-auto-attempted'];
  for (const k of keys) backing.set(`splitwise-clone/${k}`, `value-of-${k}`);
  for (const k of keys) {
    assert.equal(await readFrom(store, k), `value-of-${k}`, `${k} did not carry over`);
  }
});
