import { API_BASE } from './api';
import { readStored, removeStored, writeStored } from './storage';

/**
 * Survives the sign-up detour. Storage rather than in-memory state because on
 * web the invite link is usually opened in a fresh tab, and signing up can
 * bounce through Google in between — both of which lose module state.
 */
const PENDING_KEY = 'pending-invite';

/**
 * Public https link that carries an invite code.
 *
 * Deliberately not `Linking.createURL()`: that yields `splitandtrack://…` on
 * native, which only resolves for people who already installed the app — the
 * exact people who do not need an invite. An https link opens the web app in
 * any browser (and the installed PWA where the OS routes it there).
 *
 * API_BASE already resolves to the current origin on web and to the public
 * Funnel URL on native, so stripping the `/api` suffix gives the right host in
 * both cases without a second copy of that hostname.
 */
export function inviteLink(code: string): string {
  return `${API_BASE.replace(/\/api$/, '')}/join/${encodeURIComponent(code)}`;
}

export async function setPendingInvite(code: string): Promise<void> {
  await writeStored(PENDING_KEY, code);
}

export async function readPendingInvite(): Promise<string | null> {
  return readStored(PENDING_KEY);
}

export async function clearPendingInvite(): Promise<void> {
  await removeStored(PENDING_KEY);
}
