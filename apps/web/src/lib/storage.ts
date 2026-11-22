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

export function readJson<T>(key: string): T | undefined {
  const raw = safeStorage.get(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function writeJson(key: string, value: unknown): void {
  safeStorage.set(key, JSON.stringify(value));
}
