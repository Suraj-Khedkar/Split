import AsyncStorage from '@react-native-async-storage/async-storage';

import { readFrom, removeFrom, storageKey, writeTo } from './storageKeys';

/**
 * Device storage, bound to AsyncStorage.
 *
 * All the interesting behaviour — key naming and the migration off the old
 * `splitwise-clone/` prefix — lives in storageKeys.ts, which has no React
 * Native import and is therefore testable in plain Node.
 */
export { storageKey };

export const readStored = (name: string) => readFrom(AsyncStorage, name);
export const writeStored = (name: string, value: string) => writeTo(AsyncStorage, name, value);
export const removeStored = (name: string) => removeFrom(AsyncStorage, name);
