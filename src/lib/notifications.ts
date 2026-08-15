import {
  disableNativePush,
  enableNativePush,
  nativePushState,
  nativePushSupported,
} from './nativePush';
import { disablePush, enablePush, pushState, pushSupported } from './push';

/**
 * One notification switch, whichever transport the platform actually has.
 *
 * Web Push in a browser, Expo/FCM in the Android build. The Account screen had
 * been calling the web functions directly, which is why the APK showed a dead
 * toggle reading "Web app only" — there was no code path that could ever say
 * anything else there.
 */
export type NotificationState = 'unsupported' | 'off' | 'on' | 'denied';

export function notificationsSupported(): boolean {
  return pushSupported() || nativePushSupported();
}

export async function notificationState(): Promise<NotificationState> {
  if (pushSupported()) return pushState();
  if (nativePushSupported()) return nativePushState();
  return 'unsupported';
}

export async function enableNotifications(): Promise<NotificationState> {
  if (pushSupported()) return enablePush();
  if (nativePushSupported()) return enableNativePush();
  return 'unsupported';
}

export async function disableNotifications(): Promise<NotificationState> {
  if (pushSupported()) return disablePush();
  if (nativePushSupported()) return disableNativePush();
  return 'unsupported';
}
