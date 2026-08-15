import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from './api';

/**
 * Android notifications, via Expo's push service.
 *
 * The counterpart to push.ts, which does Web Push in the browser. The two
 * cannot be merged: Web Push is a browser API this server encrypts for
 * directly, while this is a token Expo relays to FCM on our behalf. What they
 * share is the shape — `state`, `enable`, `disable` — so the Account screen
 * can call whichever applies without knowing which it got.
 *
 * Requires FCM credentials on the EAS project and a google-services.json in
 * the build. Without those the token request fails, which is reported rather
 * than swallowed: a switch that flips to "on" and delivers nothing is worse
 * than one that refuses.
 */
export type NativePushState = 'unsupported' | 'off' | 'on' | 'denied';

/** In-memory only: the token is cheap to re-request and must not go stale. */
let current: string | null = null;

export function nativePushSupported(): boolean {
  // A simulator has no push service to register with, and Expo Go cannot
  // deliver to a custom project — only a real device running a real build.
  return Platform.OS !== 'web' && Device.isDevice;
}

/** The project the token is minted for. Required by expo-notifications on Android. */
function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
}

export async function nativePushState(): Promise<NativePushState> {
  if (!nativePushSupported()) return 'unsupported';
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'denied') return 'denied';
  return current ? 'on' : 'off';
}

export async function enableNativePush(): Promise<NativePushState> {
  if (!nativePushSupported()) return 'unsupported';

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return status === 'denied' ? 'denied' : 'off';

  if (Platform.OS === 'android') {
    // Android 8+ drops any notification that has no channel. Created before
    // the first send rather than lazily, or the first one is silently lost.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Expenses',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  }

  const { data } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
  current = data;
  await api.registerNativePush(data);
  return 'on';
}

export async function disableNativePush(): Promise<NativePushState> {
  if (!nativePushSupported()) return 'unsupported';
  if (current) {
    // Tell the server first: unregistering locally but leaving the row would
    // mean every future send bounces off a token nobody is listening to.
    await api.unregisterNativePush(current).catch(() => {});
    current = null;
  }
  return 'off';
}
