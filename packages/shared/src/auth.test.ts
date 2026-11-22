// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  emailSchema,
  isOneTimeTokenUsable,
  normalizeEmail,
  passwordSchema,
  sessionExpiry,
  sessionPolicy,
  sessionState,
  shouldTouchSession,
} from './auth.js';

const t0 = new Date('2026-01-01T00:00:00Z');
const plus = (ms: number) => new Date(t0.getTime() + ms);

describe('emails', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
    expect(emailSchema.parse(' Bob@Example.org')).toBe('bob@example.org');
  });
  it('rejects invalid addresses', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(emailSchema.safeParse('').success).toBe(false);
  });
});

describe('passwords', () => {
  it('enforces 12 to 256 characters', () => {
    expect(passwordSchema.safeParse('a'.repeat(11)).success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(12)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(256)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(257)).success).toBe(false);
  });
});

describe('sessionState', () => {
  const base = { lastSeenAt: t0, expiresAt: sessionExpiry(t0), revokedAt: null };
  it('is active right after creation', () => {
    expect(sessionState(base, plus(1000))).toBe('active');
  });
  it('is revoked first, whatever the times', () => {
    expect(sessionState({ ...base, revokedAt: t0 }, plus(1000))).toBe('revoked');
  });
  it('expires at the absolute lifetime even when used recently', () => {
    const now = plus(sessionPolicy.absoluteMs);
    expect(sessionState({ ...base, lastSeenAt: plus(sessionPolicy.absoluteMs - 1) }, now)).toBe(
      'expired',
    );
  });
  it('becomes idle after the idle timeout', () => {
    expect(sessionState(base, plus(sessionPolicy.idleMs - 1))).toBe('active');
    expect(sessionState(base, plus(sessionPolicy.idleMs))).toBe('idle');
  });
});

describe('shouldTouchSession', () => {
  it('throttles last_seen_at writes', () => {
    expect(shouldTouchSession(t0, plus(sessionPolicy.touchIntervalMs - 1))).toBe(false);
    expect(shouldTouchSession(t0, plus(sessionPolicy.touchIntervalMs))).toBe(true);
  });
});

describe('isOneTimeTokenUsable', () => {
  it('requires unused and unexpired', () => {
    expect(isOneTimeTokenUsable({ expiresAt: plus(10), usedAt: null }, t0)).toBe(true);
    expect(isOneTimeTokenUsable({ expiresAt: plus(10), usedAt: t0 }, t0)).toBe(false);
    expect(isOneTimeTokenUsable({ expiresAt: t0, usedAt: null }, t0)).toBe(false);
  });
});
