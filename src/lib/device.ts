import AsyncStorage from '@react-native-async-storage/async-storage';

import { newId } from './id';

const KEY = 'splitwise-clone/device';

/**
 * Stable id for this install (this browser, or this phone's app).
 *
 * Used only so the server can avoid echoing a change back to the device that
 * made it. It deliberately identifies the *install*, not the person: the same
 * account signed in on a laptop and a phone must be two different devices, or
 * they stop updating each other.
 */
let cached = '';

export function deviceId(): string {
  return cached;
}

export async function loadDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (saved) {
      cached = saved;
      return cached;
    }
  } catch {
    // Fall through and mint a fresh one; a per-session id still works, it
    // just means an extra harmless refresh after a reload.
  }
  cached = newId('dev');
  try {
    await AsyncStorage.setItem(KEY, cached);
  } catch {
    /* non-fatal */
  }
  return cached;
}
