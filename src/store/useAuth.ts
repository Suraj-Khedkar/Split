import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { api, ApiError, setAuthToken, type ApiUser } from '../lib/api';
import type { GoogleCodeResult } from '../lib/googleAuth';
import { useStore } from './useStore';

const TOKEN_KEY = 'splitwise-clone/token';

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

  restore: () => Promise<void>;
  signUp: (email: string, name: string, password: string) => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signInWithGoogle: (payload: GoogleCodeResult) => Promise<boolean>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
}

async function adopt(token: string, user: ApiUser) {
  setAuthToken(token);
  await AsyncStorage.setItem(TOKEN_KEY, token);
  useStore.getState().setIdentity(user.id);
}

export const useAuth = create<AuthStore>((set, get) => ({
  status: 'loading',
  user: null,
  token: null,
  error: '',
  busy: false,
  offline: false,

  restore: async () => {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token) {
      set({ status: 'signedOut' });
      return;
    }
    setAuthToken(token);
    set({ token });
    try {
      const { user } = await api.me();
      useStore.getState().setIdentity(user.id);
      set({ status: 'signedIn', user, offline: false });
      void get().refresh();
    } catch (err) {
      // A rejected token means the session really is gone; a network failure
      // must not log the user out and wipe their view of the data.
      if (err instanceof ApiError && /reach the server/i.test(err.message)) {
        set({ status: 'signedIn', offline: true });
      } else {
        await AsyncStorage.removeItem(TOKEN_KEY);
        setAuthToken(null);
        set({ status: 'signedOut', user: null, token: null });
      }
    }
  },

  signUp: async (email, name, password) => {
    set({ busy: true, error: '' });
    try {
      const { token, user } = await api.signup(email, name, password);
      await adopt(token, user);
      set({ status: 'signedIn', user, token, busy: false, offline: false });
      await get().refresh();
      return true;
    } catch (err) {
      set({ busy: false, error: err instanceof Error ? err.message : 'Sign up failed' });
      return false;
    }
  },

  signIn: async (email, password) => {
    set({ busy: true, error: '' });
    try {
      const { token, user } = await api.login(email, password);
      await adopt(token, user);
      set({ status: 'signedIn', user, token, busy: false, offline: false });
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
    await AsyncStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    useStore.getState().clearAll();
    set({ status: 'signedOut', user: null, token: null, error: '', offline: false });
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
