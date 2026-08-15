import { create } from 'zustand';

import { api, ApiError, setAuthToken, type ApiUser } from '../lib/api';
import { readStored, removeStored, writeStored } from '../lib/storage';
import type { GoogleCodeResult } from '../lib/googleAuth';
import { useStore } from './useStore';

const TOKEN = 'token';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthStore {
  status: Status;
  user: ApiUser | null;
  /** Kept in memory for the live-update socket; persisted copy is in storage. */
  token: string | null;
  error: string;
  busy: boolean;
  /** Set when the server is unreachable but a saved session exists. */
  offline: boolean;
  /** Which ways this account can be signed in to. Own account only. */
  hasGoogle: boolean;
  hasPassword: boolean;

  restore: () => Promise<void>;
  updateProfile: (name: string, colorIndex: number) => Promise<{ ok: boolean; error?: string }>;
  linkGoogle: (payload: GoogleCodeResult) => Promise<{ ok: boolean; error?: string }>;
  unlinkGoogle: () => Promise<{ ok: boolean; error?: string }>;
  /**
   * Resolves false on failure, and true when the account was created — which
   * now means "check your inbox", not "you are signed in".
   */
  signUp: (email: string, name: string, password: string) => Promise<boolean>;
  /** Redeems the token from a verification link and signs in. */
  verifyEmail: (token: string) => Promise<{ ok: boolean; error?: string }>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signInWithGoogle: (payload: GoogleCodeResult) => Promise<boolean>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
}

async function adopt(token: string, user: ApiUser) {
  setAuthToken(token);
  await writeStored(TOKEN, token);
  useStore.getState().setIdentity(user.id);
}

/**
 * Which sign-in methods the account has, read after any successful sign-in.
 *
 * The auth responses do not carry it — deliberately, since they are also the
 * shape sent for other people — so the account screen would otherwise show a
 * stale "Link Google" on an account that already has it.
 */
async function loadLinks(set: (patch: Partial<AuthStore>) => void) {
  try {
    const { hasGoogle, hasPassword } = await api.me();
    set({ hasGoogle, hasPassword });
  } catch {
    // Non-fatal: the screen keeps showing the last known state.
  }
}

export const useAuth = create<AuthStore>((set, get) => ({
  status: 'loading',
  user: null,
  token: null,
  error: '',
  busy: false,
  offline: false,
  hasGoogle: false,
  hasPassword: false,

  restore: async () => {
    const token = await readStored(TOKEN);
    if (!token) {
      set({ status: 'signedOut' });
      return;
    }
    setAuthToken(token);
    set({ token });
    try {
      const { user, hasGoogle, hasPassword } = await api.me();
      useStore.getState().setIdentity(user.id);
      set({ status: 'signedIn', user, offline: false, hasGoogle, hasPassword });
      void get().refresh();
    } catch (err) {
      // A rejected token means the session really is gone; a network failure
      // must not log the user out and wipe their view of the data.
      if (err instanceof ApiError && /reach the server/i.test(err.message)) {
        set({ status: 'signedIn', offline: true });
      } else {
        await removeStored(TOKEN);
        setAuthToken(null);
        set({ status: 'signedOut', user: null, token: null });
      }
    }
  },

  signUp: async (email, name, password) => {
    set({ busy: true, error: '' });
    try {
      // No session comes back: the account exists but cannot be used until the
      // address is confirmed, so there is nothing to adopt here.
      await api.signup(email, name, password);
      set({ busy: false });
      return true;
    } catch (err) {
      set({ busy: false, error: err instanceof Error ? err.message : 'Sign up failed' });
      return false;
    }
  },

  verifyEmail: async (token) => {
    set({ busy: true, error: '' });
    try {
      const { token: session, user } = await api.verifyEmail(token);
      await adopt(session, user);
      set({ status: 'signedIn', user, token: session, busy: false, offline: false });
      void loadLinks(set);
      await get().refresh();
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Could not confirm that link';
      set({ busy: false, error });
      return { ok: false, error };
    }
  },

  signIn: async (email, password) => {
    set({ busy: true, error: '' });
    try {
      const { token, user } = await api.login(email, password);
      await adopt(token, user);
      set({ status: 'signedIn', user, token, busy: false, offline: false });
      void loadLinks(set);
      await get().refresh();
      return true;
    } catch (err) {
      set({ busy: false, error: err instanceof Error ? err.message : 'Sign in failed' });
      return false;
    }
  },

  /**
   * Finishes the Google flow. The code has already been obtained by the
   * AuthSession hook; all that is left is letting the server redeem it.
   */
  signInWithGoogle: async (payload) => {
    set({ busy: true, error: '' });
    try {
      const { token, user } = await api.google(payload);
      await adopt(token, user);
      set({ status: 'signedIn', user, token, busy: false, offline: false });
      void loadLinks(set);
      await get().refresh();
      return true;
    } catch (err) {
      set({ busy: false, error: err instanceof Error ? err.message : 'Google sign-in failed' });
      return false;
    }
  },

  signOut: async () => {
    try {
      await api.logout();
    } catch {
      // Local sign-out must succeed even when the server cannot be reached.
    }
    await removeStored(TOKEN);
    setAuthToken(null);
    useStore.getState().clearAll();
    set({
      status: 'signedOut',
      user: null,
      token: null,
      error: '',
      offline: false,
      hasGoogle: false,
      hasPassword: false,
    });
  },

  updateProfile: async (name, colorIndex) => {
    set({ busy: true, error: '' });
    try {
      const { user } = await api.updateProfile({ name: name.trim(), colorIndex });
      set({ user, busy: false });
      // Every avatar and name in the UI is read from the people list, and a
      // sync is the only thing that refreshes it.
      await get().refresh();
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Could not save your profile';
      set({ busy: false, error });
      return { ok: false, error };
    }
  },

  linkGoogle: async (payload) => {
    set({ busy: true, error: '' });
    try {
      await api.linkGoogle(payload);
      set({ hasGoogle: true, busy: false });
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Could not link that Google account';
      set({ busy: false, error });
      return { ok: false, error };
    }
  },

  unlinkGoogle: async () => {
    set({ busy: true, error: '' });
    try {
      await api.unlinkGoogle();
      set({ hasGoogle: false, busy: false });
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Could not unlink Google';
      set({ busy: false, error });
      return { ok: false, error };
    }
  },

  refresh: async () => {
    try {
      const snapshot = await api.sync();
      useStore.getState().applyServerSnapshot(snapshot);
      set({ offline: false, user: snapshot.user });
    } catch {
      set({ offline: true });
    }
  },

  clearError: () => set({ error: '' }),
}));
