// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { applyTheme, isThemePreference, parseThemePreference, resolveTheme } from './theme';

describe('resolveTheme', () => {
  it.each([
    ['light', false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['dark', true, 'dark'],
    ['system', false, 'light'],
    ['system', true, 'dark'],
  ] as const)('%s with system dark=%s → %s', (preference, systemDark, expected) => {
    expect(resolveTheme(preference, systemDark)).toBe(expected);
  });
});

describe('parseThemePreference', () => {
  it('defaults to system for missing or invalid values', () => {
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference('sepia')).toBe('system');
    expect(parseThemePreference('dark')).toBe('dark');
  });
  it('validates preferences', () => {
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference(3)).toBe(false);
  });
});

describe('applyTheme', () => {
  it('toggles the dark class and color scheme', () => {
    const root = document.createElement('html');
    applyTheme(root, 'dark');
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.style.colorScheme).toBe('dark');
    applyTheme(root, 'light');
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.dataset.theme).toBe('light');
  });
});
