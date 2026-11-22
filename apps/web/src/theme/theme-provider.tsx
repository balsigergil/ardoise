// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { safeStorage } from '@/lib/storage';
import { applyTheme, parseThemePreference, resolveTheme, THEME_STORAGE_KEY } from './theme';
import { ThemeContext, type ThemeContextValue } from './theme-context';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemPrefersDark(): boolean {
  return globalThis.matchMedia?.(DARK_QUERY).matches ?? false;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState(() =>
    parseThemePreference(safeStorage.get(THEME_STORAGE_KEY)),
  );
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const media = globalThis.matchMedia?.(DARK_QUERY);
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveTheme(preference, systemDark);

  useEffect(() => {
    applyTheme(document.documentElement, resolved);
  }, [resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved,
      setPreference: (next) => {
        safeStorage.set(THEME_STORAGE_KEY, next);
        setPreferenceState(next);
      },
    }),
    [preference, resolved],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}
