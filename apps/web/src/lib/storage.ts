// SPDX-License-Identifier: AGPL-3.0-only
/** localStorage access that never throws (private mode, disabled storage). */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Preference simply is not persisted.
    }
  },
};
