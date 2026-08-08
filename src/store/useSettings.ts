import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type ThemeMode = 'dark' | 'light' | 'system';

const KEY = 'splitwise-clone/settings';

interface Settings {
  /** Dark by default — the app is mostly used in the evening, settling up
   *  after a meal, and a white screen at that hour is unpleasant. */
  themeMode: ThemeMode;
  /**
   * Categories the user invented, on top of the built-in list.
   *
   * Kept here rather than on the server because a category is only ever a
   * string on an expense — the server already accepts any value, so nothing
   * has to change there. Categories already used by a synced expense are
   * discovered from the ledger instead (see useCategories), which is what
   * makes one you added on your phone show up on your laptop.
   */
  customCategories: string[];
  loaded: boolean;
  load: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => void;
  addCategory: (name: string) => string;
  removeCategory: (name: string) => void;
}

/** Lower-case, trimmed, single-spaced — categories are compared as strings. */
export function normaliseCategory(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 24);
}

export const useSettings = create<Settings>((set, get) => ({
  themeMode: 'dark',
  customCategories: [],
  loaded: false,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Settings>;
        if (saved.themeMode) set({ themeMode: saved.themeMode });
        if (Array.isArray(saved.customCategories)) {
          set({ customCategories: saved.customCategories });
        }
      }
    } catch {
      // Fall through to the default rather than blocking startup.
    }
    set({ loaded: true });
  },

  setThemeMode: (themeMode) => {
    set({ themeMode });
    persist(get());
  },

  /** Returns the normalised name, so the caller can select it immediately. */
  addCategory: (name) => {
    const clean = normaliseCategory(name);
    if (!clean) return '';
    const { customCategories } = get();
    if (!customCategories.includes(clean)) {
      set({ customCategories: [...customCategories, clean] });
      persist(get());
    }
    return clean;
  },

  removeCategory: (name) => {
    set({ customCategories: get().customCategories.filter((x) => x !== name) });
    persist(get());
  },
}));

function persist(state: Settings) {
  void AsyncStorage.setItem(
    KEY,
    JSON.stringify({ themeMode: state.themeMode, customCategories: state.customCategories })
  ).catch(() => {});
}
