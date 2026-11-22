// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { hashToken, randomToken, safeEqual, SecretKeyring } from './crypto.js';

describe('tokens', () => {
  it('are 256-bit base64url and unique', () => {
    const a = randomToken();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });
  it('hash to a stable SHA-256 hex digest', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('compares in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('SecretKeyring', () => {
  const keyring = new SecretKeyring('k'.repeat(40));

  it('round-trips encrypted secrets with a random IV', () => {
    const a = keyring.encrypt('smtp-password');
    expect(a).toMatch(/^v1\./);
    expect(a).not.toContain('smtp-password');
    expect(keyring.encrypt('smtp-password')).not.toBe(a);
    expect(keyring.decrypt(a)).toBe('smtp-password');
  });
  it('rejects tampered values and other keys', () => {
    const value = keyring.encrypt('secret');
    const parts = value.split('.');
    parts[3] = Buffer.from('other').toString('base64url');
    expect(() => keyring.decrypt(parts.join('.'))).toThrow();
    expect(() => new SecretKeyring('x'.repeat(40)).decrypt(value)).toThrow();
    expect(() => keyring.decrypt('v0.a.b.c')).toThrow('unsupported');
  });
  it('binds CSRF tokens to a session', () => {
    const token = keyring.csrfToken('session-1');
    expect(keyring.verifyCsrfToken('session-1', token)).toBe(true);
    expect(keyring.verifyCsrfToken('session-2', token)).toBe(false);
    expect(keyring.verifyCsrfToken('session-1', undefined)).toBe(false);
    expect(new SecretKeyring('x'.repeat(40)).verifyCsrfToken('session-1', token)).toBe(false);
  });
});
