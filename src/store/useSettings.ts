import { create } from 'zustand';

import { learningKey } from '../lib/categorise';
import { readStored, writeStored } from '../lib/storage';

export type ThemeMode = 'dark' | 'light' | 'system';

const KEY = 'settings';

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
  /**
   * Categories the user has corrected by hand, keyed by learningKey().
   *
   * The guesser is a fixed vocabulary and will always be wrong about something
   * — a favourite restaurant with an unguessable name, a personal shorthand.
   * Rather than grow the word list forever, remember the correction: the next
   * expense with the same words gets it right without being asked twice.
   *
   * Device-local, like customCategories, because it is a preference rather
   * than shared data — two people in a group can disagree about what "Tuesday
   * regulars" means and both be right.
   */
  learnedCategories: Record<string, string>;
  loaded: boolean;
  load: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => void;
  addCategory: (name: string) => string;
  removeCategory: (name: string) => void;
  /** Remember that this description means this category. */
  learnCategory: (description: string, category: string) => void;
}

/** Lower-case, trimmed, single-spaced — categories are compared as strings. */
export function normaliseCategory(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 24);
}

export const useSettings = create<Settings>((set, get) => ({
  themeMode: 'dark',
  customCategories: [],
  learnedCategories: {},
  loaded: false,

  load: async () => {
    try {
      const raw = await readStored(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Settings>;
        if (saved.themeMode) set({ themeMode: saved.themeMode });
        if (Array.isArray(saved.customCategories)) {
          set({ customCategories: saved.customCategories });
        }
        if (saved.learnedCategories && typeof saved.learnedCategories === 'object') {
          set({ learnedCategories: saved.learnedCategories });
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

  learnCategory: (description, category) => {
    const key = learningKey(description);
    const clean = normaliseCategory(category);
    // An empty description has no key to file the lesson under, and 'general'
    // is the absence of a category rather than a choice worth remembering.
    if (!key || !clean || clean === 'general') return;
    if (get().learnedCategories[key] === clean) return;
    set({ learnedCategories: { ...get().learnedCategories, [key]: clean } });
    persist(get());
  },
}));

function persist(state: Settings) {
  void writeStored(
    KEY,
    JSON.stringify({
      themeMode: state.themeMode,
      customCategories: state.customCategories,
      learnedCategories: state.learnedCategories,
    })
  ).catch(() => {});
}
