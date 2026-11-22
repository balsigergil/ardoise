// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { pickWorkspace } from './last-workspace';
import { safeRedirect } from './redirect';

describe('safeRedirect', () => {
  it('keeps in-app paths, with hash', () => {
    expect(safeRedirect('/w/1/settings')).toBe('/w/1/settings');
    expect(safeRedirect('/invite#token=abc')).toBe('/invite#token=abc');
  });
  it('rejects other origins and non-strings', () => {
    for (const value of [
      'https://evil.test',
      '//evil.test',
      '/\\evil.test',
      'javascript:alert(1)',
      42,
      undefined,
    ])
      expect(safeRedirect(value)).toBeUndefined();
  });
});

describe('pickWorkspace', () => {
  const list = [{ id: 'a' }, { id: 'b' }];
  it('prefers the last workspace when still a member', () => {
    expect(pickWorkspace(list, 'b')).toBe('b');
    expect(pickWorkspace(list, 'zzz')).toBe('a');
    expect(pickWorkspace([], 'a')).toBeUndefined();
  });
});
