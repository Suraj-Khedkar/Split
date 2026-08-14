import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { api } from './api';

/**
 * Web Push subscription management.
 *
 * Web-only by design: the notification arrives through the browser's push
 * service and is shown by public/sw.js, so there is nothing to do — and no
 * service worker to do it with — inside Expo Go or a native build. Those
 * report `unsupported` and the Account screen explains why rather than
 * offering a switch that could not work.
 *
 * Everything here is defensive about `undefined` globals: this module is
 * imported on native too, where `window`, `Notification` and `navigator` are
 * either absent or shims.
 */
export type PushState =
  /** Not a browser, or the browser has no Push API. */
  | 'unsupported'
  /** Supported, permission not yet asked for or subscription not created. */
  | 'off'
  /** Subscribed and receiving. */
  | 'on'
  /** The user said no; only they can undo this, in browser settings. */
  | 'denied';

const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';

export function pushSupported(): boolean {
  return (
    isWeb &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  );
}

/**
 * The base64url applicationServerKey the browser wants as raw bytes.
 *
 * Backed by an explicit ArrayBuffer rather than `Uint8Array.from`, whose
 * inferred ArrayBufferLike does not satisfy the BufferSource that `subscribe`
 * expects.
 */
function decodeKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** What the UI should show right now, without prompting for anything. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    return existing ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/**
 * Ask for permission and register with the server.
 *
 * Must be called from a user gesture — browsers reject a permission prompt
 * that was not obviously asked for, which is why this is a button in Settings
 * rather than something that happens on launch.
 *
 * Returns the resulting state, or throws with a message worth showing.
 */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    const { publicKey } = await api.pushKey();
    subscription = await registration.pushManager.subscribe({
      // Required by Chrome, and the reason a silent background push is not
      // possible: every push has to show the user something.
      userVisibleOnly: true,
      applicationServerKey: decodeKey(publicKey),
    });
  }

  // toJSON() gives the endpoint plus the base64url keys, which is exactly the
  // shape the encryption on the server needs.
  const { endpoint, keys } = subscription.toJSON() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
  await api.pushSubscribe({ endpoint, keys });
  return 'on';
}

const AUTO_KEY = 'splitwise-clone/push-auto-attempted';

/**
 * Bring notifications up on their own, as soon as there is a session.
 *
 * Two genuinely different cases hide behind "on by default":
 *
 * - Permission is already granted. Subscribing then needs no prompt and no
 *   gesture, so this is pure upside — it also silently repairs a subscription
 *   lost to a reinstall, a cleared service worker, or a new device.
 * - Permission has never been asked for. A prompt outside a user gesture is
 *   refused outright by iOS and only tolerated elsewhere, and a prompt the user
 *   waves away counts as a *denial* that the app can never undo — only browser
 *   settings can. So it is attempted exactly once per device and never again.
 *
 * Never throws: this runs unattended at launch, where there is nobody to show
 * an error to.
 */
export async function autoEnablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';

  if (Notification.permission === 'granted') {
    try {
      return await enablePush();
    } catch {
      return 'off';
    }
  }

  try {
    if (await AsyncStorage.getItem(AUTO_KEY)) return 'off';
    await AsyncStorage.setItem(AUTO_KEY, '1');
    return await enablePush();
  } catch {
    return 'off';
  }
}

/** Unsubscribe locally and drop the row on the server. */
export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const { endpoint } = subscription.toJSON() as { endpoint: string };
      // Tell the server first: if unsubscribing succeeds but the call fails,
      // the row lingers and every push to it bounces until it is pruned.
      await api.pushUnsubscribe(endpoint).catch(() => {});
      await subscription.unsubscribe();
    }
  } catch {
    // Nothing to undo.
  }
  return 'off';
}
