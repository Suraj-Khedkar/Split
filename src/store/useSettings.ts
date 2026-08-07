import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type ThemeMode = 'dark' | 'light' | 'system';

const KEY = 'splitwise-clone/settings';

interface Settings {
  /** Dark by default — the app is mostly used in the evening, settling up
   *  after a meal, and a white screen at that hour is unpleasant. */
  themeMode: ThemeMode;
  loaded: boolean;
  load: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => void;
}

export const useSettings = create<Settings>((set, get) => ({
  themeMode: 'dark',
  loaded: false,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Settings>;
        if (saved.themeMode) set({ themeMode: saved.themeMode });
      }
    } catch {
      // Fall through to the default rather than blocking startup.
    }
    set({ loaded: true });
  },

  setThemeMode: (themeMode) => {
    set({ themeMode });
    void AsyncStorage.setItem(KEY, JSON.stringify({ themeMode })).catch(() => {});
  },
}));
