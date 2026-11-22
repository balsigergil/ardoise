// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { decodeCachedSession, encodeCachedSession } from './session-cache.js';

describe('session cache codec', () => {
  it('round-trips dates', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    const value = {
      session: {
        id: 's',
        userId: 'u',
        tokenHash: 'h',
        createdAt: at,
        lastSeenAt: at,
        expiresAt: at,
        userAgent: null,
        ip: null,
        revokedAt: null,
      },
      user: {
        id: 'u',
        email: 'e',
        name: 'n',
        passwordHash: 'p',
        locale: null,
        theme: 'system' as const,
        isSuperAdmin: false,
        disabledAt: null,
        createdAt: at,
      },
    };
    const decoded = decodeCachedSession(encodeCachedSession(value));
    expect(decoded).toEqual(value);
    expect(decoded?.session.expiresAt).toBeInstanceOf(Date);
  });
  it('ignores garbage', () => {
    expect(decodeCachedSession('not json')).toBeUndefined();
    expect(decodeCachedSession('{}')).toBeUndefined();
  });
});
